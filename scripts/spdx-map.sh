# SPDX-License-Identifier: Apache-2.0
#
# The license map of scripts/check-spdx.sh (sourced by it): the files it checks and the license of each path, first
# match wins. Keep it in sync with LICENSE.md: every hand-written file is Apache-2.0; dependencies,
# build output and the docs sources (git submodules) are skipped.
# shellcheck shell=bash disable=SC2034 # spdx_files is read by check-spdx.sh

spdx_files=('*.ts' '*.tsx' '*.mjs' '*.js' '*.astro' '*.css' '*.sh')

license_for() {
  case "$1" in
    */node_modules/* | node_modules/* | dist/* | .astro/* | sources/*) echo skip ;;
    *) echo Apache-2.0 ;;
  esac
}
