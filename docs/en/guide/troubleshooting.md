# Troubleshooting

4torm preserves the HTTP status and error body returned by the framework or model provider whenever possible. Use the status to identify the failure category, then treat the complete error body as the more specific explanation.

## HTTP Status Codes

| Status | Common causes | Check first |
|---|---|---|
| `400` | Invalid request or configuration; missing fields; the model rejects current parameters, messages, tools, or images; context exceeds the model limit | Provider type, model ID, provider parameters, context, and the error body |
| `401` | Missing, invalid, or expired API key | API key and authentication method |
| `403` | The key cannot access the model or resource; a local file tool rejects an out-of-scope path | Provider permissions, model access, and agent execution permission |
| `404` | The API URL, model, agent, conversation, task, or another target does not exist | Whether the address and object still exist, and whether the model ID is exact |
| `409` | The operation conflicts with current state, such as an active run, pending question, duplicate name, or task that cannot yet be deleted | Finish the active operation or resolve the pending state shown in the UI |
| `413` | The request body, image, or attachment exceeds the service limit | File size and server request limits |
| `415` | Unsupported file or request media type | File format and Content-Type |
| `429` | Provider rate, concurrency, or quota limit | Account quota, concurrency, and request rate |
| `500` | Internal processing, storage, or parsing failure in 4torm or the target service | Complete error body and backend log |
| `502` | The proxy cannot reach a local inference service, MCP Server, or upstream API, or the upstream response is invalid | Running service, API URL, port, proxy, and network |
| `503` | The model service is temporarily unavailable, loading, or overloaded | Inference-service state and current load |
| `504` | The upstream service or gateway did not finish the request in time | Whether the model is still running, network state, and gateway timeout |

The agent execution path applies up to three retries for `429`, `502`, and `503`. If one of these errors is still shown, the failure did not recover during those retries.
