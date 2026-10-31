import assert from 'node:assert/strict';
import test from 'node:test';
import { WORKLOG_WINDOW_SIZE, worklogRunStart, worklogWindow } from './worklog-window';

test('a long execution mounts only its latest bounded display window', () => {
  const records = Array.from({ length: 241 }, (_, index) => ({ index }));
  const page = worklogWindow(records);
  assert.equal(page.items.length, WORKLOG_WINDOW_SIZE);
  assert.equal(page.start, 161);
  assert.equal(page.end, 241);
  assert.equal(page.previousEnd, 161);
  assert.equal(page.nextEnd, null);
  assert.equal(page.followingLatest, true);
  assert.equal(page.items[0], records[161]);
  assert.equal(page.items.at(-1), records.at(-1));
  assert.equal(records.length, 241);
});

test('older windows collectively expose every original record without modifying it', () => {
  const records = Object.freeze(Array.from({ length: 225 }, (_, index) => Object.freeze({ index })));
  let page = worklogWindow(records);
  const visited = [...page.items];
  while (page.previousEnd !== null) {
    page = worklogWindow(records, page.previousEnd);
    assert.ok(page.items.length <= WORKLOG_WINDOW_SIZE);
    visited.unshift(...page.items);
  }
  assert.deepEqual(visited, records);
  assert.equal(page.start, 0);
  assert.equal(page.end, 65);
  assert.equal(page.nextEnd, 145);
  assert.equal(worklogWindow(records, page.nextEnd).items[0], records[65]);
});

test('reading older work stays anchored while execution produces new records', () => {
  const records = Array.from({ length: 225 }, (_, index) => index);
  const older = worklogWindow(records, worklogWindow(records).previousEnd);
  const growing = [...records, ...Array.from({ length: 100 }, (_, index) => index + 225)];
  const stillReading = worklogWindow(growing, older.end);
  assert.deepEqual(stillReading.items, older.items);
  assert.equal(stillReading.followingLatest, false);
  assert.equal(stillReading.nextEnd, 225);
  assert.equal(worklogWindow(growing).items.at(-1), 324);
  assert.equal(worklogWindow(growing).followingLatest, true);
});

test('short, empty and replaced histories retain valid display windows', () => {
  assert.deepEqual(worklogWindow([]).items, []);
  assert.equal(worklogWindow([]).previousEnd, null);
  assert.equal(worklogWindow([]).nextEnd, null);
  assert.deepEqual(worklogWindow([1, 2], 200).items, [1, 2]);
  assert.equal(worklogWindow([1, 2]).nextEnd, null);
});

test('appending work keeps the same source group identity across shifted windows and semantic boundaries', () => {
  const records = [{ kind: 'text' }, ...Array.from({ length: 241 }, () => ({ kind: 'tool' })),
    { kind: 'team' }, ...Array.from({ length: 200 }, () => ({ kind: 'tool' }))];
  const isTool = (item: { kind: string }) => item.kind === 'tool';
  assert.equal(worklogRunStart(records, 161, isTool), 1);
  assert.equal(worklogRunStart(records, 162, isTool), 1);
  const page = worklogWindow(records);
  const grown = [...records, { kind: 'tool' }];
  const nextPage = worklogWindow(grown);
  assert.equal(nextPage.start, page.start + 1);
  assert.equal(worklogRunStart(records, page.start, isTool), 243);
  assert.equal(worklogRunStart(grown, nextPage.start, isTool), 243);
  assert.equal(worklogRunStart(records, 242, isTool), 242);
  assert.equal(worklogRunStart(records, 0, isTool), 0);
});
