import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventManager, A2A_MESSAGE_EVENT, type EventTransport } from "../src/events.js";
import type { InboundTaskRecord } from "../src/types.js";
import { isPublicAddress } from "../src/webhook.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function secret(): string {
  return `whsec_${Buffer.alloc(32, 7).toString("base64")}`;
}

function task(sender = "hermes"): InboundTaskRecord {
  return {
    id: "task-1",
    contextId: "ctx-1",
    sender,
    text: "hello from hermes",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    state: "TASK_STATE_SUBMITTED",
  };
}

describe("MCP Events", () => {
  it("verifies, persists and delivers signed inbound A2A events", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "a2a-mcp-events-"));
    dirs.push(dir);
    const posts: Array<{ body: string; headers: Record<string, string> }> = [];
    const transport: EventTransport = {
      async validate(url) {
        expect(url).toBe("https://chatgpt.example/callback");
      },
      async post(_url, body, headers) {
        posts.push({ body, headers });
        const parsed = JSON.parse(body) as Record<string, unknown>;
        if (parsed.type === "verification") {
          return { status: 200, body: JSON.stringify({ challenge: parsed.challenge }) };
        }
        return { status: 204, body: "" };
      },
    };

    const first = new EventManager(dir, 60_000, transport);
    const subscription = await first.subscribe({
      name: A2A_MESSAGE_EVENT,
      arguments: { sender: "hermes" },
      delivery: { mode: "webhook", url: "https://chatgpt.example/callback", secret: secret() },
    });
    expect(subscription.id).toMatch(/^sub_/);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.headers["webhook-signature"]).toBeTruthy();

    // Re-open from disk to prove a restart does not lose the subscription.
    const restarted = new EventManager(dir, 60_000, transport);
    const result = await restarted.emitInboundMessage(task());
    expect(result).toEqual({ matched: 1, delivered: 1 });
    expect(posts).toHaveLength(2);
    const event = JSON.parse(posts[1]!.body) as any;
    expect(event.name).toBe(A2A_MESSAGE_EVENT);
    expect(event.data.task_id).toBe("task-1");
    expect(posts[1]!.headers["X-MCP-Subscription-Id"]).toBe(subscription.id);
  });

  it("applies subscription filters before delivery", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "a2a-mcp-events-"));
    dirs.push(dir);
    let calls = 0;
    const transport: EventTransport = {
      async validate() {},
      async post(_url, body) {
        const parsed = JSON.parse(body) as any;
        if (parsed.type === "verification") {
          return { status: 200, body: JSON.stringify({ challenge: parsed.challenge }) };
        }
        calls += 1;
        return { status: 204, body: "" };
      },
    };
    const manager = new EventManager(dir, 60_000, transport);
    await manager.subscribe({
      name: A2A_MESSAGE_EVENT,
      arguments: { sender: "other-agent" },
      delivery: { mode: "webhook", url: "https://chatgpt.example/callback", secret: secret() },
    });
    expect(await manager.emitInboundMessage(task("hermes"))).toEqual({ matched: 0, delivered: 0 });
    expect(calls).toBe(0);
  });
});

describe("webhook destination policy", () => {
  it("rejects private and reserved addresses", () => {
    expect(isPublicAddress("127.0.0.1")).toBe(false);
    expect(isPublicAddress("10.1.2.3")).toBe(false);
    expect(isPublicAddress("192.168.1.2")).toBe(false);
    expect(isPublicAddress("169.254.1.1")).toBe(false);
    expect(isPublicAddress("::1")).toBe(false);
    expect(isPublicAddress("fc00::1")).toBe(false);
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });
});
