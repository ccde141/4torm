import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Run the real component under a bounded heap; a discarded LCS matrix can kill
// a renderer before an error boundary can report it. CSS has no SSR behaviour.
const cssLoader = `export function load(url, context, nextLoad) {
  if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
  return nextLoad(url, context);
}`;
const renderer = `
  const { register } = await import('node:module');
  register(${JSON.stringify(`data:text/javascript,${encodeURIComponent(cssLoader)}`)}, import.meta.url);
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { LocaleProvider } = await import(${JSON.stringify(new URL('../../../i18n/LocaleContext.tsx', import.meta.url).href)});
  const { MeetingMessageItem } = await import(${JSON.stringify(new URL('./MeetingMessageItem.tsx', import.meta.url).href)});
  const results = [2, 5000].map(count => {
    const before = Array.from({ length: count }, (_, i) => 'before-' + i).join('\\n');
    const after = Array.from({ length: count }, (_, i) => 'after-' + i).join('\\n');
    return renderToStaticMarkup(createElement(LocaleProvider, null,
      createElement(MeetingMessageItem, { msg: {
        speaker: '开发工位', content: '', timestamp: 0,
        toolCalls: [{ tool: 'write_file', args: { path: 'report.txt', content: after },
          diff: { before }, status: 'error', result: '写入失败：目录只读' }],
      } })));
  });
  console.log(JSON.stringify(results));
`;

test('collapsed meeting file cards retain counts without allocating an unbounded diff', () => {
  const result = spawnSync(process.execPath,
    ['--max-old-space-size=128', '--import', 'tsx', '--input-type=module', '-e', renderer],
    { cwd: fileURLToPath(new URL('../../../../', import.meta.url)), timeout: 10_000,
      encoding: 'utf8', maxBuffer: 100_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const [small, large] = JSON.parse(result.stdout) as string[];
  for (const [markup, count] of [[small, 2], [large, 5000]] as const) {
    assert.match(markup, /aria-expanded="false"/);
    assert.ok(markup.includes(`+${count}`));
    assert.ok(markup.includes(`-${count}`));
    assert.match(markup, /tw-meeting-tool--error/);
  }
});
