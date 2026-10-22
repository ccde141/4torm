#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
. "$ROOT/scripts/linux/runtime.sh"
[ "$(uname -s)" = Linux ] || fail '请在 Linux 中启动桌面版。'
[ "$(id -u)" != 0 ] || fail '请用普通桌面用户启动 4torm，不要使用 sudo 或 root。'
[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] || fail '未检测到图形会话。请在 Linux 桌面终端中运行。'
select_node || fail '需要 Linux Node.js 24 LTS（或 22.13+），请先运行 bash scripts/linux/install.sh。'
use_configured_proxy
if [ -z "${FOURTORM_BACKEND_URL:-}" ]; then
  [ -f "$ROOT/dist/index.html" ] || fail '未找到前端构建，请先运行 bash scripts/linux/install.sh。'
fi
[ -f "$ROOT/node_modules/electron/cli.js" ] || fail '未安装 Electron，请先运行安装脚本。'
if command -v ldd >/dev/null 2>&1 && [ -f "$ROOT/node_modules/electron/dist/electron" ]; then
  missing=$(ldd "$ROOT/node_modules/electron/dist/electron" | sed -n '/not found/p')
  [ -z "$missing" ] || fail "Electron 缺少系统运行库，请参照 LINUX.md 安装：
$missing"
fi
cd "$ROOT"
export ELECTRON_PROD=1
export npm_node_execpath="$(command -v node)"
exec node "$ROOT/node_modules/electron/cli.js" "$ROOT/electron/main.cjs" "$@"
