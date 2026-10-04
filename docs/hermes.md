[Reading 155 lines from start (total: 155 lines, 0 remaining)]

# Hermes Agent integration

This is the reference topology used for the first real deployment on macOS.

```text
ChatGPT
  │ MCP 2026-07-28 + MCP Events
  ▼
a2a-mcp :8931
  │ A2A 1.0
  ▼
Hermes A2A :9900
```

Both services may stay on `127.0.0.1`. For ChatGPT access, use OpenAI Secure MCP Tunnel rather than opening the MCP port to the Internet.

## 1. Hermes inbound A2A

Enable the A2A platform in the Hermes profile:

```yaml
platforms:
  a2a:
    enabled: true
    extra:
      port: 9900
```

Use profile-scoped environment variables for the inbound credential:

```dotenv
A2A_PORT=9900
A2A_HOST=127.0.0.1
A2A_AGENT_NAME=hermes-dev
A2A_PEER_TOKENS=a2a-mcp:<bridge-to-hermes-token>
A2A_TRUSTED_PEERS=a2a-mcp
```

Keep the token out of Git.

## 2. Hermes outbound peer

Configure this bridge as an A2A peer:

```yaml
a2a_agents:
  chatgpt_bridge:
    url: http://127.0.0.1:8931
    auth:
      type: bearer
      token: "<hermes-to-bridge-token>"
    timeout: 120
    capabilities:
      - chatgpt
      - messaging
```

Use a different token in each direction.

## 3. Do not expose Hermes reasoning over A2A

Hermes can render reasoning/tool progress into platform responses even when the final answer is short. For an agent-to-agent boundary this is undesirable: the peer should receive the final response, not internal reasoning or progress text.

Add the A2A display override:

```yaml
display:
  platforms:
    a2a:
      show_reasoning: false
      interim_assistant_messages: false
      tool_progress: false
      long_running_notifications: false
```

Validate this explicitly. A useful smoke test is to ask the Hermes A2A endpoint to return a fixed short token and confirm the returned text contains only that token.

## 4. Bridge environment

Example:

```dotenv
A2A_MCP_HOST=127.0.0.1
A2A_MCP_PORT=8931
A2A_MCP_DATA_DIR=/path/to/private/a2a-mcp/data

A2A_MCP_AGENTS={"hermes-dev":{"cardUrl":"http://127.0.0.1:9900/.well-known/agent-card.json","headers":{"Authorization":"Bearer <bridge-to-hermes-token>"}}}

A2A_MCP_INBOUND_PEER_TOKENS={"hermes-dev":"<hermes-to-bridge-token>"}
```

The runtime environment file should be mode `0600`.

## 5. macOS launchd

Build first:

```bash
npm ci
npm run build
```

Run the built entry point under a LaunchAgent:

```text
node dist/cli.js
```

Recommended properties:

- `RunAtLoad=true`
- `KeepAlive.SuccessfulExit=false`
- explicit working directory
- stdout/stderr log files
- no credentials embedded in the plist; source a private runtime env file from a wrapper

Health check:

```bash
curl -fsS http://127.0.0.1:8931/health
```

Expected:

```json
{"status":"ok","service":"@kumaxs/a2a-mcp","version":"0.1.0"}
```

## 6. Bidirectional acceptance test

### Bridge → Hermes

1. Call `a2a_get_agent("hermes-dev")`.
2. Call `a2a_send_message` with a fixed reply token.
3. Confirm Hermes returns `TASK_STATE_COMPLETED`.
4. Confirm no reasoning marker or progress text is present.

### Hermes → bridge

1. From Hermes, call `a2a_call` against `chatgpt_bridge`.
2. Confirm the bridge creates one persistent inbound task.
3. Confirm its authenticated sender is `hermes-dev`.
4. Once ChatGPT is subscribed, confirm `a2a.message.received` wakes the Work chat.
5. Have ChatGPT call `a2a_reply_inbound(task_id, reply)`.
6. From Hermes, use A2A `GetTask(task_id)` and confirm the exact reply.

## 7. ChatGPT connection

For a private bridge, OpenAI Secure MCP Tunnel is the preferred transport. Point the tunnel target at:

```text
http://127.0.0.1:8931/mcp
```

Keep the tunnel runtime supervised. Do not reuse an existing tunnel by changing its local MCP target if that tunnel already backs another ChatGPT plugin; create a separate tunnel for this bridge.

[executed on device: Hermes-1.local (be49440c-1576-4e45-88f2-3b9f6aab1034)]

## 8. Active ChatGPT wake is opt-in

The bridge defaults to **wake OFF**. This separates ordinary A2A connectivity from the potentially metered ChatGPT Work execution triggered by MCP Events.

```text
OFF: Hermes -> persistent inbound task only
 ON: Hermes -> inbound task + MCP Event webhook -> subscribed ChatGPT Work chat
```

Subscriptions may remain configured while wake is OFF. Toggle it at runtime with:

- `a2a_get_wake_status`
- `a2a_set_wake_enabled`

The setting persists across restarts and applies only to future inbound messages.
