# Model Providers

A model provider determines which service 4torm calls and how it prepares context, generation parameters, reasoning content, and tool messages. When creating a configuration, choose the **provider type** that matches the actual service. This explicit identity selects the correct behavior without relying on guesses from the API URL or model name.

## Add a Provider

Open **Provider Management** in the Console, select **Add Provider**, and choose a preset. Common types covered by the current presets include:

- **Generic compatible endpoint**: OpenAI Compatible, for other services compatible with OpenAI Chat Completions
- **Cloud providers**: services such as DeepSeek, Kimi, Alibaba Cloud Model Studio, Zhipu AI, and MiniMax
- **Local inference runtimes**: runtimes such as LM Studio, llama.cpp, Ollama, and vLLM

After creation, edit the name, API URL, and API Key. Leave the key empty for a local service that does not require one.

**Fetch Model List** reads the models exposed by the service. Some services omit this endpoint or return only part of their catalog; enter the exact server-side model ID manually in that case.

## Per-model Configuration and Capability Tests

The configuration selector on each model row remains available for legacy compatibility and exceptional model-level behavior. With a new explicit provider preset, normally leave it on **Auto** so the provider identity selects the adapter.

The **Image understanding** test confirms only that the endpoint accepted one test image. A passing result allows image input in Monsoon, but stable understanding, supported formats, and size limits still belong to the model and provider. Authentication, proxy, and temporary service failures can also make the test inconclusive.

## Storage

Provider configuration is stored in `data/providers.json`, including API URLs, API keys, enabled models, provider parameters, custom fields, and capability results.
