FROM node:24.14.0-bookworm-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# VitePress reads optional Git timestamps even when the build context has no .git directory.
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY server/package.json server/package-lock.json ./server/
RUN npm --prefix server ci --ignore-scripts
COPY . .
RUN npm run build && npm --prefix server run build \
    && npm prune --omit=dev --ignore-scripts

FROM node:24.14.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production SERVE_STATIC=1 FOURTORM_HOST=0.0.0.0 PORT=3001 \
    FOURTORM_DATA_DIR=/app/data PLAYWRIGHT_BROWSERS_PATH=/opt/4torm-browsers
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/src ./server/src
COPY --from=build /app/dist ./dist
COPY --from=build /app/docs/.vitepress/dist ./docs/.vitepress/dist
# Keep the release image limited to bundled assets even if context rules are edited later.
COPY --from=build /app/data/providers.template.json ./seed-data/
COPY --from=build /app/data/tools/registry.template.json ./seed-data/tools/
COPY --from=build /app/data/tools/executors/_diff.js /app/data/tools/executors/_resolve.js \
    /app/data/tools/executors/delete_file.js /app/data/tools/executors/edit_file.js \
    /app/data/tools/executors/list_directory.js /app/data/tools/executors/read_file.js \
    /app/data/tools/executors/run_command.js /app/data/tools/executors/search_content.js \
    /app/data/tools/executors/use_skill.js /app/data/tools/executors/webfetch.js \
    /app/data/tools/executors/webfetch_advanced.js /app/data/tools/executors/write_file.js \
    ./seed-data/tools/executors/
COPY --from=build /app/data/skills/browser/SKILL.md /app/data/skills/browser/config.json \
    /app/data/skills/browser/tools.json ./seed-data/skills/browser/
COPY --from=build /app/data/skills/code-review/SKILL.md /app/data/skills/code-review/config.json ./seed-data/skills/code-review/
COPY --from=build /app/data/skills/web-search/SKILL.md /app/data/skills/web-search/config.json ./seed-data/skills/web-search/
COPY --from=build /app/data/skin-textures/custom-1780312588120.png ./seed-data/skin-textures/
COPY --from=build /app/data/tide/tasks.template.json ./seed-data/tide/
COPY --from=build /app/scripts/linux/container-entrypoint.mjs ./scripts/linux/container-entrypoint.mjs
ARG INSTALL_BROWSER=0
RUN if [ "$INSTALL_BROWSER" = 1 ]; then \
      node node_modules/playwright/cli.js install --with-deps chromium; \
    fi \
    && mkdir -p /app/data /opt/4torm-browsers \
    && chown -R node:node /app/data /opt/4torm-browsers
USER node
EXPOSE 3001
VOLUME ["/app/data"]
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "scripts/linux/container-entrypoint.mjs"]
