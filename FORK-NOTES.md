# FORK-NOTES — what sigma changed relative to upstream

> **Upstream:** [`billion-context`](https://github.com/ranxianglei/billion-context) by **ranxianglei** (MIT, © 2026).
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

## 1. The rename: `billion-context` to `sigma`

The project is named `sigma` to match the ranch stockyard theme used across the monorepo
(`tau`, `herd`, `flock`, `paddock`, `vansrouter`). Sigma is the summation sign, which is what
folding a long context is.

**What did not change, deliberately:** the binary is still `bili` and the npm package is still
`billion-context`. Renaming the shipped artifact would have broken every existing install for no
benefit. Only the *project* is renamed. The *artifact* is not. The Install section of `README.md`
has the details.

> **Worth knowing:** three different things carry names here. The npm package, the binary, and the
> repository are not the same name. `README.zh-CN.md` still carried the upstream name in its title
> and its badges until the commit that added this file. Another document naming
> `billion-context` as this project's own name is the same bug in a different place.

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

---

## Provenance of this file

- Fork commit: `218f31c2bcac06bdc5c2e2bd57b538b7e2ae6f8f` on `master`.
- Added by the commit that also corrected `README.zh-CN.md` and created
  `README.upstream.zh-CN.md`. That file preserves the previous contents of `README.zh-CN.md`
  verbatim. It holds upstream's README, kept as a record of the full upstream feature surface.
  The terse fork README does not cover that surface.
- Run `git show 218f31c^:<path>` to view how any file looked before the fork.
