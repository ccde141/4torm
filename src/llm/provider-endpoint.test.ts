import test from 'node:test';
import assert from 'node:assert/strict';
import { providerBaseUrl } from './provider-endpoint.js';

test('keeps provider roots and removes only the requested endpoint suffix', () => {
  assert.equal(
    providerBaseUrl('https://proxy.example/tenant/v1', '/messages'),
    'https://proxy.example/tenant/v1',
  );
  assert.equal(
    providerBaseUrl('https://proxy.example/tenant/v1/messages/', '/messages'),
    'https://proxy.example/tenant/v1',
  );
  assert.equal(
    providerBaseUrl('https://proxy.example/v1/chat/completions', '/chat/completions'),
    'https://proxy.example/v1',
  );
});

test('does not remove a different endpoint suffix', () => {
  assert.equal(
    providerBaseUrl('https://proxy.example/v1/models', '/messages'),
    'https://proxy.example/v1/models',
  );
});
