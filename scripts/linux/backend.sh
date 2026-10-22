#!/bin/sh
# Standalone backend: no display server or Electron installation is required.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
. "$ROOT/scripts/linux/runtime.sh"
[ "$(uname -s)" = Linux ] || fail '请在 Linux 中运行此脚本。'
select_node || fail '需要 Linux Node.js 24 LTS（或 22.13+）。'
use_configured_proxy
[ -f "$ROOT/dist/index.html" ] || fail '未找到前端构建，请先完成 npm run build。'
[ -f "$ROOT/server/node_modules/tsx/dist/cli.mjs" ] || fail '请先安装 server/ 中的依赖。'
cd "$ROOT/server"
export SERVE_STATIC=1 NODE_ENV=production
exec node node_modules/tsx/dist/cli.mjs src/index.ts "$@"
