#!/usr/bin/env bash
#
# check-maps-presence.sh — U7 maps presence gate
#
# Fails a change that touches Markets UI code or the client-state catalog
# without carrying its companion map artifact.
#
# THIS GATE IS DUMB ON PURPOSE. It decides from changed paths and the
# presence/absence of companion paths, and from required headings inside a
# changed ADR. It never reads meaning, never calls an LLM, never touches the
# network. Semantic judgment belongs to the review skills in
# `docs/maps/REVIEW.md`, not here.
#
# `.scratch/` is tracked as of 2026-08-06 (previously gitignored), so scratch
# decision YAMLs are now visible to git. The gate's contract is unchanged: the
# required artifact is the summary ADR under `docs/adr/`, which carries the
# `Scratch:` pointer (`docs/adr/README.md`); scratch files are never required.
#
# Usage:
#   tools/scripts/check-maps-presence.sh                     # diff vs default base
#   tools/scripts/check-maps-presence.sh --base origin/main
#   tools/scripts/check-maps-presence.sh --files-from list.txt
#   cat list.txt | tools/scripts/check-maps-presence.sh --files-from -
#
# Options:
#   --base <ref>          Git ref to diff against (default: $MAPS_PRESENCE_BASE,
#                         else origin/main, else main).
#   --files-from <path>   Read the changed-path list from a file (or `-` for
#                         stdin) instead of git. One repo-relative path per
#                         line. This is the fixture mode.
#   --exemptions <path>   Override the exemption list location.
#   --root <dir>          Override the repo root (test harnesses only).
#
# Exit codes:
#   0  no rule violated
#   1  a rule was violated
#   2  the gate could not run (bad usage, unreadable exemption list)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

BASE_REF="${MAPS_PRESENCE_BASE:-}"
FILES_FROM=""
EXEMPTIONS=""

die() {
  echo "check-maps-presence: $1" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) [[ $# -ge 2 ]] || die "--base needs a value"; BASE_REF="$2"; shift 2 ;;
    --files-from) [[ $# -ge 2 ]] || die "--files-from needs a value"; FILES_FROM="$2"; shift 2 ;;
    --exemptions) [[ $# -ge 2 ]] || die "--exemptions needs a value"; EXEMPTIONS="$2"; shift 2 ;;
    --root) [[ $# -ge 2 ]] || die "--root needs a value"; ROOT="$2"; shift 2 ;;
    -h|--help) sed -n '2,40p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -d "$ROOT" ]] || die "root does not exist: $ROOT"
EXEMPTIONS="${EXEMPTIONS:-$ROOT/tools/scripts/maps-presence-exemptions.txt}"

# ---------------------------------------------------------------------------
# Rule table. Directory triggers are prefixes *including* the trailing slash,
# so `web/components-old/x.tsx` does not match `web/components/`.
#
# Exemptions are a different thing entirely and are EXACT PATH ONLY — see
# docs/solutions/security-issues/discovery-security-guard-exemptions-must-be-exact-path-only.md.
# A prefix or "looks like" match on an exemption re-creates the exact risk the
# gate exists to stop.
# ---------------------------------------------------------------------------
UI_TRIGGERS=(
  "web/components/"
  "web/hooks/"
)
COMPANION_BRIEF="docs/maps/ui/"
COMPANION_STATE="docs/maps/state/keys/"
COMPANION_ADR="docs/adr/"          # numbered files only; README.md is process doc
STATE_KEYS_DIR="docs/maps/state/keys/"
STATE_INDEX="docs/maps/state/functions/INDEX.md"

# ---------------------------------------------------------------------------
# Collect changed paths.
# ---------------------------------------------------------------------------
changed_raw=""

if [[ -n "$FILES_FROM" ]]; then
  if [[ "$FILES_FROM" == "-" ]]; then
    changed_raw="$(cat)"
  else
    [[ -r "$FILES_FROM" ]] || die "cannot read --files-from list: $FILES_FROM"
    changed_raw="$(cat "$FILES_FROM")"
  fi
else
  command -v git >/dev/null 2>&1 || die "git not found; use --files-from"
  git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1 || die "not a git repo: $ROOT"

  if [[ -z "$BASE_REF" ]]; then
    if git -C "$ROOT" rev-parse --verify --quiet origin/main >/dev/null; then
      BASE_REF="origin/main"
    else
      BASE_REF="main"
    fi
  fi
  git -C "$ROOT" rev-parse --verify --quiet "$BASE_REF" >/dev/null \
    || die "base ref not found: $BASE_REF"

  merge_base="$(git -C "$ROOT" merge-base "$BASE_REF" HEAD)"
  changed_raw="$(
    {
      git -C "$ROOT" diff --name-only "$merge_base" HEAD
      git -C "$ROOT" diff --name-only HEAD
      git -C "$ROOT" ls-files --others --exclude-standard
    } 2>/dev/null
  )"
fi

CHANGED=()
while IFS= read -r line; do
  line="${line%%$'\r'}"
  line="${line#"${line%%[![:space:]]*}"}"   # ltrim
  line="${line%"${line##*[![:space:]]}"}"   # rtrim
  [[ -z "$line" ]] && continue
  [[ "$line" == \#* ]] && continue
  CHANGED+=("$line")
done <<< "$changed_raw"

# ---------------------------------------------------------------------------
# Exemptions: exact repo-relative path, then `#` and a required reason.
# ---------------------------------------------------------------------------
EXEMPT_PATHS=()
if [[ -e "$EXEMPTIONS" ]]; then
  [[ -r "$EXEMPTIONS" ]] || die "exemption list is not readable: $EXEMPTIONS"
  lineno=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    lineno=$((lineno + 1))
    line="${line%%$'\r'}"
    [[ -z "${line//[[:space:]]/}" ]] && continue
    [[ "${line#"${line%%[![:space:]]*}"}" == \#* ]] && continue
    if [[ "$line" != *"#"* ]]; then
      die "$EXEMPTIONS:$lineno: exemption needs a reason — '<exact/path> # why'"
    fi
    path="${line%%#*}"
    reason="${line#*#}"
    path="${path#"${path%%[![:space:]]*}"}"; path="${path%"${path##*[![:space:]]}"}"
    reason="${reason#"${reason%%[![:space:]]*}"}"; reason="${reason%"${reason##*[![:space:]]}"}"
    [[ -n "$path" ]] || die "$EXEMPTIONS:$lineno: empty exemption path"
    [[ -n "$reason" ]] || die "$EXEMPTIONS:$lineno: exemption needs a reason — '<exact/path> # why'"
    EXEMPT_PATHS+=("$path")
  done < "$EXEMPTIONS"
fi

# Exact string equality. Never a prefix, never a substring.
is_exempt() {
  local candidate="$1" entry
  for entry in ${EXEMPT_PATHS+"${EXEMPT_PATHS[@]}"}; do
    [[ "$candidate" == "$entry" ]] && return 0
  done
  return 1
}

has_prefix() {
  local candidate="$1" prefix="$2"
  [[ "$candidate" == "$prefix"* ]]
}

any_changed_under() {
  local prefix="$1" path
  for path in ${CHANGED+"${CHANGED[@]}"}; do
    has_prefix "$path" "$prefix" && return 0
  done
  return 1
}

any_changed_equals() {
  local target="$1" path
  for path in ${CHANGED+"${CHANGED[@]}"}; do
    [[ "$path" == "$target" ]] && return 0
  done
  return 1
}

# A numbered ADR, not docs/adr/README.md.
is_numbered_adr() {
  [[ "$1" =~ ^docs/adr/[0-9]{4}-.+\.md$ ]]
}

violations=0
fail() {
  echo "check-maps-presence: $1" >&2
  violations=$((violations + 1))
}

# ---------------------------------------------------------------------------
# Rule 1 — UI code needs a companion map artifact.
#
# Touching web/components/** or web/hooks/** requires at least one of:
#   docs/maps/ui/**            (the region brief it changes the meaning of)
#   docs/maps/state/keys/**    (the state key it moves)
#   docs/adr/NNNN-*.md         (the tracked summary ADR)
# ---------------------------------------------------------------------------
triggering_ui=()
for path in ${CHANGED+"${CHANGED[@]}"}; do
  for prefix in "${UI_TRIGGERS[@]}"; do
    if has_prefix "$path" "$prefix"; then
      is_exempt "$path" || triggering_ui+=("$path")
      break
    fi
  done
done

if [[ ${#triggering_ui[@]} -gt 0 ]]; then
  companion=""
  any_changed_under "$COMPANION_BRIEF" && companion="$COMPANION_BRIEF"
  [[ -z "$companion" ]] && any_changed_under "$COMPANION_STATE" && companion="$COMPANION_STATE"
  if [[ -z "$companion" ]]; then
    for path in ${CHANGED+"${CHANGED[@]}"}; do
      if is_numbered_adr "$path"; then companion="$path"; break; fi
    done
  fi
  if [[ -z "$companion" ]]; then
    fail "UI change without a companion map artifact."
    printf '  changed UI paths:\n' >&2
    printf '    %s\n' "${triggering_ui[@]}" >&2
    cat >&2 <<EOF
  Satisfy this by changing at least one of:
    ${COMPANION_BRIEF}**            region brief for the surface you touched
    ${COMPANION_STATE}**    state key you read or write
    ${COMPANION_ADR}NNNN-*.md         summary ADR (docs/adr/README.md)
  Or add an exact-path exemption with a reason to:
    ${EXEMPTIONS#$ROOT/}
  Charter: docs/maps/README.md · Rules: docs/maps/REVIEW.md
EOF
  fi
fi

# ---------------------------------------------------------------------------
# Rule 2 — state keys changed means the generated index changed with them.
#
# Keys are the source of truth; the index is generated from them
# (docs/maps/SCHEMAS.md §3). Presence only — drift is caught separately by
# `node tools/scripts/generate-state-function-index.mjs --check`.
# ---------------------------------------------------------------------------
if any_changed_under "$STATE_KEYS_DIR" && ! any_changed_equals "$STATE_INDEX"; then
  fail "state-key catalog changed without regenerating the function index."
  cat >&2 <<EOF
  Missing: $STATE_INDEX
  Regenerate it — never hand-edit it:
    node tools/scripts/generate-state-function-index.mjs
EOF
fi

# ---------------------------------------------------------------------------
# Rule 3 — a changed summary ADR carries its required sections.
#
# Structure only, never content quality. Checked when the file exists in the
# working tree; a path-list fixture naming an absent file is skipped.
# ---------------------------------------------------------------------------
for path in ${CHANGED+"${CHANGED[@]}"}; do
  is_numbered_adr "$path" || continue
  [[ -f "$ROOT/$path" ]] || continue
  missing=()
  grep -qE '^Date:' "$ROOT/$path"           || missing+=("Date:")
  grep -qE '^Status:' "$ROOT/$path"         || missing+=("Status:")
  grep -qE '^## Context' "$ROOT/$path"      || missing+=("## Context")
  grep -qE '^## Decision' "$ROOT/$path"     || missing+=("## Decision")
  grep -qE '^## Consequences' "$ROOT/$path" || missing+=("## Consequences")
  if [[ ${#missing[@]} -gt 0 ]]; then
    fail "ADR $path is missing required sections: ${missing[*]}"
    echo "  Format: docs/adr/README.md" >&2
  fi
done

if (( violations > 0 )); then
  echo "check-maps-presence: $violations rule(s) violated." >&2
  exit 1
fi

echo "check-maps-presence: clean (${#CHANGED[@]} changed path(s) inspected)."
