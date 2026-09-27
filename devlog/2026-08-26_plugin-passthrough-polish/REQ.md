# REQ

After the user merged PR #259, they asked for the small unhandled items (non-blocking review notes)
left over in the comments on the three PRs (#257 / #258 / #259).

Sources (review comments):
1. #259 review note 1: `pipePluginJson` (the non-streaming plugin path) still forwards verbatim,
   which leaves a parity gap against the compress loop's JSON branch (`compressLoopResponsesJson`
   strips every round). Every Responses client uses streaming, so this is a defensive path, but it
   should be closed.
2. #259 review note 2: `rebuildEvent` only replaces the first `data:` line. A multi-line data event
   (the real upstream does not send these, but the parser is tolerant) would be mangled by the
   rebuild.
3. #259 review note 3: when the stream is cut off (no done-family event) the held tail is lost. The
   compress-loop adapter exposes the same thing, but the plugin pipe can do better.
4. #258 review minor: a non-object content part is silently skipped in the join loop, so `content: [42]`
   counts as empty and gets dropped. It should be treated as mixed and kept.
5. #259 review note 4: the openai-protocol plugin passthrough does not strip tags. This is a
   deliberate scope decision (what was observed was omp/Responses), so it stays.

## Acceptance

- Items 1 through 4 above are fixed, and item 5 stays as it is (the decision is recorded on file).
- The full test suite, typecheck, and build stay green, with new regression tests locking in each
  behavior.
