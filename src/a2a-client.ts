import { randomUUID } from "node:crypto";
import type { AgentCard, AgentConfig } from "./types.js";
import { isObject } from "./utils.js";

interface CachedCard {
  card: AgentCard;
  endpoint: string;
  expiresAt: number;
}

export class A2AClient {
  #cache = new Map<string, CachedCard>();

  constructor(
    private readonly agents: Record<string, AgentConfig>,
    private readonly timeoutMs = 120_000,
    private readonly cardTtlMs = 60_000,
  ) {}

  aliases(): string[] {
    return Object.keys(this.agents).sort();
  }

  async getAgent(alias: string): Promise<AgentCard> {
    return (await this.resolve(alias)).card;
  }

  async listAgents(): Promise<Array<{ alias: string; name: string; description?: string }>> {
    return Promise.all(
      this.aliases().map(async (alias) => {
        const card = await this.getAgent(alias);
        return { alias, name: card.name || alias, ...(card.description ? { description: card.description } : {}) };
      }),
    );
  }

  async sendMessage(
    alias: string,
    text: string,
    options: { contextId?: string; taskId?: string; returnImmediately?: boolean } = {},
  ): Promise<unknown> {
    if (!text.trim()) throw new Error("message must not be empty");
    const message: Record<string, unknown> = {
      messageId: randomUUID(),
      role: "ROLE_USER",
      parts: [{ text, mediaType: "text/plain" }],
    };
    if (options.contextId) message.contextId = options.contextId;
    if (options.taskId) message.taskId = options.taskId;

    const params: Record<string, unknown> = { message };
    if (options.returnImmediately !== undefined) {
      params.configuration = { returnImmediately: options.returnImmediately };
    }
    return this.rpc(alias, "SendMessage", params);
  }

  async getTask(alias: string, taskId: string, historyLength?: number): Promise<unknown> {
    const params: Record<string, unknown> = { id: taskId };
    if (historyLength !== undefined) params.historyLength = historyLength;
    return this.rpc(alias, "GetTask", params);
  }

  async cancelTask(alias: string, taskId: string): Promise<unknown> {
    return this.rpc(alias, "CancelTask", { id: taskId });
  }

  private async resolve(alias: string): Promise<CachedCard> {
    const config = this.agents[alias];
    if (!config) throw new Error(`Unknown A2A agent alias ${JSON.stringify(alias)}`);
    const cached = this.#cache.get(alias);
    if (cached && cached.expiresAt > Date.now()) return cached;

    const response = await fetch(config.cardUrl, {
      headers: { Accept: "application/json", ...config.headers },
      signal: AbortSignal.timeout(Math.min(this.timeoutMs, 30_000)),
    });
    if (!response.ok) {
      throw new Error(`Agent card ${alias} returned HTTP ${response.status}`);
    }
    const raw = (await response.json()) as unknown;
    if (!isObject(raw) || typeof raw.name !== "string") {
      throw new Error(`Agent card ${alias} is invalid`);
    }
    const card = raw as AgentCard;
    const endpoint = chooseJsonRpcEndpoint(card, config.cardUrl);
    const next = { card, endpoint, expiresAt: Date.now() + this.cardTtlMs };
    this.#cache.set(alias, next);
    return next;
  }

  private async rpc(alias: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    const config = this.agents[alias];
    if (!config) throw new Error(`Unknown A2A agent alias ${JSON.stringify(alias)}`);
    const resolved = await this.resolve(alias);
    const id = randomUUID();
    const response = await fetch(resolved.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "A2A-Version": "1.0",
        ...config.headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`A2A ${method} on ${alias} returned HTTP ${response.status}: ${body.slice(0, 1000)}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error(`A2A ${method} on ${alias} returned non-JSON data`);
    }
    if (!isObject(parsed)) throw new Error(`A2A ${method} on ${alias} returned an invalid envelope`);
    if (parsed.error && isObject(parsed.error)) {
      const code = parsed.error.code;
      const message = parsed.error.message;
      throw new Error(`A2A ${method} on ${alias} failed${code !== undefined ? ` (${code})` : ""}: ${String(message ?? "unknown error")}`);
    }
    return parsed.result;
  }
}

function chooseJsonRpcEndpoint(card: AgentCard, cardUrl: string): string {
  const interfaces = Array.isArray(card.supportedInterfaces) ? card.supportedInterfaces : [];
  const jsonrpc = interfaces.find((entry) => (entry.protocolBinding || "JSONRPC").toUpperCase() === "JSONRPC");
  const raw = jsonrpc?.url ?? (typeof card.url === "string" ? card.url : undefined);
  if (!raw) throw new Error("Agent card does not advertise a JSON-RPC endpoint");
  return new URL(raw, cardUrl).toString();
}
