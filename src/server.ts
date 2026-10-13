import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { A2AClient } from "./a2a-client.js";
import { InboundA2AServer } from "./a2a-server.js";
import type { BridgeConfig } from "./types.js";
import { EventManager } from "./events.js";
import { InboundTaskStore } from "./inbound-tasks.js";
import { createBridgeMcpHandler } from "./mcp.js";
import { constantTimeEqual, sha256Id } from "./utils.js";

const MAX_BODY_BYTES = 8 * 1024 * 1024;

export interface RunningBridge {
  url: string;
  close(): Promise<void>;
}

export async function startBridge(config: BridgeConfig): Promise<RunningBridge> {
  const a2a = new A2AClient(config.agents);
  const principal = config.mcpBearerToken
    ? sha256Id("principal", config.mcpBearerToken)
    : "anonymous";
  const events = new EventManager(config.dataDir, config.subscriptionTtlMs, undefined, principal);
  const inboundTasks = new InboundTaskStore(config.dataDir);
  const inboundA2A = new InboundA2AServer(config, inboundTasks, events);
  const mcp = createBridgeMcpHandler({ a2a, events, inboundTasks });

  const server = createServer((req, res) => {
    void route(req, res, { config, mcp, inboundA2A }).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const printableHost =
    config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host.includes(":") ? `[${config.host}]` : config.host;
  return {
    url: `http://${printableHost}:${address.port}`,
    async close() {
      await mcp.close();
      await closeServer(server);
    },
  };
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  services: {
    config: BridgeConfig;
    mcp: ReturnType<typeof createBridgeMcpHandler>;
    inboundA2A: InboundA2AServer;
  },
): Promise<void> {
  const origin = requestOrigin(req);
  const url = new URL(req.url ?? "/", origin);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { status: "ok", service: "@kumaxs/a2a-mcp", version: "0.1.0" });
  }

  if (req.method === "GET" && (url.pathname === "/.well-known/agent-card.json" || url.pathname === "/.well-known/agent.json")) {
    return json(res, 200, services.inboundA2A.agentCard(origin));
  }

  if (req.method === "POST" && url.pathname === "/a2a") {
    const body = await readJson(req);
    const result = await services.inboundA2A.handle(body, header(req, "authorization"));
    return json(res, 200, result, { "A2A-Version": "1.0" });
  }

  if (url.pathname === "/mcp") {
    if (!authorizedMcp(req, services.config.mcpBearerToken)) {
      return json(res, 401, { error: "Unauthorized" }, { "WWW-Authenticate": "Bearer" });
    }
    return serveMcp(req, res, services.mcp, origin);
  }

  return json(res, 404, { error: "Not found" });
}

async function serveMcp(
  req: IncomingMessage,
  res: ServerResponse,
  handler: ReturnType<typeof createBridgeMcpHandler>,
  origin: string,
): Promise<void> {
  const body = req.method === "GET" || req.method === "HEAD" ? Buffer.alloc(0) : await readBody(req);
  // Log only known method names: request arguments can contain messages and signing secrets.
  let observedMethod: string | undefined;
  try {
    const message = JSON.parse(body.toString("utf8")) as { method?: unknown };
    if (
      typeof message.method === "string" &&
      ["server/discover", "tools/list", "tools/call", "events/list", "events/subscribe", "events/unsubscribe"].includes(message.method)
    ) {
      observedMethod = message.method;
      console.info(JSON.stringify({ at: new Date().toISOString(), event: "mcp.request", method: observedMethod }));
    }
  } catch {
    // The protocol handler owns malformed-request errors.
  }
  const headers = new Headers();
  for (const [name, raw] of Object.entries(req.headers)) {
    if (raw === undefined) continue;
    for (const value of Array.isArray(raw) ? raw : [raw]) headers.append(name, value);
  }
  const init: RequestInit & { duplex?: "half" } = { method: req.method ?? "GET", headers };
  if (body.length > 0) {
    init.body = new Uint8Array(body);
    init.duplex = "half";
  }
  const response = await handler.fetch(new Request(new URL(req.url ?? "/mcp", origin), init));
  if (observedMethod) {
    let errorCode: number | undefined;
    let reason: string | undefined;
    if (observedMethod.startsWith("events/") && response.headers.get("content-type")?.includes("application/json")) {
      const envelope = await response.clone().json().catch(() => null) as {
        error?: { code?: unknown; data?: { reason?: unknown } };
      } | null;
      if (typeof envelope?.error?.code === "number") errorCode = envelope.error.code;
      const reportedReason = envelope?.error?.data?.reason;
      if (reportedReason === "challenge_failed" || reportedReason === "timeout") reason = reportedReason;
    }
    console.info(JSON.stringify({
      at: new Date().toISOString(), event: "mcp.response", method: observedMethod,
      status: response.status, ...(errorCode !== undefined ? { errorCode } : {}), ...(reason ? { reason } : {}),
    }));
  }
  const outgoing: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    outgoing[name] = value;
  });
  res.writeHead(response.status, outgoing);
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    res.write(Buffer.from(chunk.value));
  }
  res.end();
}

function authorizedMcp(req: IncomingMessage, expected: string | undefined): boolean {
  if (!expected) return true;
  const match = /^Bearer\s+(.+)$/i.exec(header(req, "authorization") ?? "");
  return !!match && constantTimeEqual(match[1]!, expected);
}

function requestOrigin(req: IncomingMessage): string {
  const forwardedProto = header(req, "x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto === "https" ? "https" : "http";
  const host = header(req, "x-forwarded-host")?.split(",")[0]?.trim() || req.headers.host || "127.0.0.1";
  return `${protocol}://${host}`;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const buffer = await readBody(req);
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  res.writeHead(status, { "Content-Type": "application/json", ...extraHeaders });
  res.end(JSON.stringify(body));
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
