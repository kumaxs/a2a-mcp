import os from "node:os";
import path from "node:path";
import type { AgentConfig, BridgeConfig } from "./types.js";

const DEFAULT_PORT = 8931;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const publicBaseUrl = normalizeOptionalUrl(env.A2A_MCP_PUBLIC_BASE_URL);
  const mcpBearerToken = cleanOptional(env.A2A_MCP_BEARER_TOKEN);
  return {
    host: env.A2A_MCP_HOST || "127.0.0.1",
    port: parsePort(env.A2A_MCP_PORT),
    ...(publicBaseUrl ? { publicBaseUrl } : {}),
    dataDir: env.A2A_MCP_DATA_DIR || path.join(os.homedir(), ".a2a-mcp"),
    agents: parseAgents(env.A2A_MCP_AGENTS),
    ...(mcpBearerToken ? { mcpBearerToken } : {}),
    inboundPeerTokens: parseStringMap(env.A2A_MCP_INBOUND_PEER_TOKENS, "A2A_MCP_INBOUND_PEER_TOKENS"),
    subscriptionTtlMs: parsePositiveInt(env.A2A_MCP_SUBSCRIPTION_TTL_MS, DEFAULT_TTL_MS),
  };
}

function parseAgents(raw: string | undefined): Record<string, AgentConfig> {
  if (!raw) return {};
  const parsed = parseJsonObject(raw, "A2A_MCP_AGENTS");
  const result: Record<string, AgentConfig> = {};
  for (const [alias, value] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(alias)) {
      throw new Error(`Invalid A2A agent alias: ${alias}`);
    }
    if (typeof value === "string") {
      result[alias] = { cardUrl: requireHttpUrl(value, `A2A_MCP_AGENTS.${alias}`), headers: {} };
      continue;
    }
    if (!isObject(value) || typeof value.cardUrl !== "string") {
      throw new Error(`A2A_MCP_AGENTS.${alias} must be a URL string or {cardUrl, headers?}`);
    }
    const headers: Record<string, string> = {};
    if (value.headers !== undefined) {
      if (!isObject(value.headers)) throw new Error(`A2A_MCP_AGENTS.${alias}.headers must be an object`);
      for (const [key, headerValue] of Object.entries(value.headers)) {
        if (typeof headerValue !== "string") throw new Error(`Header ${key} for ${alias} must be a string`);
        headers[key] = headerValue;
      }
    }
    result[alias] = {
      cardUrl: requireHttpUrl(value.cardUrl, `A2A_MCP_AGENTS.${alias}.cardUrl`),
      headers,
    };
  }
  return result;
}

function parseStringMap(raw: string | undefined, name: string): Record<string, string> {
  if (!raw) return {};
  const parsed = parseJsonObject(raw, name);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string" || !value) throw new Error(`${name} values must be non-empty strings`);
    result[key] = value;
  }
  return result;
}

function parseJsonObject(raw: string, name: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} is not valid JSON: ${messageOf(error)}`);
  }
  if (!isObject(parsed)) throw new Error(`${name} must be a JSON object`);
  return parsed;
}

function parsePort(raw: string | undefined): number {
  if (!raw) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("A2A_MCP_PORT must be 1..65535");
  return port;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error("Expected a positive integer");
  return value;
}

function normalizeOptionalUrl(raw: string | undefined): string | undefined {
  const cleaned = cleanOptional(raw);
  return cleaned ? requireHttpUrl(cleaned, "A2A_MCP_PUBLIC_BASE_URL").replace(/\/+$/, "") : undefined;
}

function requireHttpUrl(raw: string, name: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${name} must use http or https`);
  return raw;
}

function cleanOptional(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result ? result : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
