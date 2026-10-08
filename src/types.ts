export type JsonObject = Record<string, unknown>;

export interface AgentConfig {
  cardUrl: string;
  headers: Record<string, string>;
}

export interface BridgeConfig {
  host: string;
  port: number;
  publicBaseUrl?: string;
  dataDir: string;
  agents: Record<string, AgentConfig>;
  mcpBearerToken?: string;
  inboundPeerTokens: Record<string, string>;
  subscriptionTtlMs: number;
}

export interface AgentCard {
  name: string;
  description?: string;
  version?: string;
  supportedInterfaces?: Array<{
    url: string;
    protocolBinding?: string;
    protocolVersion?: string;
  }>;
  url?: string;
  capabilities?: JsonObject;
  skills?: unknown[];
  [key: string]: unknown;
}

export interface InboundTaskRecord {
  id: string;
  contextId: string;
  sender: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  state:
    | "TASK_STATE_SUBMITTED"
    | "TASK_STATE_WORKING"
    | "TASK_STATE_COMPLETED"
    | "TASK_STATE_CANCELED"
    | "TASK_STATE_FAILED";
  reply?: string;
  metadata?: JsonObject;
}

export interface EventSubscription {
  id: string;
  owner: string;
  name: string;
  arguments: Record<string, unknown>;
  url: string;
  secret: string;
  createdAt: string;
  refreshBefore: string | null;
}
