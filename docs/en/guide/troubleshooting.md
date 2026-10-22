# Troubleshooting

When an error appears, read its full message before relying on the HTTP status. 4torm maps some model-service failures to framework errors. For example, the outer interface or API may show `502` while the message says the upstream service returned `HTTP 503`. In that case, investigate the upstream service indicated by the message instead of treating the outer status as the whole explanation.

## Find Where the Failure Occurred

- **The interface cannot reach 4torm:** Check that the backend is running. In browser production mode, also check whether the browser trusts the local HTTPS certificate.
- **The interface opens, but a model request fails:** Check the provider type, API URL, key, exact model ID, and per-model parameters. Fetching a model list successfully does not prove that the service accepts the parameters used for a full conversation.
- **A file or attachment operation fails:** Read that operation's message, then check format, size, and the Agent's execution permissions.

## An Endpoint Is Missing After an Update

If a new screen reports `Route ... not found`, check which backend the client uses and whether that backend has been updated. Reloading the page does not update an older server process. In source development, `tsx watch` restarts when server source changes. For a production service, stop the old process and start the updated version, then reload the client.

Remote Electron loads the webpage served by the backend, so update and build that backend's source checkout. See [Independent Backend and Remote Clients](https://github.com/ccde141/4torm/blob/master/REMOTE.md) (Chinese) for deployment and address configuration.

## Check the Error Details

| Status or message | Common cause | Check first |
|---|---|---|
| `400`, `422` | The model rejects request content or parameters, or required fields are missing | Provider type, model ID, per-model configuration, and error message |
| `401`, `403` | An invalid key or insufficient account or model access; `403` may also mean a local file path was denied | Determine whether the error came from the model service or a local tool, then check that permission |
| `404` | The URL, model, or target object does not exist | API URL, model ID, and current object |
| `409` | An action conflicts with current state, such as a task still running | Inspect the active run or pending state before acting again |
| `413`, `415` | A file is too large or its media type is unsupported | File size, format, and endpoint limits |
| `429` | The model service reached a rate, concurrency, or quota limit | Provider quota and concurrency limits |
| `500` | Internal processing or storage failed in 4torm | Keep the error message and inspect the backend log |
| `502`, `503`, `504` | An upstream service cannot be reached, is unavailable, or timed out; the status may also be a framework mapping | Read any upstream status in the message, then check the service, URL, network, and load |
