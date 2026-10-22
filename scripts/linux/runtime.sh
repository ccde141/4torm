#!/bin/sh
# Sourced by the Linux installer and launcher. Never selects a Windows Node from WSL PATH.
fail() { printf '%s\n' "$*" >&2; exit 1; }

valid_node() {
  command -v node >/dev/null 2>&1 && node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    process.exit(process.platform === "linux" && ((major === 22 && minor >= 13) || major >= 24) ? 0 : 1);
  ' >/dev/null 2>&1
}

select_node() {
  if [ -x "$ROOT/.linux-runtime/node/bin/node" ]; then
    PATH="$ROOT/.linux-runtime/node/bin:$PATH"
    export PATH
  fi
  valid_node && command -v npm >/dev/null 2>&1
}

use_configured_proxy() {
  if [ -n "${HTTPS_PROXY:-}${https_proxy:-}${HTTP_PROXY:-}${http_proxy:-}" ]; then
    export NODE_USE_ENV_PROXY=1
    export ELECTRON_GET_USE_PROXY=1
  fi
}

install_node() {
  command -v curl >/dev/null 2>&1 || fail '需要 curl 下载 Node.js；也可先安装 Node.js 24 LTS 后重试。'
  command -v sha256sum >/dev/null 2>&1 || fail '需要 sha256sum 校验下载文件。'
  case "$(uname -m)" in
    x86_64) node_arch=x64 ;;
    aarch64|arm64) node_arch=arm64 ;;
    *) fail '当前安装脚本支持 Linux x64 / arm64。' ;;
  esac
  node_version=v24.14.0
  runtime_root="$ROOT/.linux-runtime"
  [ ! -e "$runtime_root/node" ] || fail '本地 Node.js 目录已存在但不可用，请检查 .linux-runtime/node。'
  mkdir -p "$runtime_root"
  download_dir=$(mktemp -d "$runtime_root/download.XXXXXX")
  trap 'rm -rf -- "$download_dir"' EXIT HUP INT TERM
  archive="node-$node_version-linux-$node_arch.tar.xz"
  base_url="https://nodejs.org/dist/$node_version"
  printf '下载 Linux Node.js %s (%s)…\n' "$node_version" "$node_arch"
  curl --fail --location --show-error --output "$download_dir/$archive" "$base_url/$archive"
  curl --fail --location --show-error --output "$download_dir/SHASUMS256.txt" "$base_url/SHASUMS256.txt"
  (cd "$download_dir" && awk -v file="$archive" '$2 == file { print }' SHASUMS256.txt > selected.sha256
    test -s selected.sha256 && sha256sum --check selected.sha256)
  tar -xJf "$download_dir/$archive" -C "$download_dir"
  mv "$download_dir/node-$node_version-linux-$node_arch" "$runtime_root/node"
  rm -rf -- "$download_dir"
  trap - EXIT HUP INT TERM
  select_node || fail 'Linux Node.js 校验失败。'
}
