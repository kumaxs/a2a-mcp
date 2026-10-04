import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";

const webhookAgentOptions: https.AgentOptions & { proxyEnv: NodeJS.ProcessEnv } = { proxyEnv: process.env };
const webhookAgent = new https.Agent(webhookAgentOptions);

export interface HttpResult {
  status: number;
  body: string;
}

export async function validatePublicHttpsUrl(raw: string): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("callback URL is invalid");
  }
  if (url.protocol !== "https:") throw new Error("callback URL must use HTTPS");
  if (url.username || url.password) throw new Error("callback URL must not contain userinfo");
  if (!url.hostname) throw new Error("callback URL has no hostname");

  const literalFamily = net.isIP(url.hostname);
  const resolved = literalFamily
    ? [{ address: url.hostname, family: literalFamily as 4 | 6 }]
    : await dns.lookup(url.hostname, { all: true, verbatim: true });

  if (resolved.length === 0) throw new Error("callback hostname did not resolve");
  for (const item of resolved) {
    if (!isPublicAddress(item.address)) {
      throw new Error(`callback hostname resolves to a non-public address: ${item.address}`);
    }
  }
  const preferred = resolved.find((item) => item.family === 4) ?? resolved[0]!;
  return { url, address: preferred.address, family: preferred.family as 4 | 6 };
}

export async function safeHttpsPost(
  rawUrl: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs = 10_000,
): Promise<HttpResult> {
  const target = await validatePublicHttpsUrl(rawUrl);
  return new Promise<HttpResult>((resolve, reject) => {
    const request = https.request(
      {
        protocol: "https:",
        // Connect (or proxy CONNECT) to the validated IP; retain the original TLS and HTTP identity.
        hostname: target.address,
        family: target.family,
        agent: webhookAgent,
        port: target.url.port ? Number(target.url.port) : 443,
        path: `${target.url.pathname}${target.url.search}`,
        method: "POST",
        servername: target.url.hostname,
        headers: {
          "Content-Length": Buffer.byteLength(body),
          ...headers,
          Host: target.url.host,
        },
        timeout: timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1024 * 1024) {
            request.destroy(new Error("callback response exceeds 1 MiB"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("callback timed out")));
    request.on("error", reject);
    request.end(body);
  });
}

export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return false;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return false;
  if (/^fe[89ab]/.test(lower)) return false;
  if (lower.startsWith("ff")) return false;
  if (lower.startsWith("2001:db8:") || lower === "2001:db8::") return false;
  if (lower.startsWith("::ffff:")) {
    const mapped = lower.slice("::ffff:".length);
    return net.isIP(mapped) === 4 && isPublicIpv4(mapped);
  }
  return true;
}
