
# a2a-mcp

Bidirectional **A2A ↔ MCP bridge** for ChatGPT and other MCP clients.

It exposes remote A2A agents as MCP tools, and also exposes ChatGPT-facing **MCP Events** so an A2A agent can initiate a message, wake a subscribed ChatGPT Work chat, and later retrieve ChatGPT's reply through the same A2A task.

## Why another bridge?

Three existing projects informed this implementation:

| Project | Strengths | Trade-offs | What this project keeps |
| --- | --- | --- | --- |
| [a2anet/a2a-mcp](https://github.com/a2anet/a2a-mcp) | Practical agent discovery, conversations, task/artifact access, simple deployment | Primarily MCP → A2A; local state and older MCP assumptions | Small tool surface, useful task/conversation semantics |
| [AmirK-S/a2a-to-mcp](https://github.com/AmirK-S/a2a-to-mcp) | MCP 2026-07-28, A2A 1.0.x, clean stateless outbound mapping, MCP Tasks | No ChatGPT MCP Events inbound path | Modern MCP/A2A wire conventions and minimal architecture |
| [aarushitandon0/a2a-mcp-bridge](https://github.com/aarushitandon0/a2a-mcp-bridge) | Strong task identity/recovery model, opaque handles, careful state mapping | More machinery than needed for a small bridge; no ChatGPT wake-up path | Explicit task correlation and recoverable inbound replies |

The design goal here is narrower: **one small bridge, no agent runtime, no background worker fleet, and durable IDs where recovery matters.**

## Architecture

For a tested Hermes deployment, see [Hermes Agent integration](docs/hermes.md).

### ChatGPT → A2A agent

```text
ChatGPT / MCP client
        │
        │ MCP tools
        ▼
     a2a-mcp
        │
        │ A2A JSON-RPC 1.0
        ▼
   Hermes / other A2A agent
```

Available tools:

- `a2a_list_agents`
- `a2a_get_agent`
- `a2a_send_message`
- `a2a_get_task`
- `a2a_cancel_task`

### A2A agent → ChatGPT

```text
Hermes
  │
  │ A2A SendMessage
  ▼
a2a-mcp ── persist task_id ──┐
  │                          │
  │ MCP Event webhook        │
  ▼                          │
ChatGPT Work chat            │
  │                          │
  │ a2a_reply_inbound        │
  └──────────────────────────┘
              │
              ▼
       A2A GetTask(task_id)
              │
              ▼
            Hermes
```

The inbound task is persisted **before** event delivery. If a webhook, ChatGPT session, or network connection is interrupted, the A2A caller still has a task ID and can recover with `GetTask`.

The ChatGPT-side event is:

```text
a2a.message.received
```

Its payload contains `task_id`, `context_id`, `sender`, `text`, and `received_at`.

## Protocols

- MCP: modern `2026-07-28`, with legacy stateless MCP handling provided by the SDK
- MCP Events: `events/list`, `events/subscribe`, `events/unsubscribe`
- A2A: JSON-RPC 1.0 method names such as `SendMessage`, `GetTask`, and `CancelTask`
- Legacy A2A slash aliases such as `message/send` and `tasks/get` are accepted inbound for compatibility

## Install

Requires Node.js 22.21+ (22.x) or 24.5+, for built-in HTTPS proxy support.

```bash
git clone https://github.com/kumaxs/a2a-mcp.git
cd a2a-mcp
npm ci
npm run build
```

Development:

```bash
npm run dev
```

Default endpoints:

- MCP: `http://127.0.0.1:8931/mcp`
- A2A: `http://127.0.0.1:8931/a2a`
- Agent Card: `http://127.0.0.1:8931/.well-known/agent-card.json`
- Health: `http://127.0.0.1:8931/health`

## Configuration

Configuration is intentionally environment-variable based.

| Variable | Purpose | Default |
| --- | --- | --- |
| `A2A_MCP_HOST` | Bind host | `127.0.0.1` |
| `A2A_MCP_PORT` | HTTP port | `8931` |
| `A2A_MCP_PUBLIC_BASE_URL` | Public/routable base URL advertised in the Agent Card | unset |
| `A2A_MCP_DATA_DIR` | Persistent task/subscription data | `~/.a2a-mcp` |
| `A2A_MCP_AGENTS` | JSON map of outbound A2A agents | `{}` |
| `A2A_MCP_BEARER_TOKEN` | Optional MCP bearer token | unset |
| `A2A_MCP_INBOUND_PEER_TOKENS` | JSON map of A2A peer name → bearer token | `{}` |
| `A2A_MCP_SUBSCRIPTION_TTL_MS` | Maximum event subscription lifetime | 7 days |
| `HTTPS_PROXY` / `https_proxy` | Optional trusted HTTP(S) proxy for MCP callback verification and delivery | unset |

Example outbound Hermes configuration:

```bash
export A2A_MCP_AGENTS='{
  "hermes": {
    "cardUrl": "http://127.0.0.1:9900/.well-known/agent-card.json",
    "headers": {
      "Authorization": "Bearer replace-me"
    }
  }
}'
```

Example inbound peer authentication:

```bash
export A2A_MCP_INBOUND_PEER_TOKENS='{
  "hermes": "replace-with-a-long-random-token"
}'
```

Do not commit real tokens.

## ChatGPT MCP Events

The server advertises `capabilities.events` through `server/discover` and implements:

- `events/list`
- `events/subscribe`
- `events/unsubscribe`

Subscription callbacks follow the OpenAI MCP Events webhook contract:

- HTTPS only
- callback challenge verification before persistence
- Standard Webhooks signatures
- `X-MCP-Subscription-Id`
- 256 KiB event payload limit
- bounded retry for transient failures
- DNS/IP validation to block private, loopback, link-local, and reserved callback targets
- no redirect following
- persisted subscriptions survive bridge restarts

A subscribed ChatGPT conversation should handle `a2a.message.received` by reading the inbound task, deciding on a response, then calling:

```text
a2a_reply_inbound(task_id, reply)
```

The A2A sender can then poll `GetTask(task_id)` and retrieve that exact reply.

## Active wake switch

MCP Events are intentionally **subscribed separately from active delivery**.

The bridge defaults to:

```text
active wake: OFF
```

With wake OFF:

- ChatGPT → A2A tools continue to work normally.
- Hermes → bridge messages are still persisted as inbound A2A tasks.
- Existing MCP Event subscriptions are preserved.
- No MCP Event webhook is delivered, so inbound Hermes messages do not actively wake ChatGPT.
- A2A `SendMessage` returns JSON-RPC error `-32016 ActiveWakeDisabled` instead of failing silently. Its error data includes `task_id`, `context_id`, `persisted: true`, and `wake_delivery: "disabled"`.

Use:

- `a2a_get_wake_status` to inspect the current state.
- `a2a_set_wake_enabled({ enabled: true })` to allow future inbound A2A messages to wake subscribed ChatGPT Work chats.
- `a2a_set_wake_enabled({ enabled: false })` to return to store-only mode.

The switch is persisted across bridge restarts. Enabling it does not replay older pending tasks; it only affects future inbound messages.

## Security model

- Listen on loopback unless you intentionally expose the bridge.
- Configure `A2A_MCP_BEARER_TOKEN` before exposing the MCP endpoint directly.
- Configure per-peer `A2A_MCP_INBOUND_PEER_TOKENS` before exposing the A2A endpoint.
- Callback URLs are HTTPS-only and are re-resolved/validated before each delivery.
- Secrets are stored only in the local data directory, written with restrictive file permissions.
- The bridge does not execute shell commands from A2A messages.
- Inbound A2A messages become data for ChatGPT; they are not treated as operator commands.

For private ChatGPT connectivity, an OpenAI Secure MCP Tunnel can expose only the MCP surface while keeping the bridge itself on a private machine. The A2A surface can remain on localhost or a private network reachable by the A2A agent.

## Current scope

Implemented in v0.1:

- outbound A2A discovery/message/task/cancel
- inbound A2A `SendMessage`, `GetTask`, `CancelTask`, `ListTasks`
- persistent inbound task/reply correlation
- MCP Events subscription + verified webhook delivery
- ChatGPT reply tool for inbound A2A tasks
- bearer authentication on both MCP and inbound A2A surfaces

Not yet implemented:

- A2A streaming
- A2A push-notification configuration
- file/data A2A parts on outbound messages
- OAuth authorization server for MCP

## Development

```bash
npm run typecheck
npm test
npm run build
```

The integration test covers the critical round trip:

```text
A2A SendMessage
→ persisted inbound task
→ MCP a2a_reply_inbound
→ A2A GetTask
→ correlated ChatGPT reply
```

## License

Apache-2.0.
