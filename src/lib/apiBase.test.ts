import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveStreamBase } from './apiBase';

test('development streams stay on the trusted page origin by default', () => {
  assert.equal(resolveStreamBase(true, undefined), '');
  assert.equal(resolveStreamBase(true, ''), '');
});

test('a trusted HTTPS origin can opt development streams into direct HTTP/2', () => {
  assert.equal(resolveStreamBase(true, 'https://dev.example.test:3001'),
    'https://dev.example.test:3001');
  assert.throws(() => resolveStreamBase(true, 'http://dev.example.test:3001'), /HTTPS/);
  assert.throws(() => resolveStreamBase(true, 'https://dev.example.test/path'), /origin/);
});

test('production streams remain same-origin even if a development address is configured', () => {
  assert.equal(resolveStreamBase(false, 'https://dev.example.test:3001'), '');
});
