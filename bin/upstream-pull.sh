#!/usr/bin/env bash
# upstream-pull.sh — pull upstream sigma into this fork.
#
# Two things make this non-trivial, and this script exists because of them.
#
# 1. Structured files need an entity-aware merge. A three-way merge of
#    package.json by the line matcher picks one side's "version" and the other
#    side's "scripts" and produces a file that parses but describes no real
#    package. .gitattributes routes package.json, lock files, and every
#    .json/.yaml/.yml/.toml/.md to `merge=weave`, so git invokes weave-driver
#    for those and the line matcher only ever sees source.
#
# 2. Upstream moves fast and this fork carries local changes. The workflow
#    below is deliberately three explicit steps (preview, merge, test) rather
#    than one `git pull --rebase`, because a fast-moving upstream plus a
#    hand-merged manifest is exactly the case where you want to see the
#    conflicts before you take them.
#
# Usage:
#   bin/upstream-pull.sh preview     # fetch, report what moved, no local change
#   bin/upstream-pull.sh merge       # fetch, preview, then merge upstream/master
#   bin/upstream-pull.sh sync        # merge, then push this fork's branch
set -euo pipefail

UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-upstream}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-master}"
FORK_REMOTE="${FORK_REMOTE:-fork}"

die() { printf 'upstream-pull: %s\n' "$*" >&2; exit 1; }
say() { printf '\033[1m%s\033[0m\n' "$*"; }

require_repo() {
	git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git repository"
	git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1 \
		|| die "no '$UPSTREAM_REMOTE' remote; add one with: git remote add $UPSTREAM_REMOTE https://github.com/ranxianglei/sigma.git"
}

# weave must be the configured merge driver, or .gitattributes routes structured
# files to a driver that is not installed and the merge silently does the wrong
# thing. Check before merging, not after.
require_weave_driver() {
	local driver
	driver="$(git config --get merge.weave.driver || true)"
	case "$driver" in
		*weave-driver*|*weave\ merge*) return 0 ;;
		*) die "merge.weave.driver is unset or does not invoke weave (got: '${driver}')" ;;
	esac
	command -v weave >/dev/null 2>&1 || die "weave is not on PATH"
}

fetch_upstream() {
	say "Fetching $UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
	git fetch "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH" --quiet
	git fetch "$UPSTREAM_REMOTE" --tags --force --quiet
}

# Report the shape of the incoming change without touching the worktree.
preview() {
	fetch_upstream
	local base head
	base="$(git merge-base HEAD "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")"
	head="$(git rev-parse "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")"

	if [ "$base" = "$head" ]; then
		say "Already up to date ($UPSTREAM_REMOTE/$UPSTREAM_BRANCH = HEAD)"
		return 0
	fi

	say "Incoming from $UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
	printf '  %s commits ahead, %s behind\n' \
		"$(git rev-list --count "$base..$head")" \
		"$(git rev-list --count "$head..HEAD")"

	say "Files upstream changed (these are what weave will be asked to merge):"
	# Structured files are where a line-based merge does the most damage, so
	# they get their own count up front.
	local structured
	structured="$(git diff --name-only "$base..$head" -- '*.json' '*.yaml' '*.yml' '*.toml' 'package.json' '*.md' | wc -l | tr -d ' ')"
	printf '  %s total changed, %s of them structured (weave-merged)\n' \
		"$(git diff --name-only "$base..$head" | wc -l | tr -d ' ')" \
		"$structured"

	say "Structured files upstream touched (highest conflict risk):"
	git diff --name-only "$base..$head" -- package.json 'package-lock.json' '*.json' '*.yaml' '*.yml' '*.toml' \
		| head -40 | sed 's/^/  /'
}

do_merge() {
	require_repo
	require_weave_driver
	preview
	say ""
	say "Merging $UPSTREAM_REMOTE/$UPSTREAM_BRANCH into $(git branch --show-current)"
	if ! git merge --no-edit "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"; then
		cat >&2 <<'MSG'
upstream-pull: merge stopped with conflicts.

  For a source conflict, resolve the file, `git add` it, and continue.
  For a structured conflict, `weave explain <file>` shows per-hunk detail and
  `weave check` verifies your resolution before you commit it.
MSG
		exit 1
	fi
	say "Merged cleanly. Verify before pushing:"
	printf '  npm test\n  npm run build\n'
}

do_sync() {
	do_merge
	say ""
	say "Pushing to $FORK_REMOTE/$(git branch --show-current)"
	git push "$FORK_REMOTE" HEAD
	say "Pushed."
}

case "${1:-preview}" in
	preview) require_repo; preview ;;
	merge)   do_merge ;;
	sync)    do_sync ;;
	*)       die "usage: $0 {preview|merge|sync}" ;;
esac
