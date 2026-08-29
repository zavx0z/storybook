#!/usr/bin/env bash

set -euo pipefail

skill_root=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
repository_root=$(git -C "$skill_root" rev-parse --show-toplevel)

if [[ ${1:-} == browser ]]; then
  shift
  exec bun "$repository_root/scripts/storybook-browser.ts" "$@"
fi

exec bun "$repository_root/scripts/storybook.ts" "$@"
