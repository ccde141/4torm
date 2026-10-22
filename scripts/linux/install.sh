#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
. "$ROOT/scripts/linux/runtime.sh"
[ "$(uname -s)" = Linux ] || fail '请在 Linux 中执行此安装脚本。'
cd "$ROOT"
select_node || install_node
use_configured_proxy
printf '使用 %s (%s)\n' "$(command -v node)" "$(node --version)"
# Lockfiles choose Linux native dependencies. Existing data is not an install target.
npm ci
npm --prefix server ci
node node_modules/electron/install.js
if [ "${FOURTORM_SKIP_BROWSER_DOWNLOAD:-0}" != 1 ]; then
  node node_modules/playwright/cli.js install chromium
fi
npm run build
printf '\n安装完成。运行：\n  bash "%s/scripts/linux/start.sh"\n' "$ROOT"
