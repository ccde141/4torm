import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '../../i18n/LocaleContext';
import AskCard from './AskCard';

function render(status: 'submitting' | 'failed' | 'expired', detail?: string): string {
  return renderToStaticMarkup(createElement(LocaleProvider, null,
    createElement(AskCard, {
      question: '继续吗？', options: ['继续'], answered: false,
      onReply: () => undefined, status, statusDetail: detail,
    })));
}

test('ask card reports submission without allowing duplicate choice clicks', () => {
  const html = render('submitting');
  assert.match(html, /正在发送/);
  assert.match(html, /disabled=""/);
});

test('ask card keeps choices available after a rejected reply', () => {
  const html = render('failed', '会话暂不可用');
  assert.match(html, /会话暂不可用/);
  assert.doesNotMatch(html, /disabled=""/);
});

test('expired questions are clearly disabled', () => {
  const html = render('expired');
  assert.match(html, /已失效/);
  assert.match(html, /disabled=""/);
});

test('a persisted answer wins over uncertain local delivery status', () => {
  const html = renderToStaticMarkup(createElement(LocaleProvider, null,
    createElement(AskCard, {
      question: '继续吗？', options: ['继续'], answered: true, reply: '继续',
      onReply: () => undefined, status: 'unknown',
    })));
  assert.match(html, /✓ 继续/);
  assert.doesNotMatch(html, /结果未确认/);
});
