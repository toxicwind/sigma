# REQ — local joint regression of PR#257 + PR#258

## User request

User: "Merge the two together and test locally?" — merge #257 (omp native plugin mode) and #258
(Responses blank-message dropping) locally, verify that they do not affect each other, and
deliver a joint regression PR (same precedent as #250).

## Acceptance

- merge the two branches locally (from master 5982720) with zero conflicts or a reasonable
  resolution
- typecheck + the full test suite + build all green
- a real-machine e2e that hits both PRs' behavior at the same time
- push the joint regression branch + open a PR

## Outcome

See WORKLOG.md — a single e2e run hit all four points, and the PR has been opened.
