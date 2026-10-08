#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { startBridge } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  if ((config.host === "0.0.0.0" || config.host === "::") && !config.mcpBearerToken) {
    console.warn("warning: MCP is bound beyond loopback without A2A_MCP_BEARER_TOKEN");
  }
  if ((config.host === "0.0.0.0" || config.host === "::") && Object.keys(config.inboundPeerTokens).length === 0) {
    console.warn("warning: inbound A2A is bound beyond loopback without peer tokens");
  }

  const bridge = await startBridge(config);
  console.log(`a2a-mcp listening at ${bridge.url}`);
  console.log(`MCP: ${bridge.url}/mcp`);
  console.log(`A2A Agent Card: ${bridge.url}/.well-known/agent-card.json`);

  const shutdown = async () => {
    await bridge.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
