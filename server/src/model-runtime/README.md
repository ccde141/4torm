# Model Runtime

模型运行适配域是所有功能岛与模型服务之间的唯一边界。它把稳定的框架语义与
Provider、协议和部署实例差异分开，避免季风、对流、气旋、信风和潮汐直接识别
具体服务。

## 依赖方向

```text
feature island -> runtime -> provider -> transport
                         -> capabilities
                         -> context
                         -> scheduling
```

- `contracts/`：无运行时依赖的稳定类型和判别字段。
- `providers/`：llama.cpp、通用 OpenAI 等服务实现差异。
- `transports/`：OpenAI Chat Completions、Responses、Anthropic Messages 等线路协议。
- `capabilities/`：声明、探测、有效能力与校正诊断。
- `context/`：预算事实和压缩决策，不拥有功能岛历史。
- `scheduling/`：按 Provider 实例容量调度。
- `runtime/`：功能岛唯一允许调用的模型执行入口。

## 不变量

1. `providerType` 由用户配置决定，运行时探测不得静默改变 Provider 身份。
2. `transport` 与 Provider 身份独立；多个 Provider 可以复用同一协议。
3. 探测只补充或校正能力，失败不等于能力不支持。
4. `declared`、`observed`、`effective` 分开保存，不回写覆盖用户声明。
5. 上下文层只返回决策，各功能岛继续拥有自己的归档和摘要语义。
6. 基础层不自动重试模型操作，错误必须保留原始诊断。

迁移期间旧 `engine/shared/llm-bridge.ts` 保持公开行为，新实现逐层迁入后再删除兼容入口。
