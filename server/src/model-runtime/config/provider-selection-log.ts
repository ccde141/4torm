import {
  resolveProviderSelection,
  type ProviderSelectionInput,
} from './provider-selection.js';

export function resolveLoggedProviderSelection(
  providerId: string,
  input: ProviderSelectionInput,
  model: string,
) {
  return resolveProviderSelection(input, model, diagnostic => {
    console.warn(
      `[model-runtime] provider ${providerId} (${diagnostic.providerType}) `
      + `configured transport ${diagnostic.configuredTransport} is incompatible; `
      + `using ${diagnostic.effectiveTransport}`,
    );
  });
}
