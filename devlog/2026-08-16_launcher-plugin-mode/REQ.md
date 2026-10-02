# REQ — launcher-first UX: native-plugin experience with zero persistent host config (#162)

## Request

The proxy form already works for most scenarios. The launcher funnels every action that would
otherwise "touch the host" into spawn parameters, so the user only changes which command they run
(`sigma claude` / `sigma codex`) and the experience is nearly identical to the local-plugin form. Zero
writes to host config files, zero effect on existing plugins, zero residue after uninstall. This is
the launcher form of the #161 plugin protocol (plugin-in-launcher, an inside/outside call and
response).

## Acceptance

- [x] `POST /__bili/plugin/register {conversationId, agent, identity}` — preregisters a session.
- [x] Dual binding strategy: identity (claude: every request where x-claude-code-session-id equals
      the registered id, so any ordering binds) / headless pending (a codex spawn: consumed by the
      next new session).
- [x] `sigma mcp` — an MCP stdio shim: manifest → 4 tools → /tool forwarding, with two sources,
      CLAUDE_CODE_SESSION_ID and SIGMA_CONVERSATION_ID.
- [x] `sigma plugin-register <id>` — a CLI subcommand for registration, as a hook fallback.
- [x] A launcher direct-URL mode (the default for claude/codex, with SIGMA_LAUNCHER_MITM=1 falling
      back to MITM).
- [x] claude: ANTHROPIC_BASE_URL passed straight through the env, plus a temporary JSON for
      --mcp-config (no --settings, no hooks).
- [x] codex: inline overrides of -c mcp_servers.sigma.* (measured: the 0.147 syntax is accepted).
- [x] Real-machine e2e: claude 2.1.227 launched through `sigma claude`, MCP natively calls
      acp_status, the proxy log shows `[plugin] tool acp_status executed via plugin`, and host
      config files receive zero writes.

## Non-goals

- Never persist writes to host config files (flags/env/temp files only).
- Does not replace omp native mode.
