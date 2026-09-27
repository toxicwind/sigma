# sigma

**Context compression for agent sessions that are too long to hold.**

An agent session that runs for a month accumulates hundreds of thousands of tokens of tool output, reasoning, and file reads. You cannot keep that in a context window, and you cannot throw it away either — the work is still depending on it. sigma sits between your agent and its model provider, compresses the old part of the conversation into a compact summary, and hands back a context that still works.

> **Upstream credit.** sigma is a fork of [billion-context](https://github.com/ranxianglei/billion-context) by **ranxianglei** (MIT, © 2026). The compression core, the ACP wire format, the per-host adapters, and the 12-agent compatibility surface are upstream's work. This fork is named `sigma`, and it exists to carry that code inside the sovereign monorepo, to translate the documentation into a single working language, and to keep the upstream pull mechanical rather than archaeological. See [FORK-NOTES.md](./FORK-NOTES.md) for exactly what we changed.

---

## Why another compression tool

Most "context management" for coding agents is a summarizer you invoke by hand. The model writes a summary, you paste it into a new session, and you lose every reference, every file path, and every decision that was made in the part you threw away.

sigma does three things differently:

**1. The model itself does the compression.** There is no separate summarizer call. During a normal turn, the agent already has the tool output in front of it. It writes the summary as part of the same inference, and sigma harvests it. The summary is written by the model that actually did the work, so it carries the reasoning rather than a post-hoc reading of it.

**2. Compression is a tool call, not a mode.** The agent decides to compress. It is a first-class tool in the agent's hands, the same as reading a file. The host implements it; the model calls it; the result is a range of the conversation that has been folded. The agent can also ask for a sub-range to be restored — the tool takes `startId`/`endId` and returns only that span's messages, so a compressed block is not an all-or-nothing door.

**3. The wire contract is explicit.** Compression is expressed in the ACP wire format, with a block reference map, a fold anchor, and explicit marker lines. That means the compressed form is inspectable, restorable, and testable. This repo has golden wire-contract tests for exactly this.

### Measured, not claimed

Numbers from the proxy log of a real month-long session (`~/.local/state/billion-context/bili.log`, 698 usage samples, 14 compress events):

| What | Measured |
|------|----------|
| A `compress` tool call executes in | **28 ms** (`04:02:58.426` request → `.454` executed) |
| Proxy local overhead per request | p50 **41 ms**, p90 81 ms, p99 107 ms, max 191 ms (n=692) |
| Prompt cache hit rate | p50 **99.5%**, p90 99.9%, p99 100% (n=677) |
| Live context dropped by one compress | **27,000 – 64,000 tokens** (every one of the 14 events) |
| Token reduction | **~5× fewer tokens** into the model |

The cache hit rate is the number that matters. A naive proxy that rewrites the request prefix on every turn destroys the provider's prompt cache and re-prefills the whole context. sigma re-sends an identical prefix and pays only for the new tail, which is why the local overhead is flat in context size.

---

## Install

```bash
npm install -g billion-context     # upstream name; the binary is `bili`
bili plugin install pi             # wire it into your agent
```

sigma ships as the `bili` binary and is a drop-in for the upstream package. The fork's own name is `sigma`; the binary name is unchanged on purpose, so an existing `bili` install keeps working when you point it at this build.

Requires **Node >= 20**. One runtime dependency, twelve dev dependencies.

---

## Which agents work

sigma speaks the protocol, not the product, so the adapter list is long and specific rather than aspirational. Each host has its own adapter under `src/agent/`:

| Host | Adapter | Notes |
|------|---------|-------|
| Claude Code | `claude-native-bootstrap.ts` | native bootstrap |
| Codex | `codex-compact.ts`, `codex-models.ts` | model snapshot pinned |
| OpenCode | `opencode-acp-command.ts`, `opencode-legacy.ts`, `opencode-native.ts`, `opencode-v2.ts` | four generations of the protocol, detected at runtime |
| pi | `pi.ts`, `pi-native.ts` | |
| omp | `omp.ts`, `omp-native.ts` | `BILLION_CONTEXT_NATIVE=omp` selects the native path |
| Gemini CLI | `src/loop/adapter-google.ts` | |
| Kimi | `src/kimi/` | |
| Qwen Code, Copilot CLI, TRAE, CodeBuddy, Qoder, Zcode | `src/loop/` + `src/zcode/` | |

---

## How the compression loop works

```
  agent  ──▶  proxy  ──▶  provider
            │  ▲
            │  └────── compressed context (blocks + fold anchor)
            │
            └─────── compress tool call  ──▶  agent harvests the summary
```

The loop in `src/loop/`:

1. `core.ts` runs the turn. When the agent emits a compress request, the proxy records the range and the fold point.
2. The agent's next turn arrives carrying the summary it wrote. The proxy swaps the compressed range for the summary plus its block reference map, and the fold anchor keeps the prefix byte-stable.
3. `adapter-anthropic.ts` / `adapter-openai.ts` / `adapter-responses.ts` / `adapter-google.ts` project the result onto each provider's wire format. The reasoning items, the tool call ordering, and the `compaction_trigger` position each have their own invariant; the tests enforce them.

The tool description itself (`src/compress-tool.ts`) tells the model the two rules that keep the format parseable: every summary has a hard character cap, and a summary line shaped like `📦 [ACP] Compressed …` is a proxy marker, not something the model should imitate. A single oversized summary fails the whole compression, so the budget is enforced in the tool, not hoped for in the prompt.

---

## Repo layout

```
src/
  compress-tool.ts          the tool definition the model sees
  compress-loop.ts          range bookkeeping: blocks, fold anchor, ref map
  compress-settings.ts      thresholds, budgets, trigger policy
  server.ts                 the proxy: request rewriting, usage accounting, nudge
  loop/                     the turn loop, one adapter per provider wire format
  agent/                    one adapter per host agent
  web/                      the /acp status panel
tests/
  golden/wire-contract/     byte-exact golden gates for the compressed wire form
  e2e/                      host-level end-to-end, including multilingual fixtures
```

The golden tests are the reason you can trust the format. They assert on bytes, not on behavior, so a change that would break a real agent's parser fails in CI instead of in someone's session.

---

## Upstream pull

`bin/upstream-pull.sh` is the fork's reason for existing upstream of the code. It exists because a three-way merge of `package.json` by the line matcher picks one side's `version` and the other side's `scripts` and hands you a file that parses but describes no real package.

`.gitattributes` therefore routes every structured file to `merge=weave`:

```
package.json       merge=weave
package-lock.json  merge=weave
*.json             merge=weave
*.yaml             merge=weave
*.toml             merge=weave
*.md               merge=weave
```

weave resolves at the level of entities, so a dependency that moved on both sides stays one dependency. The line matcher only ever sees source. On a real three-way `package.json` merge, weave-driver reports `property 'description': both modified` and emits conflict markers with `weave explain <file>` for per-hunk detail.

```bash
bin/upstream-pull.sh preview    # what moved, and which of it is structured
bin/upstream-pull.sh merge      # fetch, preview, merge upstream/master
bin/upstream-pull.sh sync       # merge, then push this fork
```

---

## Development

```bash
npm run build          # build dist/
npm test               # unit + golden wire-contract
npm run test:e2e       # host-level end-to-end
npm run typecheck
```

Run `npm test` before `test:e2e`. The e2e suite starts real agent processes, and the golden tests are the ones that will tell you the compression format is still correct.

---

## License

MIT. Copyright © 2026 ranxianglei (upstream), with fork modifications by the sovereign maintainers. See [LICENSE](./LICENSE).
