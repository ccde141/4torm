# Model Providers

Model providers determine where 4torm calls its models. Open **Provider Management** in the Console to add an OpenAI Compatible or Anthropic Messages endpoint and enable multiple models from the same provider.

## Add a Provider

Select **Add Provider**, then choose a preset or start with a blank configuration.

Each provider requires:

- **Provider name**: identifies the provider in model lists.
- **API URL**: the endpoint supplied by the service.
- **API Key**: the credential used for requests; leave it empty when none is required.

After saving the URL and key, select **Fetch Model List** to read the models exposed by the service. Select the models you need and confirm to add them to agent model selectors.

Some services expose no model-list endpoint or return only part of their catalog. In that case, enter the official model name and add it manually.

## API Protocols

4torm supports two protocols:

- **OpenAI Compatible** for OpenAI, most Chinese model services, aggregators, and local inference services.
- **Anthropic Messages** for Anthropic's official API and compatible services.

The protocol defaults to automatic detection. If a proxy or gateway rewrites the URL, or detection does not match the actual endpoint, select the protocol manually under advanced options.

For nonstandard authentication, enter custom headers as JSON:

```json
{
  "x-api-key": "sk-xxx"
}
```

Custom headers accompany model requests and may contain secrets. Never commit them to a public repository.

## Model Profiles

Models from the same provider may use different parameter conventions. **Auto** is normally sufficient: 4torm normalizes request parameters based on the endpoint and model name.

If detection is wrong, choose a profile for the individual model. Available profiles include generic OpenAI, Kimi, DeepSeek, Zhipu GLM reasoning, Qwen reasoning, OpenRouter, MiniMax, and SiliconFlow reasoning.

This setting changes requests for that model only, not other models under the provider.

## Image Understanding

The image-understanding check verifies whether the current endpoint accepts image input. After it passes, that model can receive images in Monsoon conversations.

A successful check only confirms that one request. Stable image understanding, supported formats, and size limits still depend on the model and provider.

A failed check does not necessarily mean the model has no vision capability. Proxies, access restrictions, and temporary provider errors may affect the result; compare it with provider documentation and an actual conversation.

## Storage

Provider configuration is stored in `data/providers.json`, including API URLs, API keys, enabled models, and model profiles.

The file is excluded from Git by default, but still contains secrets and must be handled as private configuration.
