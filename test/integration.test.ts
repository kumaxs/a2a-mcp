import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startBridge, type BridgeConfig } from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

describe("bidirectional bridge", () => {
  it("reports ActiveWakeDisabled clearly while preserving the inbound task", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "a2a-mcp-integration-"));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));

    const config: BridgeConfig = {
      host: "127.0.0.1",
      port: 0,
      dataDir,
      agents: {},
      inboundPeerTokens: {},
      subscriptionTtlMs: 60_000,
    };
    const bridge = await startBridge(config);
    cleanups.push(() => bridge.close());

    const envelope = await rawRpc(`${bridge.url}/a2a`, "blocked-1", "SendMessage", {
      message: {
        messageId: "blocked-m1",
        role: "ROLE_USER",
        parts: [{ text: "wake ChatGPT", mediaType: "text/plain" }],
      },
    });
    expect(envelope.error).toMatchObject({
      code: -32016,
      message: "ActiveWakeDisabled",
      data: {
        persisted: true,
        wake_delivery: "disabled",
      },
    });
    const blockedTaskId = envelope.error.data.task_id as string;
    expect(blockedTaskId).toBeTruthy();

    const persisted = await rpc(`${bridge.url}/a2a`, "blocked-get-1", "GetTask", { id: blockedTaskId });
    expect((persisted as any).status.state).toBe("TASK_STATE_SUBMITTED");
    expect((persisted as any).history[0].parts[0].text).toBe("wake ChatGPT");
  });

  it("round-trips an inbound A2A task through an MCP reply when wake is enabled", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "a2a-mcp-integration-"));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));

    const config: BridgeConfig = {
      host: "127.0.0.1",
      port: 0,
      dataDir,
      agents: {},
      inboundPeerTokens: {},
      subscriptionTtlMs: 60_000,
    };
    const bridge = await startBridge(config);
    cleanups.push(() => bridge.close());

    const card = await fetch(`${bridge.url}/.well-known/agent-card.json`).then((r) => r.json()) as any;
    expect(card.supportedInterfaces[0].protocolVersion).toBe("1.0");

    const discover = await modernMcp(`${bridge.url}/mcp`, "server/discover", {}, 2);
    expect((discover as any).capabilities.events).toEqual({});

    const wakeStatus = await modernMcp(
      `${bridge.url}/mcp`,
      "tools/call",
      { name: "a2a_get_wake_status", arguments: {} },
      20,
      "a2a_get_wake_status",
    );
    expect((wakeStatus as any).structuredContent).toMatchObject({
      enabled: false,
      behavior: "store_only",
    });

    const wakeEnabled = await modernMcp(
      `${bridge.url}/mcp`,
      "tools/call",
      { name: "a2a_set_wake_enabled", arguments: { enabled: true } },
      21,
      "a2a_set_wake_enabled",
    );
    expect((wakeEnabled as any).structuredContent.enabled).toBe(true);

    const sent = await rpc(`${bridge.url}/a2a`, "send-1", "SendMessage", {
      message: {
        messageId: "m1",
        role: "ROLE_USER",
        parts: [{ text: "hello ChatGPT", mediaType: "text/plain" }],
      },
    });
    const taskId = (sent as any).task.id as string;
    expect((sent as any).task.status.state).toBe("TASK_STATE_SUBMITTED");
    expect((sent as any).wakeDelivery.status).toBe("enabled");

    const reply = await modernMcp(
      `${bridge.url}/mcp`,
      "tools/call",
      {
        name: "a2a_reply_inbound",
        arguments: { task_id: taskId, reply: "hello Hermes" },
      },
      3,
      "a2a_reply_inbound",
    );
    expect((reply as any).structuredContent.status.state).toBe("TASK_STATE_COMPLETED");

    const fetched = await rpc(`${bridge.url}/a2a`, "get-1", "GetTask", { id: taskId });
    expect((fetched as any).status.state).toBe("TASK_STATE_COMPLETED");
    expect((fetched as any).status.message.parts[0].text).toBe("hello Hermes");
  });
});

async function rawRpc(
  url: string,
  id: string,
  method: string,
  params: unknown,
): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "A2A-Version": "1.0" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return response.json();
}

async function rpc(url: string, id: string, method: string, params: unknown): Promise<unknown> {
  const envelope = await rawRpc(url, id, method, params);
  if (envelope.error) throw new Error(JSON.stringify(envelope.error));
  return envelope.result;
}

async function modernMcp(
  url: string,
  method: string,
  params: Record<string, unknown>,
  id: number,
  name?: string,
): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "MCP-Protocol-Version": "2026-07-28",
    "Mcp-Method": method,
  };
  if (name) headers["Mcp-Name"] = name;
  const body = {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": { tools: {}, events: {} },
      },
    },
  };
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const envelope = (await response.json()) as any;
  if (envelope.error) throw new Error(JSON.stringify(envelope.error));
  return envelope.result;
}
