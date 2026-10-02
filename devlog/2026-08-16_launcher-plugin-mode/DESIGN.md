# DESIGN — launcher plugin mode (#162)

## Topology

```
sigma claude / sigma codex (launcher, direct-URL mode)
  ├─ ensure proxy (spawn/reuse 127.0.0.1:8787)
  ├─ claude: env ANTHROPIC_BASE_URL=http://<proxy>/sigma/<upstream>
  │          --mcp-config <tmp json> {mcpServers.sigma → node dist/mcp.js}
  ├─ codex:  -c mcp_servers.sigma.command/args/env (inline TOML overrides)
  └─ (SIGMA_LAUNCHER_MITM=1 → old transparent-MITM route instead)
        ↓ exec host
host (claude/codex)
  ├─ LLM traffic   → proxy /sigma/<upstream> (data channel)
  └─ MCP "sigma"    → dist/mcp.js stdio
        ├─ GET  /__bili/plugin/manifest  (schemas, zero drift)
        ├─ POST /__bili/plugin/register  (bind BEFORE first model request)
        └─ POST /__bili/plugin/tool      (execute under session lock)
```

## Session binding — two strategies, one endpoint

`POST /__bili/plugin/register {conversationId, agent, identity}`:

- **identity: true** (claude code): the host puts the SAME id on every model
  request — `x-claude-code-session-id` === `CLAUDE_CODE_SESSION_ID` (verified
  against claude 2.1.227 via raw-socket header capture; the env var is passed
  to MCP children, the header on every request). The registration lands in a
  `registeredIds` map; ANY later request whose conversation identity matches
  binds its session into plugin mode. No ordering race: claude -p fires its
  first model request concurrently with MCP initialize — identity binding
  catches up on the second request.
- **identity: false** (headless, launcher-spawned codex): the registration
  queues; the first request that creates a NEW session consumes it (FIFO).
  Order-sensitive: the shell awaits the register before answering MCP
  initialize, so hosts that wait for initialize cannot race past it.

Splitting the two (instead of double-writing both structures) keeps a foreign
session from eating a registration it can never claim by identity.

## Direct-URL vs MITM

Direct URL is now the default for `sigma claude` / `sigma codex`: the host talks
to the proxy via the `/sigma/` prefix in its base URL — no MITM, no CA trust.
Claude's base URL rides on spawn env (ANTHROPIC_BASE_URL), codex's on
`-c model_providers.*.base_url` (user config already covers routing; the
launcher only adds the mcp_servers.sigma.* overrides). `SIGMA_LAUNCHER_MITM=1`
restores the old transparent route for OAuth-subscription traffic.

## Verification notes

- claude 2.1.227 passes `CLAUDE_CODE_SESSION_ID` to MCP children (env probe)
  and `x-claude-code-session-id` on every request (socket capture) — the two
  are equal, which is what makes identity binding race-free.
- codex 0.147.0 accepts `-c mcp_servers.sigma.command="node"` style overrides
  (config parse error disappears; only provider routing failed our e2e because
  the local relay lacks a Responses endpoint — unrelated to the MCP surface).
- Real e2e: `sigma claude -p "call the sigma acp_status tool"` through a bailian
  anthropic endpoint — proxy log shows `[plugin] tool acp_status executed via
  plugin`, i.e. the native MCP path, not wire injection.
