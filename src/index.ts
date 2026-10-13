export { loadConfig } from "./config.js";
export { startBridge } from "./server.js";
export { A2AClient } from "./a2a-client.js";
export { EventManager, A2A_MESSAGE_EVENT } from "./events.js";
export { InboundTaskStore, toA2ATask } from "./inbound-tasks.js";
export type { BridgeConfig, AgentConfig, InboundTaskRecord, EventSubscription } from "./types.js";
