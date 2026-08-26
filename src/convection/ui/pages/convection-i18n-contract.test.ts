import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name: string) => fs.readFileSync(`src/convection/ui/pages/${name}`, 'utf8');

test('convection turn cards localize framework activity without changing message payloads', () => {
  const card = read('ConvectionTurnCard.tsx');
  assert.match(card, /useLocale/);
  assert.match(card, /convection\.turn\.preparing/);
  assert.match(card, /chat\.tool\.params/);
});

test('convection meeting shell localizes controls while retaining stable speaker markers', () => {
  const page = read('ConvectionPage.tsx');
  assert.match(page, /useLocale/);
  assert.match(page, /convection\.page\.rooms/);
  assert.match(page, /convection\.page\.publicPlaceholder/);
  assert.match(page, /m\.speaker === '人类'/);
  assert.match(page, /speaker: '系统'/);
});

test('a participant failure closes only that streaming bubble', () => {
  const page = read('ConvectionPage.tsx');
  assert.match(page, /ev\.type === 'agent-failed'/);
  assert.match(page, /convection\.page\.participantFailed/);
  assert.match(page, /streaming: false/);
});
