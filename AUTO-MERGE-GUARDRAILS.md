# Auto-Merge Guardrails — Evidence Appendix

> **Source**: [#801](https://github.com/ranxianglei/billion-context/issues/801) "collect auto-merge material."
> **Method**: Pulled every issue, PR, and comment from all three repos (billion-context / billion-context-pi / acp-kernel) — 1,543 items, 1,072 PRs, 3,645 comments — then cross-referenced against this repo's 31 `devlog/` iteration records, the full git evolution recorded in `AGENTS.md`, and the commit-type distribution.
> **Goal**: Let ~90% of bugfixes auto-merge while holding the line on the overall direction.
> **Where this sits (important)**: The **authoritative text for these rules is [`AGENTS.md` §7](./AGENTS.md#7-review--auto-merge-discipline), Review & Auto-Merge Discipline** (loaded automatically every session, and the only operative reference). This file is strictly an **evidence appendix** — it preserves the baseline data, per-issue and per-PR provenance, the analysis of the recurring trouble spots, and the kernel-vs-this-repo ownership calls. **Any operational text for a rule, gate, or checklist lives in §7 and is deliberately not restated here**, so the two cannot drift apart. Scope is bounded: **this round changes this repo only**; cross-repo changes stay manual.

---

## 1. Baseline facts (what the data says)

| Fact | Data | What it means |
|------|------|------|
| Fixes are the main event | Non-merge commits: `fix:` 360 / `feat:` 117 / `docs:` 99 / `test:` 41 / `refactor:` 24 | Bugfixes are ~54% of the work — exactly what auto-merge needs to cover |
| Nothing is ever "rejected" | Closed-unmerged across all three repos: **0** | Humans either merge it or leave it open; nobody flatly says no. The risk is not "AI work gets rejected" — it is that **the remaining ~10% that needs rework jams the whole pipeline** |
| The rules were written after the fact | Nearly every hard rule in `AGENTS.md` traces to a specific incident (#377 two compression modes, #584 every problem gets an issue, version bumps only on release branches, auto-update ships a no-op version first) | Today's `AGENTS.md` is the sediment of having been burned. The implicit rules are now folded into §7 |
| AI work is hard to tell from human work | Only 55 PRs carry the `ework-agent-pr` marker; much of the early work was pushed directly with a ranxianglei PAT | Distinguishing AI from human has to rely on the `[bot] 🏷` prefix plus the marker — authorship will not tell you |

---

## 2. Rules established by hand (provenance for each)

> The rule text itself is in `AGENTS.md` §7.1–§7.3; what follows is only the evidence for *why each one exists*.

### A. Written down long ago (keep holding the line on these)
The four git prohibitions (no force-push to master, no merges, no `npm publish`, never print a PAT), branch naming `YYYY-MM-DD_short-title`, version bumps only on `*_release-v*` branches, the release process plus its no-op check, releasing acp-kernel before this project, issue-first with every problem reported, code quality (no `as any`, no hex escapes like `\x3c\x3e`, `loggerLog`), running e2e before touching the request pipeline, and thinking through both compression modes.

### B. Implicit rules (now folded into §7) — provenance for each
1. **Check for an existing fix before starting.** *Source*: #268 "there is probably already a PR that fixes this, check for duplicates". pi #311/#314 opened duplicate PRs under the same title.
2. **Rebase onto the latest master, then re-verify, then open the PR.** Watch out for **rebase order dependencies**. *Source*: #249/#221/#155/#479 each demanded re-verification against the latest master. **#479 is the clearest case**: the AI missed an order dependency — the test hardcoded `savedAt=9000/5000/8000` (1970), and it broke because another PR (#487) landed on master first. Only an independent human review caught it.
3. **Converge the scope: one issue, one topic.** *Source*: #247 "converge first — you own just this issue… I'll route the other problems to other agents". #640 batched sibling issues into one PR and closed the ones it superseded.
4. **Deliver a PR, not just a pushed branch.** *Source*: #282 "submit a PR, not a branch."
5. **Never silently drop or overwrite user config.** *Source*: in #155 a whitelist missed the `prompts` key, so saving from the web UI silently wiped the user's custom compression prompts. the fix was to return 400 on malformed input instead. See `devlog/context-window-fixes` (a failed read that still merged into `{}` = silent data loss).
6. **Fallback values have to be sensible.** *Source*: #282 "when detection fails, default to 200k with a floor of 100k — do not use 64k". `devlog/context-window-fixes` (a static table overriding the live registry = the freshness hierarchy inverted).
7. **Prefer the client's own stable identifier.** *Source*: #280 "session-id is the only thing that does not change and is bound to the current session… if you cannot get it from the client, report that."
8. **Separate the symptom from the mechanism.** *Source*: the "consecutive compression" report in #282 was actually upstream 429 rate limiting amplified by client retries producing a misleading log — not the compression mechanism running away.
9. **Output must be honest.** *Source*: #155's export printed "here is the raw conversation" for a 0-block session. it needed an honest message instead.
10. **Done means evidenced.** *Source*: #784 "did you review it?". #247 "two local reviews, then actually test the switch and observe whether it behaves as expected."
11. **Logs: redact credentials and grade verbosity.** *Source*: #247 (redaction in `hdrLog`, grading at B.3).
12. **Keep docs in sync across languages, and make them findable.** *Source*: #698 — the QQ group number was added in both Chinese and English across all three projects, and not buried at the bottom where nobody would see it.
13. **Cross-repo release order.** *Source*: #772 "ship a kernel version first, then this version". "the kernel has already merged."

---

## 3. What AI cannot reliably hold (where reviewers must focus, ordered by frequency)

| # | Category | Typical shape | Why AI tends to miss it |
|---|------|----------|------------------|
| 1 | **Cross-cutting and interaction effects** (highest severity) | Rebase order dependencies, concurrent PRs interfering, state drift after switching models or providers | AI reasons locally and cannot see global timing or concurrency |
| 2 | **Silent data-loss paths** | read-modify-write, config overwrite, persisted version migration | The happy path passes; data is lost only on the error or boundary path |
| 3 | **Protocol and wire fidelity** | tool_call id and ordering, SSE structure, `compaction_trigger` must be the last input item (#283) | You change the wire format, but a lenient local mock and a permissive CI will not catch it |
| 4 | **Identity and session stability** | Derived id vs native id, sticky sessions, mid-session switching | A derived id is fine in one scenario; only a switch exposes it |
| 5 | **Defaults and fallback judgment** | Unsound fallbacks, the precedence order of sources of truth | This is product judgment; AI tends to pick a value that "looks right" |
| 6 | **Symptom ≠ root cause** | Misleading logs, misattributed errors | It looks like A, but it is actually B (see #282) |
| 7 | **Process hygiene** | Scope creep, duplicated effort, pushing a branch without opening a PR, cross-repo ordering | Each action looks right in isolation; the combination violates the process |
| 8 | **User-facing judgment** | Doc wording, language, placement, honesty, UX defaults | Engineering-correct ≠ correct from the user's seat |

### 3.1 The recurring hot spot: PRs that needed a second review round (the data)

Counting "human review comment rounds" across 455 merged PRs: **229 with 0, 71 with 1, 26 with ≥2** — so roughly **7% (26 of the 326 that had any comment) needed a second or later human review round before merging**. Those are the hot spots. Of those, the ones that are actually **bugfixes** (not feats) are what auto-merge truly has to guard against:

| PR | Topic | Why it needed rework |
|----|------|--------------|
| #571 | hold client through long preflight | Diff explosion (#575 had the same problem), repeated rebase conflicts (#558/#593), docs put in the wrong section, env variables documented only in the English README, zh/CONFIGURATION.md missed |
| #467 | hard backstop plugin-mode overflow | Base was 43 commits behind; a per-line whitespace artifact (1280 off-by-one-space diffs) was caught in review |
| #517 | reject stale snapshots rollback | Same-file conflict with #587's rewrite of `src/persist.ts`; needed a semantic rebase |
| #425 | uncompressed baseline + clamp negative | Base stuck at 8/31; the openai split that a prior comment promised was never finished |
| #219 | stale context limits + registry-first | The first fix missed "under a proxy network, Node's fetch ignores http(s)_proxy, so registry fetch fails permanently"; the snapshot expanded from a projection to the full set |
| #428 | re-voice acp_summary as user | Required regression confirmation; the approach was overturned and moved back to the original issue |
| #360 | /acp panel persistent message | Repeated conflicts; "why build a whole new acp panel?" (approach challenged); Windows' ephemeral port range made tests flaky (changed to `listen(0)`) |
| #254 | preflight-compress on model switch | Needed a real A/B reproduction, not just a unit test |
| #657 | recover stale shim conversation id | Residual issues only surfaced during review |

**Two dominant causes** (the operative version is in `AGENTS.md` §7.5):
1. **Stale base, and contention on hot files**: a long-lived branch drifting away from a fast-moving master, or competing with another PR over the same hot file (`server.ts`, preflight, `persist.ts`, `agent/*` types). Signals: branch freshness, and whether another open PR touches the same file.
2. **An incomplete first pass**: only the reported symptom was treated, leaving adjacent paths and boundary cases unhandled — or work was promised and not finished — or the approach had to be redone. Signal: does the fix cover **every** path of the bug, or only the repro?

---

## Appendix: the owner's rulings, and the kernel-vs-this-repo ownership calls

**Settled**:
1. ✅ The rules and thresholds are folded into `AGENTS.md` as a new **§7 Review & Auto-Merge Discipline** (the single operative text).
2. ✅ Scope is bounded: **cross-repo changes stay manual** — the auto-merge thresholds apply to this repo only. Any acp-kernel bump, or any cross-repo change, is handled by hand.
3. "Auto-mergeable" first exists as a **reviewer checklist plus AGENTS.md thresholds**. Whether to promote it to a hard CI gate is deferred to a separate evaluation (it would mean changing CI, which is a different piece of work). When that happens, §7.4 governs.

**Kernel vs this repo — ownership calls** (the owner flagged one item that was still unplaced and needed a call on whether it belongs in the kernel or here):
- The only genuine ownership ambiguity is **wire format and fidelity of kernel-produced artifacts**. The call: **the format contract and the never-reuse-an-id guarantee belong to acp-kernel** (it produces and owns the ACP compression tags, block refs, the `acp_summary` structure, and the ref space). **this repo keeps only the host-side obligations** (consume faithfully: do not regenerate tool_call ids or ordering, do not trim the ref map, think through both compression modes).
- Basis: `AGENTS.md` §2 "Kernel Contract" already recorded never-reusing-ids as a kernel contract from the host's perspective. the wire-fidelity item in §7.3 marks this split explicitly.
- Disposition: the kernel-side formal spec **has already landed as a standalone acp-kernel PR** ([acp-kernel#303](https://github.com/ranxianglei/acp-kernel/pull/303), promoting "ref ids are never reused" plus the wire-artifact format contract to first-class invariants). the corresponding billion-context-pi PR is [pi#457](https://github.com/ranxianglei/billion-context-pi/pull/457).
