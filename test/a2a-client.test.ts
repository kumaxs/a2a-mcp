import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { A2AClient } from "../src/a2a-client.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

describe("outbound A2A client", () => {
  it("discovers a JSON-RPC agent and sends v1 SendMessage", async () => {
    let seenMethod = "";
    let seenVersion = "";
    let seenText = "";

    const server = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/.well-known/agent-card.json") {
        const address = server.address() as AddressInfo;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          name: "mock-agent",
          supportedInterfaces: [{
            protocolBinding: "JSONRPC",
            protocolVersion: "1.0",
            url: `http://127.0.0.1:${address.port}/rpc`,
          }],
        }));
        return;
      }
      if (req.method === "POST" && req.url === "/rpc") {
        seenVersion = String(req.headers["a2a-version"] ?? "");
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          seenMethod = body.method;
          seenText = body.params.message.parts[0].text;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              messageId: "reply-1",
              role: "ROLE_AGENT",
              parts: [{ text: "pong", mediaType: "text/plain" }],
            },
          }));
        });
        return;
      }
      res.writeHead(404).end();
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closers.push(
      () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    );

    const address = server.address() as AddressInfo;
    const client = new A2AClient({
      mock: {
        cardUrl: `http://127.0.0.1:${address.port}/.well-known/agent-card.json`,
        headers: {},
      },
    });

    const result = await client.sendMessage("mock", "ping") as any;
    expect(result.parts[0].text).toBe("pong");
    expect(seenMethod).toBe("SendMessage");
    expect(seenVersion).toBe("1.0");
    expect(seenText).toBe("ping");
  });
});
