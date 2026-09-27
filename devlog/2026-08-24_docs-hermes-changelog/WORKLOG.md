# WORKLOG - Docs update for v0.1.47–v0.1.50 (hermes launcher + changelog backfill)

- Task ID: `2026-08-24_docs-hermes-changelog`
- Home Repo: `billion-context`
- Status: Done
- Updated: 2026-08-24

## 1. Summary

- **What was done**: docs-only update across README.md, README.zh-CN.md,
  CHANGELOG.md, AGENTS.md.
- **Why**: the docs lagged three releases behind; the launcher section
  documented 3 of 6 supported clients and CHANGELOG had no entries for
  0.1.41–0.1.49.
- **Behavior / compatibility changes**: none — documentation only;
  package.json untouched.

## 2. Facts verified from source (not guessed)

- Launcher env per client (src/launcher.ts runLaunch switch):
  - pi/omp: `buildPiEnv` → HTTPS_PROXY + NODE_EXTRA_CA_CERTS; omp rides an
    isolated `PI_CODING_AGENT_DIR` temp copy of `~/.omp/agent/models.yml`.
  - codex: HTTPS_PROXY + SSL_CERT_FILE (combined-ca.pem).
  - claude: undici ignores HTTPS_PROXY → `ANTHROPIC_BASE_URL` /bili/ form.
  - opencode: HTTPS_PROXY + NODE_EXTRA_CA_CERTS + `OPENCODE_CONFIG` temp
    opencode.json (HTTP→/bili/, plugin appended, BILLION_CONTEXT_PROXY
    self-disable signal).
  - hermes: no MITM (httpx/certifi ignores SSL_CERT_FILE) → isolated
    `HERMES_HOME`, every upstream /bili/, skills/memories/sessions shared
    via symlinks, CRLF preserved, loud warnings on no-provider/rewrite-fail.
- Config discovery paths (src/client-config.ts): `~/.omp/agent/models.yml`,
  `~/.hermes/config.yaml`, `~/.config/opencode/opencode.json`.
- Version→PR mapping derived from `git log --merges vX..vY` per tag
  (v0.1.41 … v0.1.49), titles cross-checked with `gh pr list --state merged`.

## 3. Changes

- README.md: 6-client launcher heading + usage block; redirect/CA table
  (+omp/+opencode/+hermes rows, claude ride-along note); discovery table
  (+3 rows); new "isolated temp config" subsection; port-reuse note fixed
  per #216 ("always spawns a fresh instance").
- README.zh-CN.md: launcher client list one-liner; follow-up commit added a
  full 「方式 0 —— 启动器」 chapter (six clients, redirect/CA + discovery
  tables, isolated-temp-config pattern) and a quickstart bullet
  (两种方式 → 三种方式).
- Third commit: plugin-install parity — README.md lead rewritten (install is
  optional; pi/omp = native plugins, claude/codex/opencode = MCP bridge,
  hermes = none; launcher needs no install), README.zh-CN.md gained the
  entire missing install block (commands, thin-plugin note, kill switch,
  launcher note). Facts verified: PLUGIN_AGENTS=[pi,omp,claude,codex,opencode]
  (src/plugin-install.ts:22), plugin install|remove|list actions (src/cli.ts),
  *.bili-bak once-backup (src/plugin-install.ts:38), launcherInjectMcp gates
  MCP injection to claude/codex via BILI_LAUNCHER_PLUGIN=1; opencode launcher
  auto-injects via OPENCODE_CONFIG (src/launcher.ts:357).
- CHANGELOG.md: [Unreleased] += #222 (thinking-replay degraded retry),
  #223 (hermes launcher, under Features), #224 (SSE name-split,
  buffer-to-finish). Backfilled [0.1.41]–[0.1.49] sections with PR numbers
  and dates from tags.
- AGENTS.md: module map regenerated (src/loop/ adapters, launcher.ts,
  client-config.ts, mitm.ts/ca.ts, mcp.ts, plugin*.ts, registry*,
  upstream-proxy.ts, agent/, web/); tests count 66; cli.ts description
  start/update/export/test/plugin + launchers.

## 4. Verification

- `git diff --stat` shows exactly 4 .md files (+162/−18), no code, no
  version field — safe for version-guard CI.
- CHANGELOG heading sequence checked (one Features + one Fixes subsection
  per release block; Unreleased has Features then Fixes, no duplicates).

## 5. Follow-ups

- README.zh-CN.md launcher chapter added in the follow-up commit — done, no
  longer pending.
- When PR #225 (v0.1.50) merges, move the [Unreleased] block into
  `[0.1.50] — <merge date>` in the next docs pass.

## Follow-up 5: review fixes after the user rewrote README.zh-CN.md

The user slimmed the Chinese README down directly in the GitHub web UI, cutting 87 lines. The
method sections 0/A/B/C became sections 1/2/3, the plugin-mode/table/Web UI sections were deleted,
and the install command block moved into the launcher section. The review found three defects, all
fixed in e6e481d plus 9a52eca:

1. The opening said "2 种方式" (two ways) while the document actually had three sections → changed to
   "3 种方式" and added the third bullet (editing the config file by hand).
2. A dead anchor at line 349, `#方式-a-零配置bili-前缀`, pointed at a heading that had changed →
   replaced with a plain-text reference to 「方式 2 —— 改url」.
3. A leftover TODO line → turned into a real body section, 「什么时候才需要 install?」, covering
   what compression never needs (wire injection is the fallback), what the launcher never needs, and
   when an install is actually required (editing the url and wanting the native panel). After an
   install, pi/omp/opencode gain /acp, claude/codex gain the MCP tools but no /acp, and hermes is
   limited to wire. Without an install the model can still call acp_status.

The user's editorial choice was respected, so nothing deleted was restored. Removing the Web UI
section was the user's decision, and the product feature still exists.
