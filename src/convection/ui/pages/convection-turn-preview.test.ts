import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '../../../i18n/LocaleContext';
import { LocaleContext } from '../../../i18n/locale-context';
import { resolveMessage, type Locale } from '../../../i18n/locale';
import type { ConvectionTurnMessage } from './ConvectionTurnCard';

registerHooks({ load(url, context, nextLoad) {
  return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context);
} });
const { default: ConvectionTurnCard } = await import('./ConvectionTurnCard');
const { default: ConvectionChairMessage } = await import('./ConvectionChairMessage');

function render(node: ReactNode, locale: Locale = 'zh-CN') {
  const content = locale === 'zh-CN' ? node : createElement(LocaleContext.Provider,
    { value: { locale, setLocale: () => {}, t: (key, values) => resolveMessage(locale, key, values) } }, node);
  return renderToStaticMarkup(createElement(LocaleProvider, null, content));
}

function publicTurn(message: ConvectionTurnMessage, locale: Locale = 'zh-CN') {
  return render(createElement(ConvectionTurnCard, {
    message, messageId: 'public-fixture', onEdit: () => {}, onDelete: () => {},
  }), locale);
}

function chair(message: ComponentProps<typeof ConvectionChairMessage>['message'],
  options: { suppressWaiting?: boolean; locale?: Locale } = {}) {
  return render(createElement(ConvectionChairMessage, {
    message, messageId: 'chair-fixture', suppressWaiting: options.suppressWaiting,
  }), options.locale);
}

const completed: ConvectionTurnMessage = {
  speaker: '核验员', content: '已完成本轮核验。', reasoning: '先比对输入，再核对输出。',
  toolCalls: [
    { tool: 'read_fixture', args: { path: 'fixture-a.md' }, result: '第一项返回已收到', status: 'done' },
    { tool: 'check_fixture', args: { source: 'fixture-source', revision: 2,
      enabled: false, bounds: [0, 20], nested: { count: 3 } }, result: '第二项仍需核对', status: 'error' },
  ],
};

function assertSeparateControls(html: string, mainClass: string, heightClass: string) {
  const main = new RegExp(`<button[^>]*class="${mainClass}"([^>]*)>`).exec(html);
  const height = new RegExp(`<button[^>]*class="${heightClass}"([^>]*)>`).exec(html);
  assert.ok(main && height, 'Both visibility and height controls must exist');
  assert.match(main[1], /aria-expanded="true"/);
  assert.match(height[1], /aria-pressed="false"/);
  const region = /aria-controls="([^"]+)"/.exec(main[1])?.[1];
  assert.ok(region);
  assert.ok(height[1].includes(`aria-controls="${region}"`));
  assert.ok(html.includes(`id="${region}"`));
  const mainEnd = html.indexOf('</button>', main.index);
  assert.ok(mainEnd < height.index, 'The height button must be a sibling, not a nested button');
}

test('public work and reasoning remain visible with independent collapse and height controls', () => {
  const html = publicTurn(completed);
  assertSeparateControls(html, 'convection-turn__process-summary', 'convection-turn__process-height');
  assertSeparateControls(html, 'reasoning-block__header', 'reasoning-block__height-control');
  assert.match(html, /class="convection-turn__process-body"[^>]*role="region"/);
  assert.match(html, /先比对输入，再核对输出。/);
  assert.match(html, /第一项返回已收到/);
  assert.match(html, /第二项仍需核对/);
  assert.match(html, /convection-turn__answer--separated/);
  assert.match(html, /已完成本轮核验。/);
  assert.doesNotMatch(html, /process-body is-expanded|reasoning-block__preview-body is-expanded/);
});

test('public tool order and typed arguments survive presentation without payload changes', () => {
  const before = JSON.stringify(completed);
  const html = publicTurn(completed);
  assert.ok(html.indexOf('read_fixture') < html.indexOf('check_fixture'));
  for (const value of ['fixture-source', '&quot;revision&quot;: 2', '&quot;enabled&quot;: false',
    '&quot;bounds&quot;:', '&quot;nested&quot;:', '&quot;count&quot;: 3']) assert.ok(html.includes(value), value);
  assert.equal(JSON.stringify(completed), before);
});

test('public error and running tools retain their distinct visible statuses', () => {
  const failed = publicTurn(completed);
  assert.match(failed, /convection-turn__tool--error/);
  assert.doesNotMatch(failed, /thinking-card__tool-spinner/);
  const running = publicTurn({ speaker: '核验员', content: '正在核验', streaming: true,
    toolCalls: [{ tool: 'check_fixture', args: { source: 'active-source' }, status: 'running' }] });
  assert.match(running, /convection-turn__tool--running/);
  assert.match(running, /active-source/);
  assert.match(running, /thinking-card__tool-spinner/);
  assert.match(running, /正在核验/);
});

test('public plain answers and archived summaries avoid empty process framing', () => {
  const plain = publicTurn({ speaker: '核验员', content: '只有最终结论' });
  assert.match(plain, /只有最终结论/);
  assert.doesNotMatch(plain, /process-summary|answer--separated|reasoning-block/);
  const archive = publicTurn({ speaker: '系统', content: '[会议历史摘要]归档内容',
    reasoning: '不应显示为本轮思考', toolCalls: completed.toolCalls });
  assert.match(archive, /compaction-history__toggle/);
  assert.match(archive, /历史摘要/);
  assert.doesNotMatch(archive, /convection-turn__process|reasoning-block|不应显示为本轮思考/);
});

test('private assistant reasoning uses the same preview while user messages remain plain', () => {
  const assistant = chair({ role: 'assistant', content: '私聊结论', reasoning: '私聊核验思路' });
  assert.match(assistant, /私聊核验思路/);
  assert.match(assistant, /私聊结论/);
  assert.match(assistant, /convection-chair-turn__answer--separated/);
  assertSeparateControls(assistant, 'reasoning-block__header', 'reasoning-block__height-control');
  const user = chair({ role: 'user', content: '请核验这份资料' });
  assert.match(user, /请核验这份资料/);
  assert.doesNotMatch(user, /reasoning-block|process-summary|answer--separated/);
});

test('suppressed private waiting removes the heartbeat indicator without losing received text', () => {
  const message = { role: 'assistant', content: '已接收的私聊内容', streaming: true,
    waitingInfo: { phase: 'llm-waiting' as const, elapsed: 8_000 } };
  const waiting = chair(message);
  assert.match(waiting, /conv__waiting-hint/);
  assert.match(waiting, /thinking-card__tool-spinner/);
  const suppressed = chair(message, { suppressWaiting: true });
  assert.match(suppressed, /已接收的私聊内容/);
  assert.doesNotMatch(suppressed, /conv__waiting-hint|thinking-card__tool-spinner/);
});

test('public and private height buttons follow the selected language', () => {
  const englishPublic = publicTurn(completed, 'en-US');
  const englishPrivate = chair({ role: 'assistant', content: 'Answer', reasoning: 'Reasoning text' }, { locale: 'en-US' });
  for (const html of [englishPublic, englishPrivate]) {
    assert.match(html, />Full height<\/button>/);
    assert.doesNotMatch(html, /完整高度|限高预览/);
  }
  assert.match(publicTurn(completed), />完整高度<\/button>/);
  assert.match(chair({ role: 'assistant', content: '结论', reasoning: '思路' }), />完整高度<\/button>/);
});
