#!/usr/bin/env bash
#
# check-storage-layout.sh — dual-pipeline storage-layout golden gate (plan 007)
#
# `forge inspect <Contract> storage-layout --json` is not byte-identical across
# via-IR and legacy: `astId` and `t_struct(Name)NNNN_storage` suffixes move with
# the AST. Slot, label, offset, and the AST-stripped type graph are the layout.
# This script canonicalizes both pipelines and diffs them against committed
# goldens (`git diff --exit-code` style).
#
# ffi stays off in foundry.toml, so this cannot live inside a Solidity test.
# `test/StorageLayout.t.sol` covers the current pipeline's slot/label/offset
# map on every `forge test`. This script is the both-pipeline regenerator.
#
# Usage:
#   tools/scripts/check-storage-layout.sh           # check both pipelines
#   tools/scripts/check-storage-layout.sh --write   # write goldens from via-IR
#                                                   # after both pipelines agree
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
GOLDEN_DIR="$ROOT/artifacts/tests/storage-layout"
CONTRACTS=(OVRFLOFactory OVRFLO OVRFLOLending OVRFLOToken OVRFLOReserve OVRFLORequestBook)

WRITE=0
if [[ "${1:-}" == "--write" ]]; then
  WRITE=1
elif [[ "${1:-}" != "" ]]; then
  echo "check-storage-layout: unknown argument: $1" >&2
  exit 2
fi

canonicalize() {
  python3 - "$1" <<'PY'
import json, re, sys

path = sys.argv[1]
data = json.load(open(path))
struct_re = re.compile(r"(t_struct\([A-Za-z0-9_]+\))\d+(_storage)")

def strip_type(value):
    if isinstance(value, str):
        return struct_re.sub(r"\1\2", value)
    return value

storage = []
for entry in data["storage"]:
    storage.append({
        "label": entry["label"],
        "offset": entry["offset"],
        "slot": entry["slot"],
        "type": strip_type(entry["type"]),
    })

types = {}
for key, spec in data.get("types", {}).items():
    new_key = strip_type(key)
    new_spec = {}
    for field in ("label", "encoding", "numberOfBytes", "key", "value", "members"):
        if field not in spec:
            continue
        if field == "members":
            members = []
            for member in spec["members"]:
                item = {k: member[k] for k in ("label", "offset", "slot", "type") if k in member}
                if "type" in item:
                    item["type"] = strip_type(item["type"])
                members.append(item)
            new_spec["members"] = members
        else:
            new_spec[field] = strip_type(spec[field])
    types[new_key] = new_spec

json.dump({"storage": storage, "types": types}, sys.stdout, indent=2, sort_keys=True)
sys.stdout.write("\n")
PY
}

inspect_profile() {
  local profile="$1"
  local outdir="$2"
  mkdir -p "$outdir"
  echo "check-storage-layout: building profile=${profile:-default}" >&2
  forge clean
  if [[ -n "$profile" ]]; then
    FOUNDRY_PROFILE="$profile" forge build >/dev/null
  else
    forge build >/dev/null
  fi
  local contract
  for contract in "${CONTRACTS[@]}"; do
    local raw="$outdir/$contract.raw.json"
    if [[ -n "$profile" ]]; then
      FOUNDRY_PROFILE="$profile" forge inspect "$contract" storage-layout --json > "$raw"
    else
      forge inspect "$contract" storage-layout --json > "$raw"
    fi
    canonicalize "$raw" > "$outdir/$contract.json"
  done
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

inspect_profile "" "$TMP/via-ir"
inspect_profile "legacy" "$TMP/legacy"

FAIL=0
for contract in "${CONTRACTS[@]}"; do
  if ! diff -u "$TMP/via-ir/$contract.json" "$TMP/legacy/$contract.json"; then
    echo "check-storage-layout: $contract canonical layout differs across pipelines" >&2
    FAIL=1
  fi
done
if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi

mkdir -p "$GOLDEN_DIR"
if [[ "$WRITE" -eq 1 ]]; then
  for contract in "${CONTRACTS[@]}"; do
    cp "$TMP/via-ir/$contract.json" "$GOLDEN_DIR/$contract.json"
  done
  echo "check-storage-layout: wrote goldens under $GOLDEN_DIR"
  exit 0
fi

for contract in "${CONTRACTS[@]}"; do
  if ! diff -u "$GOLDEN_DIR/$contract.json" "$TMP/via-ir/$contract.json"; then
    echo "check-storage-layout: $contract drifted from golden" >&2
    FAIL=1
  fi
done
exit "$FAIL"
