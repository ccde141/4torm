import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSkippedInputNotice, summarizeSkippedInputNotice } from './human-input-presentation';

const skipped = [
  'read_file: （因人类插话取消，未执行；请根据新的要求重新决定后续操作。）',
  'read_file: （因人类插话取消，未执行；请根据新的要求重新决定后续操作。）',
  'load_skill: （因人类插话取消，未执行；请根据新的要求重新决定后续操作。）',
];

test('skipped steering work lists unique names once and shares one localized reason', () => {
  assert.equal(
    formatSkippedInputNotice(skipped, 'zh-CN'),
    '已跳过的工具：read_file；load_skill（因人类插话取消，未执行；请根据新的要求重新决定后续操作。）',
  );
  assert.equal(
    formatSkippedInputNotice(skipped, 'en-US'),
    'Skipped tools: read_file; load_skill (Cancelled by human steering; not executed. Reconsider the next action based on the new request.)',
  );
});

test('empty skipped work does not create a notice', () => {
  assert.equal(formatSkippedInputNotice([], 'zh-CN'), '');
});

test('skipped work exposes names separately so only identifiers and separators can be emphasized', () => {
  assert.deepEqual(summarizeSkippedInputNotice(skipped, 'zh-CN'), {
    prefix: '已跳过的工具：',
    names: 'read_file；load_skill',
    reason: '（因人类插话取消，未执行；请根据新的要求重新决定后续操作。）',
  });
});
