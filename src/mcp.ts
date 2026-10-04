import { McpServer, ProtocolError, createMcpHandler, type McpHttpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import { A2AClient } from "./a2a-client.js";
import { EventManager, A2A_MESSAGE_EVENT } from "./events.js";
import { InboundTaskStore, toA2ATask } from "./inbound-tasks.js";
import { isObject } from "./utils.js";

const SERVER_INFO = { name: "@kumaxs/a2a-mcp", version: "0.1.0" };

export function createBridgeMcpHandler(input: {
  a2a: A2AClient;
  events: EventManager;
  inboundTasks: InboundTaskStore;
}): McpHttpHandler {
  return createMcpHandler(
    () => {
      const mcp = new McpServer(SERVER_INFO, {
        instructions:
          "Use the a2a_* tools to discover and call remote A2A agents. " +
          "Inbound A2A messages are exposed as MCP Events named " +
          A2A_MESSAGE_EVENT +
          ". Active wake delivery is controlled by a2a_set_wake_enabled and is disabled by default. When disabled, inbound A2A tasks are still persisted without waking ChatGPT. When an event arrives, inspect the inbound task and answer it with a2a_reply_inbound so the remote agent can retrieve the reply with A2A GetTask.",
      });

      // MCP Events is a ChatGPT extension to MCP 2026-07-28. The upstream
      // server SDK does not yet type this draft capability, but server/discover
      // intentionally advertises registered capabilities verbatim.
      mcp.server.registerCapabilities({ events: {} } as any);

      registerTools(mcp, input);
      registerEvents(mcp, input.events);
      return mcp;
    },
    { legacy: "stateless" },
  );
}

function registerTools(
  mcp: McpServer,
  input: { a2a: A2AClient; events: EventManager; inboundTasks: InboundTaskStore },
): void {
  mcp.registerTool(
    "a2a_list_agents",
    {
      title: "List A2A agents",
      description: "List configured remote A2A agents.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => toolResult(await input.a2a.listAgents()),
  );

  mcp.registerTool(
    "a2a_get_agent",
    {
      title: "Get A2A agent",
      description: "Fetch one configured A2A Agent Card.",
      inputSchema: z.object({ agent: z.string().optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ agent }) => toolResult(await input.a2a.getAgent(resolveAlias(input.a2a, agent))),
  );

  mcp.registerTool(
    "a2a_send_message",
    {
      title: "Send A2A message",
      description:
        "Send a text message to a remote A2A agent. context_id continues a conversation; task_id answers an interrupted task.",
      inputSchema: z.object({
        agent: z.string().optional(),
        message: z.string().min(1),
        context_id: z.string().optional(),
        task_id: z.string().optional(),
        return_immediately: z.boolean().optional(),
      }),
    },
    async ({ agent, message, context_id, task_id, return_immediately }) =>
      toolResult(
        await input.a2a.sendMessage(resolveAlias(input.a2a, agent), message, {
          ...(context_id ? { contextId: context_id } : {}),
          ...(task_id ? { taskId: task_id } : {}),
          ...(return_immediately !== undefined ? { returnImmediately: return_immediately } : {}),
        }),
      ),
  );

  mcp.registerTool(
    "a2a_get_task",
    {
      title: "Get remote A2A task",
      description: "Read the latest state of a task owned by a configured remote A2A agent.",
      inputSchema: z.object({
        agent: z.string().optional(),
        task_id: z.string().min(1),
        history_length: z.number().int().min(0).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ agent, task_id, history_length }) =>
      toolResult(await input.a2a.getTask(resolveAlias(input.a2a, agent), task_id, history_length)),
  );

  mcp.registerTool(
    "a2a_cancel_task",
    {
      title: "Cancel remote A2A task",
      description: "Request cancellation of a task owned by a configured remote A2A agent.",
      inputSchema: z.object({ agent: z.string().optional(), task_id: z.string().min(1) }),
      annotations: { destructiveHint: true },
    },
    async ({ agent, task_id }) =>
      toolResult(await input.a2a.cancelTask(resolveAlias(input.a2a, agent), task_id)),
  );

  mcp.registerTool(
    "a2a_get_inbound_task",
    {
      title: "Get inbound A2A task",
      description:
        "Inspect an A2A message sent into this bridge, usually after an a2a.message.received event.",
      inputSchema: z.object({ task_id: z.string().min(1) }),
      annotations: { readOnlyHint: true },
    },
    async ({ task_id }) => {
      const task = await input.inboundTasks.get(task_id);
      if (!task) return toolError(`Inbound task not found: ${task_id}`);
      return toolResult(toA2ATask(task));
    },
  );



  mcp.registerTool(
    "a2a_get_wake_status",
    {
      title: "Get A2A wake status",
      description:
        "Show whether inbound A2A messages may actively wake ChatGPT through MCP Events. When disabled, inbound tasks are still persisted but no wake webhook is delivered.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => toolResult(await input.events.getWakeStatus()),
  );

  mcp.registerTool(
    "a2a_set_wake_enabled",
    {
      title: "Set A2A active wake",
      description:
        "Enable or disable paid/active ChatGPT wake delivery for future inbound A2A messages. Disabled is the safe default: Hermes messages are stored as inbound tasks but do not trigger MCP Event webhooks. Existing subscriptions are preserved.",
      inputSchema: z.object({ enabled: z.boolean() }),
      annotations: { idempotentHint: true },
    },
    async ({ enabled }) => toolResult(await input.events.setWakeEnabled(enabled)),
  );

  mcp.registerTool(
    "a2a_reply_inbound",
    {
      title: "Reply to inbound A2A task",
      description:
        "Complete an inbound A2A task with ChatGPT's reply. The remote A2A agent can then retrieve it using GetTask.",
      inputSchema: z.object({ task_id: z.string().min(1), reply: z.string().min(1) }),
    },
    async ({ task_id, reply }) => {
      try {
        const task = await input.inboundTasks.complete(task_id, reply);
        return toolResult(toA2ATask(task));
      } catch (error) {
        return toolError(error instanceof Error ? error.message : String(error));
      }
    },
  );
}

function registerEvents(mcp: McpServer, events: EventManager): void {
  const argumentsSchema = z.record(z.string(), z.unknown()).optional();
  const deliverySchema = z.object({
    mode: z.literal("webhook"),
    url: z.string().url(),
    secret: z.string().min(1),
  });

  mcp.server.setRequestHandler(
    "events/list",
    {
      params: z.object({ cursor: z.string().nullable().optional() }),
    },
    async () => ({ events: events.definitions() }),
  );

  mcp.server.setRequestHandler(
    "events/subscribe",
    {
      params: z.object({
        name: z.string(),
        arguments: argumentsSchema,
        delivery: deliverySchema,
        cursor: z.string().nullable().optional(),
        ttlMs: z.number().int().positive().nullable().optional(),
      }),
    },
    async (params) => {
      try {
        return await events.subscribe({
          name: params.name,
          delivery: params.delivery,
          ...(params.arguments !== undefined ? { arguments: params.arguments } : {}),
          ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
          ...(params.ttlMs !== undefined ? { ttlMs: params.ttlMs } : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const callbackFailure =
          message.toLowerCase().includes("callback") ||
          message.toLowerCase().includes("webhook") ||
          message.toLowerCase().includes("non-public") ||
          message.toLowerCase().includes("https");
        if (callbackFailure) {
          throw new ProtocolError(-32015, "CallbackEndpointError", {
            reason: message.toLowerCase().includes("timeout") ? "timeout" : "challenge_failed",
            detail: message,
          });
        }
        throw new ProtocolError(-32602, message);
      }
    },
  );

  mcp.server.setRequestHandler(
    "events/unsubscribe",
    {
      params: z.object({
        name: z.string(),
        arguments: argumentsSchema,
        delivery: z.object({ mode: z.literal("webhook"), url: z.string().url() }),
      }),
    },
    async (params) =>
      events.unsubscribe({
        name: params.name,
        ...(params.arguments ? { arguments: params.arguments } : {}),
        delivery: { ...params.delivery, secret: "unused" },
      }),
  );
}

function resolveAlias(a2a: A2AClient, alias: string | undefined): string {
  if (alias) return alias;
  const aliases = a2a.aliases();
  if (aliases.length === 1) return aliases[0]!;
  if (aliases.length === 0) throw new Error("No outbound A2A agents are configured");
  throw new Error("agent is required when more than one A2A agent is configured");
}

function toolResult(value: unknown): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
} {
  const structured = isObject(value) ? value : { value };
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: structured,
  };
}

function toolError(message: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return { content: [{ type: "text", text: message }], isError: true };
}
