# 季风 Chat · 对话

季风是 4torm 的基础对话模式。你与单个 Agent 进行多轮对话,Agent 可调用工具完成任务,也能把子任务委托给独立 Sub-Agent 并行处理。

> 季风是其余四种模式的地基——所有协作模式的 Agent 执行都复用同一套 `SessionRunner` + ReAct 循环。

![季风对话 - Sub-Agent 调用](/screenshots/季风-Subagent调用1.png)

## 创建 Agent

1. 进入**控制台**,点击「新建 Agent」
2. 填写名称、选择模型提供商和模型
3. **角色提示词** —— 描述 Agent 的职责和行为
4. **工具** —— 勾选 Agent 可调用的工具(读文件、写代码、搜索等)
5. **沙箱级别** —— 文件访问范围(`strict` / `relaxed` / `unrestricted`)
6. 保存后,Agent 注册到 `data/agents/registry.json`

## 开始对话

1. 侧栏切换到 **季风 · 对话**
2. 顶部选择目标 Agent
3. 输入消息,按 Enter 发送

Agent 进入 ReAct 循环:思考 → 调工具 → 观察 → 循环 → 输出回答。工具调用过程在气泡中折叠展示。

## Sub-Agent 委托

Agent 可在对话中调用 `delegate` 工具派生子 Agent:

```
<action tool="delegate">
{
  "task": "分析 src/ 目录下的代码结构",
  "context": "项目是一个 React 应用",
  "systemPrompt": "你是代码分析专家,聚焦目录结构与模块职责"
}
</action>
```

子 Agent 独立执行,完成后返回摘要。适用于拆分大任务、并行处理。

![季风对话 - Sub-Agent 进行中](/screenshots/季风-Subagent调用2.png)

## 会话管理

- 每个 Agent 的对话保存在 `data/agents/{id}/sessions/` 下
- 侧栏历史列表可切换、重命名会话
- 点击 **Compact** 按钮压缩上下文(移除旧工具调用细节,保留要点)

## 停止

- 执行中点击 **停止** 按钮立即中断 LLM 请求和工具调用

## 文件工作区

每个 Agent 拥有独立工作区 `data/agents/{id}/.workspace/`:

- **role-prompt.md** —— 角色提示词(真理来源,引擎运行时读取)
- **config.json** —— 温度、工具列表等配置
