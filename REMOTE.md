# 独立后端与远程客户端

Linux 后端可以独立运行，并提供同一套网页和 API。Windows、Linux 桌面或手机浏览器打开后端地址即可使用；任务、文件、模型配置和运行记录都保存在后端。前端关闭不会关闭独立部署的后端。

以下使用同一版本的后端与前端产物：后端自托管网页，浏览器或远程 Electron 加载该网页。开发机和后端主机可以使用不同操作系统，更新时仍应在后端使用同一份版本重新构建并重启服务，再刷新客户端；仅更新 Windows 上的桌面窗口，不会更新 Linux 后端。若新界面提示某条 `Route ... not found`，先核对实际连接地址与后端运行版本。

## 直接运行 Linux 后端

使用 Linux Node.js 24 LTS 或 22.13+，在项目根目录安装和启动。这里跳过 Electron 的下载：

```sh
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --ignore-scripts
npm --prefix server ci
npm run build
bash scripts/linux/backend.sh
```

默认仍只监听 `localhost:3001`，适合本机使用。此脚本不启动 Electron，不需要图形桌面。也可以在根目录运行 `npm run start:prod`。

让其他设备连接时，需要明确配置监听地址、HTTPS 地址和访问口令：

```sh
export FOURTORM_HOST=0.0.0.0
export FOURTORM_PUBLIC_ORIGIN=https://4torm.example:3001
export FOURTORM_TLS_SERVERNAME=4torm.example
export FOURTORM_TLS_CERT_FILE=/absolute/config/cert.pem
export FOURTORM_TLS_KEY_FILE=/absolute/config/key.pem
export FOURTORM_ACCESS_TOKEN_FILE=/absolute/config/access-token
bash scripts/linux/backend.sh
```

将示意域名换成客户端实际访问的域名。证书必须包含该域名，并受客户端信任；例如使用你自己的域名证书，或在客户端安装信任的内部 CA。密钥与口令文件放在软件目录之外，口令使用随机的至少 32 个字符，例如 `openssl rand -hex 32` 的输出。文件必须允许运行后端的用户读取。首次打开网页后输入访问口令；登录状态保存在 HTTPS 的 HttpOnly Cookie 中，有效期 12 小时。更换口令并重启后端会使旧登录失效。

后端只信任 `FOURTORM_PUBLIC_ORIGIN` 配置的远程网页来源；推荐直接使用后端提供的网页，使 API、SSE 和文件请求保持同源。不要把未配置访问口令的本机后端通过其他转发工具直接公开。

## Docker

仓库提供 `Dockerfile` 和 `compose.yaml`。构建上下文只包含源码、文档站和内置素材，不包含本机的会话、模型密钥或运行记录。容器以非 root 用户运行，首次使用的数据目录会补齐内置工具和技能，已有文件不会被覆盖。

先在仓库之外准备配置目录，其中包含 `access-token`、`cert.pem`、`key.pem`。文件需要让容器用户 UID 1000 可读。在 Linux 上设置：

```sh
export FOURTORM_CONFIG_DIR=/absolute/config/4torm
export FOURTORM_PUBLIC_ORIGIN=https://4torm.example:3001
export FOURTORM_TLS_SERVERNAME=4torm.example
export FOURTORM_BIND_ADDRESS=0.0.0.0
docker compose up --build -d
```

默认端口映射仅绑定宿主机 `127.0.0.1`；上面的 `FOURTORM_BIND_ADDRESS` 才会让其他设备连接。`FOURTORM_PORT` 可修改宿主机端口，并同步修改公开 HTTPS 地址。数据保存在 `4torm-data` 命名卷，更新镜像不会删除它；不要用 `docker compose down -v` 清理正在使用的数据卷。查看后端日志使用 `docker compose logs -f backend`。

默认镜像不下载浏览器工具的 Chromium。需要浏览器自动化时，在首次构建前设置 `FOURTORM_INSTALL_BROWSER=1`；这会增加镜像体积并安装对应系统依赖。容器中的浏览器运行在后端，不能在远程 Electron 中嵌入为本机执行窗口。

## Windows 或 Linux 桌面连接远程后端

浏览器直接打开 `FOURTORM_PUBLIC_ORIGIN` 配置的地址即可。需要沿用 Electron 窗口时，先设置远程地址，再启动桌面程序。Windows PowerShell：

```powershell
$env:FOURTORM_BACKEND_URL = 'https://4torm.example:3001'
npm run electron:prod
```

Linux 桌面：

```sh
FOURTORM_BACKEND_URL=https://4torm.example:3001 bash scripts/linux/start.sh
```

远程桌面模式只加载后端提供的网页，不启动本机服务，不接管远程服务生命周期，也不会自动信任无效的远程证书。上传文件通过文件内容传输，不把 Windows 的本机磁盘路径当成 Linux 工作区路径。本机桌面的嵌入执行窗口不会暴露给远程后端。

## 模型服务地址指向哪里

模型列表、能力检测、对话和压缩都由后端请求。界面中填写的 `127.0.0.1` 指向后端所在环境：独立 Linux 后端指向那台 Linux；Docker 后端则指向容器本身。

模型引擎部署在另一个容器时，使用同一 Docker 网络中的服务名，例如 `http://inference:8080/v1`。模型引擎部署在 Docker 宿主机时，可使用 Compose 提供的 `host.docker.internal`；引擎必须监听容器能够访问的地址，单纯绑定宿主机 `127.0.0.1` 的服务不能通过宿主机网关访问。模型服务在另一台机器时，填写那台机器的可达地址。无需为模型引擎配置浏览器 CORS。
