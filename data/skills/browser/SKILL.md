# 浏览器

使用 `browser` 在当前会话所属的隔离浏览器中完成网页访问与交互。浏览器页面、截图、状态、控制权和页面事件由框架维护，不要尝试通过命令行、脚本或其他工具绕过它。

浏览器与日常 Chrome、Edge Profile 隔离。不要假设页面带有用户的登录态、Cookie、扩展或历史记录。

## 操作顺序

每次页面交互都遵循这个顺序：

1. `open` 打开明确 URL。
2. 阅读工具返回的 `sessionId`、`revision`、`text` 和 `targetId` 目标列表。
3. 对明确目标调用 `click`、`type` 或 `press`，并带上刚读到的 `revision` 和 `targetId`。
4. 再阅读动作返回的新快照和 outcome。
5. 页面仍在加载或等待外部结果时，调用 `wait`，再根据新快照决定下一步。
6. 任务完成后保持会话；浏览器由用户界面的关闭操作统一销毁。

不要从页面名称猜测控件位置；只使用最新快照中的 `targetId`。需要真实鼠标位置时使用 `click_at`，坐标必须来自当前快照截图。

## Action

| action | 必填字段 | 用途 |
| --- | --- | --- |
| `open` | `url` | 打开或复用页面。Windows 默认使用系统 Edge；可显式请求隔离 Chromium。 |
| `inspect` | `revision` | 再次读取当前页面状态。 |
| `click` | `targetId`, `revision` | 点击快照中的目标。 |
| `click_at` | `x`, `y`, `revision` | 点击当前快照坐标。 |
| `type` | `targetId`, `text`, `revision` | 将完整文本写入输入目标。 |
| `press` | `key`, `revision` | 向当前焦点发送按键；可选 `targetId`。 |
| `wait` | `text`, `revision` | 明确等待 1-10000 毫秒，再读取页面。 |

`revision` 与 `targetId` 只在当前页面快照中有效。收到 stale 错误后，不要重试旧动作；先 `inspect`，再按新快照决定。

## 人类接管

任务板显示浏览器现场。人类接管时，框架会拒绝 Agent 的浏览器动作，避免双方同时改变同一页面。人类导航、输入或页面变化会推进 revision 并显式通知 Agent。

接管结束后，必须先 `inspect` 获取新的 revision 和目标列表。接管前拿到的 targetId 与 revision 均不可继续使用。

## 输出与失败

优先向用户总结网页中的关键结果、来源和未完成事项，不要回传整页正文。

页面无法打开、目标失效、页面被遮罩、弹窗被阻止、revision 过期或控制权不在 Agent 时，直接说明工具返回的真实原因。不要把失败描述为完成，不要无提示重试，也不要改用浏览器之外的方式绕过页面状态。
