import { randomUUID } from "node:crypto";
import type { BridgeConfig } from "./types.js";
import { EventManager } from "./events.js";
import { InboundTaskStore, toA2ATask } from "./inbound-tasks.js";
import { constantTimeEqual, isObject, textFromA2AMessage } from "./utils.js";

export class InboundA2AServer {
  constructor(
    private readonly config: BridgeConfig,
    private readonly tasks: InboundTaskStore,
    private readonly events: EventManager,
  ) {}

  agentCard(origin: string): Record<string, unknown> {
    const base = this.config.publicBaseUrl ?? origin.replace(/\/+$/, "");
    const secured = Object.keys(this.config.inboundPeerTokens).length > 0;
    return {
      name: "A2A MCP ChatGPT Bridge",
      description:
        "Routes A2A messages into ChatGPT via MCP Events. Replies are written back to the A2A task and can be read with GetTask.",
      version: "0.1.0",
      supportedInterfaces: [
        { protocolBinding: "JSONRPC", protocolVersion: "1.0", url: `${base}/a2a` },
      ],
      capabilities: { streaming: false, pushNotifications: false },
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: [
        {
          id: "contact_chatgpt",
          name: "Contact ChatGPT",
          description:
            "Send a message that can wake a subscribed ChatGPT Work chat. When active wake is disabled, SendMessage returns an ActiveWakeDisabled error with the persisted task ID instead of failing silently.",
          tags: ["chatgpt", "messaging", "a2a", "mcp-events"],
          examples: ["Please review this result and tell me whether to continue."],
        },
      ],
      ...(secured
        ? {
            securitySchemes: {
              bearerAuth: { type: "http", scheme: "bearer" },
            },
            securityRequirements: [{ bearerAuth: [] }],
          }
        : {}),
    };
  }

  async handle(body: unknown, authorization: string | undefined): Promise<Record<string, unknown>> {
    if (!isObject(body) || body.jsonrpc !== "2.0" || body.id === undefined || typeof body.method !== "string") {
      return rpcError(null, -32600, "Invalid Request");
    }
    const id = body.id as string | number | null;
    let sender: string;
    try {
      sender = this.authenticate(authorization);
    } catch (error) {
      return rpcError(id, -32050, error instanceof Error ? error.message : "Unauthorized");
    }

    try {
      switch (body.method) {
        case "SendMessage":
        case "message/send":
          return { jsonrpc: "2.0", id, result: await this.sendMessage(sender, body.params) };
        case "GetTask":
        case "tasks/get":
          return { jsonrpc: "2.0", id, result: await this.getTask(body.params) };
        case "CancelTask":
        case "tasks/cancel":
          return { jsonrpc: "2.0", id, result: await this.cancelTask(body.params) };
        case "ListTasks":
        case "tasks/list":
          return { jsonrpc: "2.0", id, result: await this.listTasks(body.params) };
        default:
          return rpcError(id, -32601, "Method not found");
      }
    } catch (error) {
      if (error instanceof TaskNotFoundError) return rpcError(id, -32001, error.message);
      if (error instanceof ActiveWakeDisabledError) {
        return rpcError(id, -32016, "ActiveWakeDisabled", {
          task_id: error.taskId,
          context_id: error.contextId,
          persisted: true,
          wake_delivery: "disabled",
          detail:
            "The inbound A2A message was persisted, but active ChatGPT wake delivery is disabled. Enable it with a2a_set_wake_enabled before retrying a wake-dependent message.",
        });
      }
      return rpcError(id, -32602, error instanceof Error ? error.message : String(error));
    }
  }

  private async sendMessage(sender: string, params: unknown): Promise<Record<string, unknown>> {
    if (!isObject(params) || !isObject(params.message)) throw new Error("SendMessage requires params.message");
    const text = textFromA2AMessage(params.message);
    if (!text.trim()) throw new Error("Only non-empty text parts are supported");
    const contextId = typeof params.message.contextId === "string" ? params.message.contextId : undefined;
    const metadata = isObject(params.message.metadata) ? params.message.metadata : undefined;
    const task = await this.tasks.create({ sender, text, ...(contextId ? { contextId } : {}), ...(metadata ? { metadata } : {}) });

    // Delivery is intentionally bounded by the EventManager retry policy. The
    // task exists before delivery starts, so the sender can recover with GetTask.
    const delivery = await this.events.emitInboundMessage(task);
    if (!delivery.wakeEnabled) {
      throw new ActiveWakeDisabledError(task.id, task.contextId);
    }
    return {
      task: toA2ATask(task),
      wakeDelivery: {
        status: "enabled",
        matchedSubscriptions: delivery.matched,
        deliveredSubscriptions: delivery.delivered,
      },
    };
  }

  private async getTask(params: unknown): Promise<Record<string, unknown>> {
    if (!isObject(params) || typeof params.id !== "string") throw new Error("GetTask requires params.id");
    const task = await this.tasks.get(params.id);
    if (!task) throw new TaskNotFoundError(params.id);
    return toA2ATask(task);
  }

  private async cancelTask(params: unknown): Promise<Record<string, unknown>> {
    if (!isObject(params) || typeof params.id !== "string") throw new Error("CancelTask requires params.id");
    try {
      return toA2ATask(await this.tasks.cancel(params.id));
    } catch {
      throw new TaskNotFoundError(params.id);
    }
  }

  private async listTasks(params: unknown): Promise<Record<string, unknown>> {
    const contextId = isObject(params) && typeof params.contextId === "string" ? params.contextId : undefined;
    const tasks = await this.tasks.list(contextId);
    return {
      tasks: tasks.slice(0, 100).map(toA2ATask),
      nextPageToken: "",
    };
  }

  private authenticate(authorization: string | undefined): string {
    const entries = Object.entries(this.config.inboundPeerTokens);
    if (entries.length === 0) return "anonymous";
    const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
    if (!match) throw new Error("A2A bearer token required");
    const supplied = match[1]!;
    for (const [peer, token] of entries) {
      if (constantTimeEqual(supplied, token)) return peer;
    }
    throw new Error("Invalid A2A bearer token");
  }
}

class ActiveWakeDisabledError extends Error {
  constructor(
    readonly taskId: string,
    readonly contextId: string,
  ) {
    super("Active ChatGPT wake delivery is disabled");
  }
}

class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`Task not found: ${id}`);
  }
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data ? { data } : {}) },
  };
}
