# FORK-NOTES — what sigma changed relative to upstream

> **Upstream:** [`sigma`](https://github.com/ranxianglei/sigma) by **ranxianglei** (MIT, © 2026).
> **This fork:** `sigma`, carried inside the sovereign monorepo.
>
> `README.md` links here for the question of exactly what we changed. This file is that answer.
> Every claim below names its backing commit or line.

## The short version

sigma is a **rename, a merge-mechanism, a documentation rewrite, and a language consolidation**.
It is **not** a fork of the compression engine. The compression core, the ACP wire format, the
per-host adapters, and the compatibility surface are upstream's work and are unchanged.

All of it landed in a single commit: **`218f31c`**, titled *"feat: rename to sigma, credit upstream,
and document the measured budget"*. It touched 51 files, with 1127 insertions and 1860 deletions.
There is no second fork-specific commit. Anything not in `218f31c` is upstream's.

---

## 1. The rename: `sigma` to `sigma`

The project is named `sigma` to match the ranch stockyard theme used across the monorepo
(`tau`, `herd`, `flock`, `paddock`, `vansrouter`). Sigma is the summation sign, which is what
folding a long context is.

**Full-blown rename in progress:** the binary is now `sigma` (with `sigma` preserved as
a backward-compatible alias) and the package exports `sigma` CLI commands. The live
compression proxy, agent integration, and repository are unified under `sigma`.
`sigma` and `sigma` references remain as legacy aliases where needed for
zero-downtime wire compatibility.

## 2. A real upstream-pull mechanism: `bin/upstream-pull.sh` (new, 121 lines)

This is the fork's reason for existing upstream of the code. Upstream moves fast, and this fork
carries local changes. The script exists because a naive `git pull --rebase` is the wrong tool here.

It offers three explicit steps rather than one automatic pull:

```bash
bin/upstream-pull.sh preview    # fetch, report what moved, no local change
bin/upstream-pull.sh merge      # fetch, preview, then merge upstream/master
bin/upstream-pull.sh sync       # merge, then push this fork's branch
```

Two design decisions are load-bearing. Both are documented in the header of the script.

First, **structured files need an entity-aware merge.** A three-way merge of `package.json` by the
line matcher picks one side's `version` and the other side's `scripts`. The result parses, but it
describes no real package. This failure is the specific reason the script exists.

Second, **the pull is three steps by design, not one.** When upstream moves fast and the manifest
was merged by hand, you want to see the conflicts first.

`require_weave_driver()` checks that weave is installed **before** merging, not after. If
`.gitattributes` routes structured files to an absent driver, the merge silently does the wrong
thing. Catching that pre-flight is the whole point of the check.

Three environment variables override the defaults.

- `UPSTREAM_REMOTE` defaults to `upstream`
- `UPSTREAM_BRANCH` defaults to `master`
- `FORK_REMOTE` defaults to `fork`

## 3. `.gitattributes` (new, 21 lines) — structured merge and Windows golden safety

Two unrelated problems share one file.

**Structured files route to `merge=weave`.** Git invokes the weave driver for them. The line matcher
then only ever sees source.

```
package.json       merge=weave
package-lock.json  merge=weave
*.json             merge=weave
*.yaml             merge=weave
*.yml              merge=weave
*.toml             merge=weave
*.md               merge=weave
```

Binary and asset files are marked explicitly. No driver ever gets bytes it cannot read:

```
*.node -merge binary
*.wasm -merge binary
*.png  -merge binary
*.jpg  -merge binary
*.pdf  -merge binary
```

**Byte-exact golden snapshots are pinned to LF** via `tests/golden/wire-contract/*.json text eol=lf`.
Without it, Git-for-Windows' default `autocrlf=true` converts them to CRLF at checkout. The
byte-equal golden gates then fail on every Windows CI run. This is issue #1305.

## 4. `README.md` rewritten (1327 lines changed, roughly 1340 down to 148)

The old README was upstream's. It was long, badge-heavy, and largely a list of claims. The new one
is shorter and organized around **measured numbers instead of claims**.

**Measured, from the proxy log of a real month-long session.**

| What | Measured |
|------|----------|
| A `compress` tool call executes in | **28 ms** (`04:02:58.426` request to `.454` executed) |
| Proxy local overhead per request | p50 **41 ms**, p90 81 ms, p99 107 ms, max 191 ms (n=692) |
| Prompt cache hit rate | p50 **99.5%**, p90 99.9%, p99 100% (n=677) |
| Live context dropped by one compress | **27,000 to 64,000 tokens** (all 14 events) |
| Token reduction | **~5x fewer tokens** into the model |

That log holds 698 usage samples and 14 compress events.

The README argues that the cache hit rate is the number that matters. A naive proxy rewrites the
request prefix every turn. That destroys the prompt cache and re-prefills everything. sigma
re-sends an identical prefix and pays only for the new tail. Its overhead stays flat as the
context grows.

`README.md` also carries the explicit **upstream credit** paragraph, and it links here.

## 5. Language consolidation in the devlog and source comments

The fork's stated job is to carry the code and speak one working language in the engineering
record. Chinese prose in `AGENTS.md`, `CHANGELOG.md`, the `devlog/` records, and inline source
comments was translated. Two examples from `218f31c`:

```
AGENTS.md §7.1   #571 "diff-爆炸"     ->  #571 "diff explosion"
AGENTS.md §7.5   "重灾区"              ->  "the recurring trouble spots"

CHANGELOG.md     直连（默认）          ->  "Direct (default)"
```

The `AGENTS.md` §7.4 change is the interesting one. The original named a distinction that has no
English shorthand, and named it with two ideographs. The replacement carries the same meaning
across in an English idiom. The distinction is the point, so the translation had to preserve it
rather than flatten it.

```
AGENTS.md §7.4   (疏, not 堵)
              -> (dredge the channel, don't dam it)
```

About 30 `devlog/**/REQ.md`, `WORKLOG.md`, and `DESIGN.md` files were translated the same way, as
were inline comments in `src/agent/pi.ts`, `src/agent/shared.ts`, `src/config.ts`,
`src/fetch-util.ts`, `src/loop/core.ts`, `src/plugin.ts`, and `src/server.ts`.

## 6. What was deliberately left in Chinese

The consolidation above is **not** a purge. Chinese remains intentional and load-bearing in four
places.

**The `*.zh-CN.md` user-facing documents.** These are `README.zh-CN.md`, `CONFIGURATION.zh-CN.md`,
`SESSION-IDENTITY.zh-CN.md`, and `TECHNICAL-NOTES.zh-CN.md`.

**The `paper/` directory**, including `paper/模型驱动的分层增量压缩-免训练多代上下文管理.md`.

**The zh-CN locale map.** `src/web/i18n.ts` declares `export type Locale = "zh-CN" | "en"`, and
**zh-CN is the fallback**. Lookups resolve through the `zh-CN` bucket first. See the lookup at
`src/web/i18n.ts:261`. Chinese is a first-class supported locale here, not a vestigial one.

**CJK test fixtures.** Many suites under `tests/` assert on Chinese text. Translating them would
have destroyed coverage rather than preserved it.

The rule behind this split: prose *about the engineering* is English. Prose *for the user* is
translated. Fixtures stay as they are. `README.zh-CN.md` is user-facing. It gets translated.

## 7. Fork-original code: the preflight wall-clock ceiling

Sections 1 through 6 are mostly rename, tooling, and prose. This one is **new code with no upstream
counterpart**, and it exists because the fork runs against a compression proxy serving a real
workload rather than only its test suite.

**The defect.** `MAX_SUMMARY_CALLS_PER_PREFLIGHT` in `src/preflight.ts` bounds summarization
**calls**, so it bounds latency only while the upstream answers quickly. Measured off a 26,403-line
`~/.local/state/sigma/sigma.log`: one invocation spent **330,735 ms** across 3 ranges at
roughly **44 tokens/second**, and its result was discarded when the client disconnected mid-flight.
Five such aborts accounted for 383 of 862 seconds of total preflight time in the sample. The
normal path in the same log is a 29 ms median over 3,071 requests.

**The fix.** `compress.maxPreflightMs` (default `30000`, settable at the global, provider, and model
level, `0` disables) is the wall-clock counterpart. It rides on `PreflightDeps` rather than
`Config.compress`, because the kernel's compress config is a closed validation surface that
rejects unknown keys. Exceeding it ends the walk and fails the turn fast with a **retryable 502**,
under a new `"timeout"` failure kind that is deliberately distinct from `"exhausted"`: a slow
upstream is not a content dead end, so it earns no dead-end cooldown.

**A second defect the same investigation found.** The success log printed `~699 tokens saved` beside
the pair `201098 -> 211564` — a saving next to numbers that had *grown*. `savedTokens` came from the
preflight's own estimator while the printed pair mixed in `session.stats.lastInputTokens`, which
the fold itself raises by re-inserting the summaries it just wrote. `PreflightResult` now carries
`startTokens` and `endTokens` measured the same way, and the log labels both pairs.

Tests live in `tests/preflight-wall-clock-ceiling.test.ts` (a slow upstream is cut short by the
ceiling; `0` restores the call budget) and in `tests/compress-settings.test.ts` (the key survives
the per-field merge, which is where it was silently dropped the first time).

## 8. Fork-original code: OpenRouter context-window discovery

The section above bounds the damage when a window is wrong. This one removes a whole class of the
error. Upstream ships a static family table, `CONTEXT_LIMIT_TABLE` in `src/config.ts`, keyed on
model-name roots. A `vendor/model` id from a provider upstream never heard of falls through every
entry and lands on the 200,000 default.

**Why a family table is the wrong instrument here.** The table guesses from a *name*. OpenRouter
publishes a *fact*. `GET https://openrouter.ai/api/v1/models` returns 458 models, each carrying
`context_length` and `top_provider.max_completion_tokens`. A measured case, from the proxy's own
startup log:

```
model=stealth/space-bunny-alpha source=default native=none effective=200000
  launcher=none configured=none peek=none fallback=true
```

OpenRouter serves that model at **1,000,000**. So the log above records `usage=526%` for a session
that was never near the limit, and preflight spends up to 330,735 ms compressing a payload that fit.

**The change.** `src/registry.ts` gained a second background cache beside the models.dev one, with
the same residency discipline:

```
export async function loadOpenRouterModels(): Promise<void>
export function peekOpenRouterContext(model: string | undefined): number | undefined
export function peekOpenRouterOutputLimit(model: string | undefined): number | undefined
```

`src/server.ts` calls `void loadOpenRouterModels()` next to the existing `void loadRegistry()`. The
request path only ever *reads* the cache. A failed or unreachable OpenRouter logs a warning and
changes nothing.

**Where the published window ranks.** It outranks the family table and sits below client-reported,
plugin-reported, and operator-declared windows:

```
betaWindow ?? suffixWindow ?? pluginWindow ?? runtimeWindow ?? launcherWindow
  ?? configuredWindow ?? peekWindow ?? publishedWindow ?? lookupContextLimit(model)
```

Two deliberate constraints. It never overrides the launcher's per-model window, because
`src/server/context-window.ts` holds that the client's own number is authoritative: it is what the
client itself truncates at. And a model OpenRouter does not publish falls through to the table
unchanged, because a sibling model in the same family can serve a different window entirely.

Tests live in `tests/openrouter-published-window.test.ts`. They pin both directions: a published
128,000 beats a table entry of 1,000,000, and a published 2,000,000 raises the same entry. One pins
the absence case, so an unpublished id cannot be silently resolved from a near neighbour.


## 9. Fork-original code: bounded summary output, applied instead of discarded

This section covers the change that fixed a hard 502 reported on 2026-09-27. Sections 7 and 8
fixed a hang and a wrong window. This one fixed a summary that could not be used.

The defect, read from the source rather than guessed at. `CHUNK_FRACTION` and `MIN_CHUNK_TOKENS`
in `src/preflight.ts` bound the summarizer's **input** per chunk, not its output. `summarizeRange`
stated no output budget, so a model that felt like writing 35,000 characters about a chunk worth
2,000 tokens of input could, and did. The assembled summary then failed the kernel's
`maxSummaryLength` of 20,000, and the only recovery was the unusable path, which skips the range.
When the range sat below the halving floor of `2 * MIN_CHUNK_TOKENS` there was nothing left to
retry, so the turn failed. The user-visible error named the cap and the budget, and read as a
content problem. It was not. It was a length instruction that was never issued.

The fix works at both ends, because either alone leaves a gap.

**At the source, the budget is now stated.** `summarizeRange` takes a per-part character budget and
includes it in the prompt. The caller divides `maxSummaryLength` across the chunk count and
subtracts the join separators, so the sum of every part lands under the cap by construction. A
compliant model needs no intervention at all.

**At the backstop, the assembly is trimmed, not vetoed.** An assembled summary over the cap is cut
at a sentence boundary and applied. The reasoning is that the kernel checks the *final* length, so
a trimmed summary is accepted where the whole one was refused. Discarding it cost an entire fold
and saved nothing, because the request still went out and came back over budget. Before this
change, eleven over-length assembled summaries were recorded on live traffic, ranging from 20,659
to 45,204 characters, three of them exactly 35,246 against the 20,000 cap. Two became hard 502s.

Atomicity is unchanged where it earns its keep. A segment that returns nothing still discards the
whole range, and a cap too small to hold a usable summary after a trim still discards it. Applying
a partial fold is the one outcome that is never allowed, because the kernel would then own a block
whose provenance it cannot describe.

The regression test pins the new behavior and was proven to fail without it. One pre-existing
assertion had to be inverted rather than deleted: it asserted that an over-limit summary left the
original tool result uncovered, which is the behavior this change removes. It still asserts the
coverage invariant that mattered, namely that the range is covered completely or not at all.

---


## Provenance of this file

- Fork commit: `218f31c2bcac06bdc5c2e2bd57b538b7e2ae6f8f` on `main` (the branch was
  `master` at that commit and was renamed later; `backup/main-20260927` preserves the
  pre-rename tip).
- Added by the commit that also corrected `README.zh-CN.md` and created
  `README.upstream.zh-CN.md`. That file preserves the previous contents of `README.zh-CN.md`
  verbatim. It holds upstream's README, kept as a record of the full upstream feature surface.
  The terse fork README does not cover that surface.
- Run `git show 218f31c^:<path>` to view how any file looked before the fork.
- Sections 7 and 8 document **fork-original code**, not a diff against upstream. Neither feature
  exists in `sigma`. They are listed here so a reader knows that sections 7 and 8 describe
  additions, while sections 1 through 6 describe a rename and a consolidation.
