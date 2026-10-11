import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameworkError } from '../shared/framework-error.js';
import {
  OBSERVATION_LIMITS,
  boundObservationText,
  normalizeObservationQuery,
} from './budget.js';

test('observation query uses bounded defaults', () => {
  assert.deepEqual(normalizeObservationQuery({}), {
    view: 'summary',
    limit: OBSERVATION_LIMITS.defaultItems,
    eventLimit: OBSERVATION_LIMITS.defaultEvents,
    maxTextChars: OBSERVATION_LIMITS.defaultTextChars,
    maxTextLines: OBSERVATION_LIMITS.defaultTextLines,
  });
});

test('observation query clamps requested output to server maximums', () => {
  const query = normalizeObservationQuery({
    view: 'detail',
    limit: 10_000,
    eventLimit: 10_000,
    maxTextChars: 1_000_000,
    maxTextLines: 10_000,
    cursor: 'revision-7:item-20',
  });

  assert.equal(query.limit, OBSERVATION_LIMITS.maxItems);
  assert.equal(query.eventLimit, OBSERVATION_LIMITS.maxEvents);
  assert.equal(query.maxTextChars, OBSERVATION_LIMITS.maxTextChars);
  assert.equal(query.maxTextLines, OBSERVATION_LIMITS.maxTextLines);
  assert.equal(query.cursor, 'revision-7:item-20');
});

test('observation query rejects non-positive budgets', () => {
  assert.throws(
    () => normalizeObservationQuery({ limit: 0 }),
    (error: unknown) => error instanceof FrameworkError
      && error.data.code === 'OBSERVATION_BUDGET_INVALID',
  );
});

test('text projection enforces both line and character budgets', () => {
  const lineBounded = boundObservationText('one\ntwo\nthree', {
    maxChars: 100,
    maxLines: 2,
  });
  assert.deepEqual(lineBounded, {
    text: 'one\ntwo',
    truncated: true,
    originalChars: 13,
    originalLines: 3,
  });

  const charBounded = boundObservationText('123456789', {
    maxChars: 5,
    maxLines: 10,
  });
  assert.deepEqual(charBounded, {
    text: '12345',
    truncated: true,
    originalChars: 9,
    originalLines: 1,
  });
});
