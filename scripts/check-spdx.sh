#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Checks that every hand-written source file carries the SPDX header of the repository (everything is Apache-2.0,
# LICENSE.md): `// SPDX-License-Identifier: Apache-2.0` as the first line of TypeScript and JavaScript files (the
# second after a shebang), inside the frontmatter fence of Astro files (the line after the opening `---`),
# `/* SPDX-License-Identifier: Apache-2.0 */` in CSS and `# SPDX-License-Identifier: Apache-2.0` in shell scripts.
# Dependencies, build output and the docs sources (git submodules) are not checked.
# Usage: scripts/check-spdx.sh [--fix]   (--fix inserts missing headers; wrong ones are only reported)
set -euo pipefail
cd "$(dirname "$0")/.."

fix=0
[ "${1:-}" = "--fix" ] && fix=1

license_for() {
  case "$1" in
    */node_modules/* | node_modules/* | dist/* | .astro/* | sources/*) echo skip ;;
    *) echo Apache-2.0 ;;
  esac
}

missing=0
wrong=0
fixed=0
while IFS= read -r -d '' file; do
  [ -f "$file" ] || continue
  expected=$(license_for "$file")
  [ "$expected" = skip ] && continue
  case "$file" in
    *.sh) header="# SPDX-License-Identifier: $expected" ;;
    *.css) header="/* SPDX-License-Identifier: $expected */" ;;
    *) header="// SPDX-License-Identifier: $expected" ;;
  esac
  first=$(head -n 1 "$file")
  line=1
  if [[ "$file" == *.astro ]]; then
    if [ "$first" != "---" ]; then
      if [ "$fix" = 1 ]; then
        tmp=$(mktemp)
        { echo "---"; echo "$header"; echo "---"; echo; cat "$file"; } > "$tmp"
        cat "$tmp" > "$file" && rm -f "$tmp"
        fixed=$((fixed + 1))
      else
        echo "$file: missing frontmatter with '$header'" >&2
        missing=$((missing + 1))
      fi
      continue
    fi
    line=2
  elif [[ "$first" == '#!'* ]]; then
    line=2
  fi
  actual=$(sed -n "${line}p" "$file")
  [ "$actual" = "$header" ] && continue
  if [[ "$actual" == *'SPDX-License-Identifier:'* ]]; then
    echo "$file: wrong license header '$actual' (expected '$header')" >&2
    wrong=$((wrong + 1))
    continue
  fi
  if [ "$fix" = 1 ]; then
    tmp=$(mktemp)
    if [ "$line" = 2 ]; then
      { head -n 1 "$file"; echo "$header"; tail -n +2 "$file"; } > "$tmp"
    else
      { echo "$header"; cat "$file"; } > "$tmp"
    fi
    cat "$tmp" > "$file" && rm -f "$tmp"
    fixed=$((fixed + 1))
  else
    echo "$file: missing '$header'" >&2
    missing=$((missing + 1))
  fi
done < <(git ls-files -z --cached --others --exclude-standard -- '*.ts' '*.tsx' '*.mjs' '*.js' '*.astro' '*.css' '*.sh')

[ "$fixed" -gt 0 ] && echo "inserted $fixed SPDX headers"
if [ "$missing" -gt 0 ] || [ "$wrong" -gt 0 ]; then
  echo "SPDX check failed: $missing missing, $wrong wrong (run scripts/check-spdx.sh --fix for missing headers)" >&2
  exit 1
fi
echo "SPDX headers ok"
