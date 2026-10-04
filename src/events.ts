import { randomUUID } from "node:crypto";
import path from "node:path";
import { Webhook } from "standardwebhooks";
import { JsonStore } from "./json-store.js";
import type { EventSubscription, InboundTaskRecord } from "./types.js";
import { canonicalJson, constantTimeEqual, isObject, sha256Id } from "./utils.js";
import { safeHttpsPost, validatePublicHttpsUrl } from "./webhook.js";

export const A2A_MESSAGE_EVENT = "a2a.message.received";

export interface SubscribeParams {
  name: string;
  arguments?: Record<string, unknown>;
  delivery: { mode: string; url: string; secret: string };
  cursor?: string | null;
  ttlMs?: number | null;
}

export interface EventTransport {
  validate(url: string): Promise<void>;
  post(url: string, body: string, headers: Record<string, string>): Promise<{ status: number; body: string }>;
}

const defaultTransport: EventTransport = {
  async validate(url) {
    await validatePublicHttpsUrl(url);
  },
  async post(url, body, headers) {
    return safeHttpsPost(url, body, headers);
  },
};

export class EventManager {
  private readonly store: JsonStore<{ subscriptions: EventSubscription[] }>;

  constructor(
    dataDir: string,
    private readonly defaultTtlMs: number,
    private readonly transport: EventTransport = defaultTransport,
    private readonly principal: string = "anonymous",
  ) {
    this.store = new JsonStore(path.join(dataDir, "subscriptions.json"), { subscriptions: [] });
  }

  definitions(): unknown[] {
    return [
      {
        name: A2A_MESSAGE_EVENT,
        description:
          "A remote A2A agent sent a message to this bridge. Subscribe to let ChatGPT receive and handle inbound agent messages.",
        delivery: ["webhook"],
        inputSchema: {
          type: "object",
          properties: {
            sender: { type: "string", description: "Optional authenticated A2A peer name to monitor." },
            context_id: { type: "string", description: "Optional A2A context ID to monitor." },
          },
          additionalProperties: false,
        },
        payloadSchema: {
          type: "object",
          properties: {
            task_id: { type: "string" },
            context_id: { type: "string" },
            sender: { type: "string" },
            text: { type: "string" },
            received_at: { type: "string" },
          },
          required: ["task_id", "context_id", "sender", "text", "received_at"],
          additionalProperties: false,
        },
      },
    ];
  }

  async subscribe(params: SubscribeParams): Promise<{
    id: string;
    refreshBefore: string | null;
    cursor: null;
    truncated: false;
  }> {
    this.validateSubscriptionRequest(params);
    const args = params.arguments ?? {};
    const id = this.subscriptionId(params.name, args, params.delivery.url);
    const refreshBefore = this.computeRefreshBefore(params.ttlMs);
    await this.verifyCallback(id, params.delivery.url, params.delivery.secret);

    const now = new Date().toISOString();
    const record: EventSubscription = {
      id,
      owner: this.principal,
      name: params.name,
      arguments: args,
      url: params.delivery.url,
      secret: params.delivery.secret,
      createdAt: now,
      refreshBefore,
    };

    await this.store.update(({ subscriptions }) => {
      const live = subscriptions.filter((item) => item.id !== id && !isExpired(item));
      live.push(record);
      return [{ subscriptions: live }, undefined];
    });
    return { id, refreshBefore, cursor: null, truncated: false };
  }

  async unsubscribe(params: Omit<SubscribeParams, "ttlMs" | "cursor">): Promise<Record<string, never>> {
    if (params.name !== A2A_MESSAGE_EVENT) throw new Error(`Unsupported event ${params.name}`);
    const args = params.arguments ?? {};
    const id = this.subscriptionId(params.name, args, params.delivery.url);
    await this.store.update(({ subscriptions }) => [
      { subscriptions: subscriptions.filter((item) => item.id !== id && !isExpired(item)) },
      undefined,
    ]);
    return {};
  }

  async emitInboundMessage(task: InboundTaskRecord): Promise<{ matched: number; delivered: number }> {
    const data = {
      task_id: task.id,
      context_id: task.contextId,
      sender: task.sender,
      text: task.text,
      received_at: task.createdAt,
    };
    const { subscriptions } = await this.store.read();
    const matching = subscriptions.filter(
      (subscription) =>
        !isExpired(subscription) &&
        subscription.owner === this.principal &&
        subscription.name === A2A_MESSAGE_EVENT &&
        matches(subscription.arguments, data),
    );

    let delivered = 0;
    await Promise.all(
      matching.map(async (subscription) => {
        const eventId = `evt_${randomUUID().replaceAll("-", "")}`;
        const event = {
          eventId,
          name: A2A_MESSAGE_EVENT,
          timestamp: new Date().toISOString(),
          data,
          cursor: null,
        };
        if (await this.deliver(subscription, eventId, event)) delivered += 1;
      }),
    );
    return { matched: matching.length, delivered };
  }

  private subscriptionId(name: string, args: Record<string, unknown>, url: string): string {
    return sha256Id("sub", `${this.principal}\n${name}\n${canonicalJson(args)}\n${url}`);
  }

  private validateSubscriptionRequest(params: SubscribeParams): void {
    if (params.name !== A2A_MESSAGE_EVENT) throw new Error(`Unsupported event ${params.name}`);
    if (!isObject(params.delivery) || params.delivery.mode !== "webhook") {
      throw new Error("Only webhook event delivery is supported");
    }
    if (!isObject(params.arguments ?? {})) throw new Error("event arguments must be an object");
    const args = params.arguments ?? {};
    for (const key of Object.keys(args)) {
      if (key !== "sender" && key !== "context_id") throw new Error(`Unsupported event filter: ${key}`);
      if (typeof args[key] !== "string" || !args[key]) throw new Error(`Event filter ${key} must be a non-empty string`);
    }
    validateWhsec(params.delivery.secret);
    if (params.ttlMs !== undefined && params.ttlMs !== null && (!Number.isInteger(params.ttlMs) || params.ttlMs <= 0)) {
      throw new Error("ttlMs must be a positive integer or null");
    }
  }

  private computeRefreshBefore(requested: number | null | undefined): string | null {
    if (requested === null) return null;
    const granted = requested === undefined ? this.defaultTtlMs : Math.min(requested, this.defaultTtlMs);
    return new Date(Date.now() + granted).toISOString();
  }

  private async verifyCallback(subscriptionId: string, url: string, secret: string): Promise<void> {
    await this.transport.validate(url);
    const challenge = randomUUID();
    const id = `msg_verification_${randomUUID().replaceAll("-", "")}`;
    const payload = JSON.stringify({ type: "verification", challenge });
    const signedAt = new Date();
    const signer = new Webhook(secret);
    const response = await this.transport.post(url, payload, {
      "Content-Type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(Math.floor(signedAt.getTime() / 1000)),
      "webhook-signature": signer.sign(id, signedAt, payload),
      "X-MCP-Subscription-Id": subscriptionId,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Callback verification failed with HTTP ${response.status}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      throw new Error("Callback verification returned invalid JSON");
    }
    const echoed = isObject(parsed) && typeof parsed.challenge === "string" ? parsed.challenge : "";
    if (!constantTimeEqual(echoed, challenge)) throw new Error("Callback verification challenge mismatch");
  }

  private async deliver(subscription: EventSubscription, eventId: string, event: unknown): Promise<boolean> {
    const body = JSON.stringify(event);
    if (Buffer.byteLength(body, "utf8") > 256 * 1024) {
      throw new Error("Event payload exceeds 256 KiB");
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const signedAt = new Date();
        const signer = new Webhook(subscription.secret);
        const response = await this.transport.post(subscription.url, body, {
          "Content-Type": "application/json",
          "webhook-id": eventId,
          "webhook-timestamp": String(Math.floor(signedAt.getTime() / 1000)),
          "webhook-signature": signer.sign(eventId, signedAt, body),
          "X-MCP-Subscription-Id": subscription.id,
        });
        if (response.status >= 200 && response.status < 300) return true;
        if (response.status === 410 || response.status === 413) return false;
        if (response.status !== 408 && response.status !== 429 && response.status < 500) return false;
      } catch {
        // Network and DNS failures are retryable within the bounded attempt budget.
      }
      if (attempt < 2) await sleep(attempt === 0 ? 250 : 1000);
    }
    return false;
  }
}

function validateWhsec(secret: string): void {
  if (!secret.startsWith("whsec_")) throw new Error("webhook secret must start with whsec_");
  let decoded: Buffer;
  try {
    decoded = Buffer.from(secret.slice("whsec_".length), "base64");
  } catch {
    throw new Error("webhook secret must contain base64 data");
  }
  if (decoded.length < 24 || decoded.length > 64) {
    throw new Error("webhook signing key must decode to 24-64 bytes");
  }
}

function isExpired(subscription: EventSubscription): boolean {
  return subscription.refreshBefore !== null && Date.parse(subscription.refreshBefore) <= Date.now();
}

function matches(arguments_: Record<string, unknown>, data: Record<string, string>): boolean {
  if (typeof arguments_.sender === "string" && arguments_.sender !== data.sender) return false;
  if (typeof arguments_.context_id === "string" && arguments_.context_id !== data.context_id) return false;
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
