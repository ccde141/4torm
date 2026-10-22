# Model Providers

In **Provider Management** in the Console, first select the provider type that matches the model service you actually use. Then enter its API URL and key. The type determines how 4torm prepares requests; changing only the URL or model name cannot replace choosing the right type.

The frontend and backend can run on different operating systems, such as a Linux backend with a browser or desktop client on Windows. The backend connects to the model service. See [Independent Backend and Remote Clients](https://github.com/ccde141/4torm/blob/master/REMOTE.md) (Chinese) for deployment instructions.

## Add Models

Select **Add Provider** and choose a preset. Presets include OpenAI Compatible, DeepSeek, Kimi, Alibaba Cloud Model Studio, Zhipu AI, and MiniMax, as well as local inference services such as LM Studio, llama.cpp, Ollama, and vLLM. You can edit the name, URL, and key afterward. Leave the key empty if your local service does not require one.

![Provider configuration and an example model awaiting capability tests](/images/guide/provider-current.png)

Select **Fetch Model List**, then choose the models you want to use in 4torm. If the service does not expose a complete list, add the exact model ID supplied by that service manually.

Model discovery, capability tests, conversations, and compaction all run on the backend. In an API URL, `127.0.0.1` means the backend computer or container. A Windows client connected to a Linux backend therefore needs a model URL reachable from Linux. A `404` from model discovery may mean the service does not expose a model-list endpoint; it does not by itself prove that chat is unavailable.

## Configure and Test

Start with the default provider parameters and per-model configuration. Change a parameter only when your service or model explicitly requires it. If the model list loads and capability tests pass but an actual conversation fails, check whether the per-model parameters form a combination the service does not accept.

The dedicated DeepSeek type defaults to **8,192 output tokens** and allows at most **393,216**. Context capacity and the output limit are separate settings; a million-token context capacity is not a valid value for maximum output.

Model rows provide tool-calling and **Image understanding** tests. A test confirms that the current endpoint accepts one corresponding test request; it cannot guarantee performance on every task. After an image test passes, you can send images to that model in Monsoon. If it fails, use the returned error to distinguish capability limits from authentication or connection problems.
