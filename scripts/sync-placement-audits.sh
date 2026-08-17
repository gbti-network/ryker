#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$repo_root/drop-in"
destination="${RYKER_PLACEMENT_AUDITS_MIRROR:-/mnt/c/Users/Hudson Atwell/Desktop/Codeable/Partner Ops/WooCommerce/Placement Audits/reports/ryker}"

required_source=(
  README.md
  build/bundle.mjs
  dist/ryker.js
  src/bootstrap/boot.js
)

for relative_path in "${required_source[@]}"; do
  if [[ ! -f "$source_dir/$relative_path" ]]; then
    printf 'Ryker source is missing the expected file: %s\n' "$relative_path" >&2
    exit 1
  fi
done

if [[ ! -d "$destination" || "$(basename -- "$destination")" != ryker || "$(basename -- "$(dirname -- "$destination")")" != reports ]]; then
  printf 'Refusing to sync: destination is not the dedicated reports/ryker directory: %s\n' "$destination" >&2
  exit 1
fi

for sentinel in README.md src dist; do
  if [[ ! -e "$destination/$sentinel" ]]; then
    printf 'Destination does not look like an existing Ryker mirror; missing: %s\n' "$sentinel" >&2
    exit 1
  fi
done

if command -v node >/dev/null 2>&1; then
  node "$source_dir/build/bundle.mjs"
elif command -v node.exe >/dev/null 2>&1; then
  node.exe "$(wslpath -w "$source_dir/build/bundle.mjs")"
else
  printf 'Node.js is required to build Ryker before synchronization.\n' >&2
  exit 1
fi

cp -- "$source_dir/README.md" "$destination/README.md"
for managed_dir in build dist docs src; do
  mkdir -p -- "$destination/$managed_dir"
  rsync -a --delete -- "$source_dir/$managed_dir/" "$destination/$managed_dir/"
done

audit_root="$(dirname -- "$(dirname -- "$destination")")"
report_builder="$audit_root/.data/build/build-reports.sh"
if [[ -f "$report_builder" ]]; then
  if command -v node >/dev/null 2>&1; then
    bash "$report_builder"
  elif command -v node.exe >/dev/null 2>&1; then
    embedder="$audit_root/.data/build/embed-assets.mjs"
    for doc in woocommerce-current-placements woocommerce-repairs-and-recommendations; do
      source_report="$audit_root/reports/$doc.src.html"
      node.exe "$(wslpath -w "$embedder")" "$(wslpath -w "$source_report")" \
        "$(wslpath -w "$audit_root/reports/$doc.html")"
      node.exe "$(wslpath -w "$embedder")" "$(wslpath -w "$source_report")" \
        "$(wslpath -w "$audit_root/reports/$doc-full.html")"
    done
  else
    printf 'Node.js is required to rebuild the Placement Audit report pages.\n' >&2
    exit 1
  fi
  printf 'Placement Audit report pages rebuilt with the synchronized Ryker bundle.\n'
fi

printf 'Ryker mirror synchronized. Preserved unmanaged content, including: %s/revisions\n' "$destination"
