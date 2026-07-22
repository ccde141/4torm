import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('documentation theme mounts one low-power ASCII background', async () => {
  const [theme, field, config, styles] = await Promise.all([
    fs.readFile(new URL('../docs/.vitepress/theme/index.ts', import.meta.url), 'utf8'),
    fs.readFile(new URL('../docs/.vitepress/theme/AsciiBreathingField.vue', import.meta.url), 'utf8'),
    fs.readFile(new URL('../docs/.vitepress/config.ts', import.meta.url), 'utf8'),
    fs.readFile(new URL('../docs/.vitepress/theme/custom.css', import.meta.url), 'utf8'),
  ]);

  assert.match(theme, /AsciiBreathingField/);
  assert.match(field, /prefers-reduced-motion/);
  assert.match(field, /visibilitychange/);
  assert.match(field, /requestAnimationFrame/);
  assert.match(field, /Math\.min\(window\.devicePixelRatio \|\| 1, 1\.5\)/);
  assert.match(field, /const homeThreshold = 0\.22/);
  assert.match(field, /const homeMaximumAlpha = 0\.5/);
  assert.match(field, /const pageThreshold = 0\.22/);
  assert.match(field, /const pageMaximumAlpha = 0\.46/);
  assert.match(field, /function gridValue\(/);
  assert.match(field, /Math\.imul/);
  assert.match(field, /function valueNoise\(/);
  assert.match(field, /function warpedField\(/);
  assert.match(field, /const time = phase \* 0\.55/);
  assert.match(field, /const warpX = valueNoise/);
  assert.match(field, /const warpY = valueNoise/);
  assert.match(field, /combined \* 1\.08 \+ 0\.02/);
  assert.doesNotMatch(field, /Math\.hypot\(column - columns/);
  assert.doesNotMatch(field, /Math\.sin\(distance \* 0\.16/);
  assert.match(field, /frontmatter\.value\.layout === 'home'/);
  assert.match(field, /--ascii-field-color/);
  assert.match(styles, /--ascii-field-color: #0047bd/);
  assert.match(styles, /--ascii-field-color: #7bc4ff/);
  assert.match(styles, /\.ascii-breathing-field \{[\s\S]*?opacity: 0\.8;/);
  assert.doesNotMatch(config, /本地部署/);
});

test('public introduction entry points use the current page name', async () => {
  const files = [
    '../README.md',
    '../docs/index.md',
    '../docs/.vitepress/config.ts',
    '../docs/guide/introduction.md',
  ];
  const docs = await Promise.all(files.map(async file => ({
    file,
    text: await fs.readFile(new URL(file, import.meta.url), 'utf8'),
  })));

  for (const { file, text } of docs) {
    assert.doesNotMatch(text, /设计哲学/, file);
  }
});

test('personal labels and skin textures stay out of version control', async () => {
  const gitignore = await fs.readFile(new URL('../.gitignore', import.meta.url), 'utf8');

  assert.match(gitignore, /^data\/labels\.json$/m);
  assert.match(gitignore, /^data\/skin-textures\/$/m);
});

test('system status definitions do not depend on the obsolete data file', async () => {
  const statusStore = await fs.readFile(
    new URL('../src/store/statuses.ts', import.meta.url),
    'utf8',
  );

  assert.match(statusStore, /SYSTEM_STATUSES/);
  assert.doesNotMatch(statusStore, /statuses\.json/);
  await assert.rejects(fs.access(new URL('../data/statuses.json', import.meta.url)));
});

test('data layout documents current owners, persistence, and backup boundaries', async () => {
  const layout = await fs.readFile(
    new URL('../docs/architecture/data-layout.md', import.meta.url),
    'utf8',
  );

  assert.match(layout, /Agent 还可以使用项目外部的工作区/);
  assert.match(layout, /agents\/.*memory\/.*index\.md/s);
  assert.match(layout, /taskboard\.json/);
  assert.match(layout, /dispatches\/.*dispatchId/s);
  assert.match(layout, /## 不写入文件的状态/);
  assert.match(layout, /data\/labels\.json/);
  assert.match(layout, /data\/skin-textures\//);
  assert.match(layout, /## 备份与迁移/);
  assert.doesNotMatch(layout, /好处是|代价是|删库/);
});

test('architecture overview explains runtime behavior before developer entry points', async () => {
  const overview = await fs.readFile(
    new URL('../docs/architecture/overview.md', import.meta.url),
    'utf8',
  );

  assert.match(overview, /## 运行时组成/);
  assert.match(overview, /## 一次 Agent 任务如何执行/);
  assert.match(overview, /## 数据与状态/);
  assert.match(overview, /## 页面刷新/);
  assert.match(overview, /## 程序关闭与重新启动/);
  assert.match(overview, /## 开发者入口/);
  assert.doesNotMatch(overview, /## 分层架构|## 共享基础设施|## 技术栈/);
});

test('architecture overview ends with a source directory locator', async () => {
  const overview = await fs.readFile(
    new URL('../docs/architecture/overview.md', import.meta.url),
    'utf8',
  );

  assert.ok(overview.indexOf('## 代码目录') > overview.indexOf('## 相关文档'));
  assert.match(overview, /src\/.*前端代码/s);
  assert.match(overview, /server\/.*服务端启动/s);
  assert.match(overview, /electron\/.*桌面窗口/s);
  assert.match(overview, /docs\/.*VitePress 文档源码/s);
});

test('introduction stays focused on observable framework capabilities', async () => {
  const [introduction, config] = await Promise.all([
    fs.readFile(new URL('../docs/guide/introduction.md', import.meta.url), 'utf8'),
    fs.readFile(new URL('../docs/.vitepress/config.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(introduction, /^# 介绍$/m);
  assert.match(introduction, /按流程接力、分支或汇合/);
  assert.doesNotMatch(introduction, /设计哲学|平台定位|框架特点|一次性会议/);
  assert.doesNotMatch(config, /介绍与设计哲学/);
});

test('project introduction does not use local deployment as positioning', async () => {
  const files = [
    '../README.md',
    '../docs/index.md',
    '../docs/guide/introduction.md',
  ];
  const docs = await Promise.all(files.map(async file => ({
    file,
    text: await fs.readFile(new URL(file, import.meta.url), 'utf8'),
  })));

  for (const { file, text } of docs) {
    assert.doesNotMatch(text, /本地部署/, file);
  }
});

test('public docs omit internal collaboration engine relationships', async () => {
  const files = [
    '../README.md',
    '../docs/guide/concepts.md',
    '../docs/guide/getting-started.md',
    '../docs/architecture/overview.md',
    '../docs/extend/skills.md',
  ];
  const docs = await Promise.all(files.map(async file => ({
    file,
    text: await fs.readFile(new URL(file, import.meta.url), 'utf8'),
  })));

  for (const { file, text } of docs) {
    assert.doesNotMatch(text, /共享 ReAct|ReAct 引擎|SessionRunner \+ ReAct/, file);
    assert.doesNotMatch(text, /季风是基础|所有模式.*复用.*SessionRunner/, file);
    assert.doesNotMatch(text, /所有协作模式共用同一套 `use_skill` 执行器/, file);
  }
});

const publicDocs = [
  '../README.md',
  '../docs/architecture/behavior-freeze.md',
  '../docs/architecture/overview.md',
  '../docs/architecture/security.md',
  '../docs/modes/tide.md',
];

test('公开文档不再描述已经移除的 Agent 全局串行机制', async () => {
  const contents = await Promise.all(publicDocs.map(async file => ({
    file,
    text: await fs.readFile(new URL(file, import.meta.url), 'utf8'),
  })));

  for (const { file, text } of contents) {
    assert.doesNotMatch(text, /agent-queue|Agent 互斥锁|按-Agent 串行队列|互斥锁排队/, file);
    assert.doesNotMatch(text, /保证多实例场景数据一致/, file);
  }
});

test('潮汐开篇说明真实的配置来源与调度边界', async () => {
  const tide = await fs.readFile(
    new URL('../docs/modes/tide.md', import.meta.url),
    'utf8',
  );

  assert.match(tide, /读取控制台中的当前模型、工具、技能和执行权限配置/);
  assert.match(tide, /4torm 关闭期间任务不会执行/);
});

test('潮汐创建说明明确保留轮数与首次触发语义', async () => {
  const tide = await fs.readFile(
    new URL('../docs/modes/tide.md', import.meta.url),
    'utf8',
  );

  assert.match(tide, /达到该轮数后自动归档较早的一半/);
  assert.match(tide, /创建本身不会立刻执行任务/);
});

test('潮汐推送目标说明工具过程的真实保存边界', async () => {
  const tide = await fs.readFile(
    new URL('../docs/modes/tide.md', import.meta.url),
    'utf8',
  );

  assert.match(tide, /工具调用过程不会出现在该会话中/);
  assert.match(tide, /保存在对应的潮汐运行记录文件中/);
});

test('核心概念只描述两档文件工具权限及真实边界', async () => {
  const concepts = await fs.readFile(
    new URL('../docs/guide/concepts.md', import.meta.url),
    'utf8',
  );

  assert.match(concepts, /项目级/);
  assert.match(concepts, /无限制/);
  assert.match(concepts, /工作区即使位于 4torm 目录之外/);
  assert.match(concepts, /主要约束框架内置文件工具/);
  assert.doesNotMatch(concepts, /`strict`|`relaxed`|分三档/);
});

test('安全章节说明跨功能区自动校验及工具边界', async () => {
  const security = await fs.readFile(
    new URL('../docs/architecture/security.md', import.meta.url),
    'utf8',
  );

  assert.match(security, /所有功能区调用框架内置文件工具时自动生效/);
  assert.match(security, /工作区可以位于 4torm 目录之外/);
  assert.match(security, /Agent 记忆、会话内容以及各功能区的工作区文件不属于这类限制/);
  assert.match(security, /MCP 工具和自定义执行器.*不自动继承文件路径守卫/);
  assert.doesNotMatch(security, /`strict`|`relaxed`|沙箱级别/);
});

test('Agent 管理说明权限随 Agent 自动应用到功能区工作区', async () => {
  const agents = await fs.readFile(
    new URL('../docs/guide/agents.md', import.meta.url),
    'utf8',
  );

  assert.match(agents, /执行权限会随 Agent 保存/);
  assert.match(agents, /共享工作区会自动纳入允许范围/);
  assert.match(agents, /安全与隔离/);
});

test('五个功能区说明内置文件工具使用的当前工作区', async () => {
  const files = {
    chat: '../docs/modes/chat.md',
    convection: '../docs/modes/convection.md',
    cyclone: '../docs/modes/cyclone.md',
    tradewind: '../docs/modes/tradewind.md',
    tide: '../docs/modes/tide.md',
  } as const;
  const docs = Object.fromEntries(await Promise.all(
    Object.entries(files).map(async ([name, file]) => [
      name,
      await fs.readFile(new URL(file, import.meta.url), 'utf8'),
    ]),
  ));

  assert.match(docs.chat, /Agent 的工作区.*执行权限/);
  assert.match(docs.convection, /会议室工作区.*当前工作区/);
  assert.match(docs.cyclone, /工作室共享目录.*当前工作区/);
  assert.match(docs.tradewind, /工作流共享目录.*当前工作区/);
  assert.match(docs.tide, /当前模型、工具、技能和执行权限配置/);
});

test('扩展文档区分内置文件守卫、自定义执行器与 MCP', async () => {
  const [tools, mcp] = await Promise.all([
    fs.readFile(new URL('../docs/extend/tools.md', import.meta.url), 'utf8'),
    fs.readFile(new URL('../docs/extend/mcp.md', import.meta.url), 'utf8'),
  ]);

  assert.match(tools, /sandboxLevel: 'project' \| 'unrestricted'/);
  assert.match(tools, /内置文件工具.*自动执行路径校验/);
  assert.match(tools, /自定义执行器.*需要主动调用.*resolvePath/s);
  assert.doesNotMatch(tools, /`strict`|`relaxed`|旧数据兼容字段，目前不会改变/);
  assert.match(mcp, /本地工具的工作区边界不会自动作用于 MCP Server/);
});

test('README 与架构基线不再保留旧三档权限说明', async () => {
  const files = [
    '../README.md',
    '../docs/architecture/behavior-freeze.md',
    '../docs/architecture/data-layout.md',
  ];
  const docs = await Promise.all(files.map(async file => ({
    file,
    text: await fs.readFile(new URL(file, import.meta.url), 'utf8'),
  })));

  for (const { file, text } of docs) {
    assert.doesNotMatch(text, /`strict`|`relaxed`|三级权限|三档/, file);
  }
  assert.match(docs[0].text, /项目级.*无限制/s);
  assert.match(docs[1].text, /旧值.*映射为项目级/);
  assert.match(docs[1].text, /符号链接/);
  assert.match(docs[2].text, /执行权限配置/);
});
