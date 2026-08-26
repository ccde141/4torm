# Troubleshooting

This page groups common startup, model-request, and conversation problems by symptom. First verify the provider URL, model name, and current agent configuration.

## LM Studio Reports an Empty Assistant Message

Errors such as `assistant message must not be empty` or `No user query found in messages` usually mean the conversation contains an empty assistant placeholder that the model's prompt template does not accept.

1. Find the current model in **Provider Management**.
2. Change its profile to **LM Studio**.
3. Send the message again.

This profile only normalizes requests sent to LM Studio. It does not alter the stored conversation or other models from the same provider. Random LM Studio ports and proxies prevent reliable URL-only detection, so the profile may need to be selected manually.

## Model Request Returns 400

Check whether:

- the API URL contains the correct endpoint prefix;
- the model name matches the server's actual name;
- the selected protocol is OpenAI Compatible or Anthropic Messages as appropriate;
- custom headers contain valid JSON; and
- the model has not been assigned an incompatible profile.

If the error started after switching models, send the message again. 4torm rebuilds conversation history for the current target model rather than reusing the previous model's request format.

## Image Sending Fails

The image check only verifies that the endpoint accepts a test image; it does not guarantee reliable understanding of every image.

Check whether the current model passed the image-understanding check, the format and size meet provider limits, the protocol and proxy allow image input, and the model itself supports vision.

## Documentation Does Not Open

A normal installation builds the documentation after root dependencies are installed. If the server cannot find the documentation build, run this at the repository root:

```bash
npm run docs:build
```

Then restart the service.

## The Cause Is Still Unclear

Keep the complete error, model name, provider protocol, and reproduction steps. A failed capability probe alone does not prove the model lacks that capability: network errors, authentication failures, proxy restrictions, and temporary provider errors can look identical.
