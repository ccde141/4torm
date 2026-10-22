# Linux 桌面版

支持 x64 / arm64 的 Linux 图形桌面。安装时使用本机的 Linux Node.js 24 LTS 或 22.13+；缺少合适版本时，脚本会下载校验官方 Node.js 24.14.0，仅放在当前目录的 `.linux-runtime/`，不修改系统 Node.js。

解压到有写权限的目录，在该目录打开终端：

```sh
bash scripts/linux/install.sh
bash scripts/linux/start.sh
```

首次安装需要联网下载 npm 依赖、Linux Electron 和浏览器工具使用的 Chromium。后续直接运行第二条命令；已有系统 Node.js 时也可使用 `npm run linux`。请使用普通桌面用户启动。

下载和运行会使用你已配置的 `HTTP_PROXY` / `HTTPS_PROXY`，不会自动修改代理地址。若 Electron 的官方 GitHub 下载在当前网络不可达，可指定 Electron 文档支持的镜像后重新安装：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ bash scripts/linux/install.sh`；仍会校验下载文件。

窗口沿用现有 4torm 界面，后端由桌面程序启动并在关闭时退出，默认只监听本机 `localhost:3001`。本机使用不需要开放防火墙端口。

## Linux 系统依赖

Node.js 下载需要 `curl`、`tar`、`xz` 和 `sha256sum`。Electron 还依赖桌面的 GTK、NSS 和音频库。Ubuntu 24.04 可安装：

```sh
sudo apt-get update
sudo apt-get install curl xz-utils libgtk-3-0t64 libnss3 libasound2t64 libgbm1 libxss1 xdg-utils
```

Ubuntu 22.04 对应包名为 `libgtk-3-0` 和 `libasound2`。其他发行版使用自身软件仓库提供这些运行库。如果启动提示缺少某个 `.so`，先安装对应系统库，再重新启动。

遇到 Chromium sandbox 错误时保留完整错误信息，检查发行版的用户命名空间或 sandbox 配置；启动脚本保留 Electron 的 sandbox 检查。

## 数据与工具

新安装的发布包包含框架内置工具、技能和模板。模型服务与 Agent 在界面中配置，本机工作数据保存在 `data/`。升级前备份原目录的 `data/`，在原安装目录更新源码并重新安装即可保留数据。

从 Windows 搬迁已有数据时，先备份，再复制到 Linux；工作区、MCP 配置和技能中的 Windows 绝对路径需要改为 Linux 路径。程序按后端实际操作系统给 Agent 提供环境说明，Linux 命令工具使用 `/bin/sh`。

安装脚本会准备浏览器工具使用的 Playwright Chromium。若只想先安装桌面主程序，可执行 `FOURTORM_SKIP_BROWSER_DOWNLOAD=1 bash scripts/linux/install.sh`，之后再安装浏览器：

```sh
node node_modules/playwright/cli.js install chromium
```

若 Chromium 提示缺少系统运行库，可在安装目录运行 `node node_modules/playwright/cli.js install-deps chromium`，按提示完成系统依赖安装。

参考：[Electron 安装说明](https://www.electronjs.org/docs/latest/tutorial/installation)、[Node.js 官方发行版本](https://nodejs.org/en/about/previous-releases)。
