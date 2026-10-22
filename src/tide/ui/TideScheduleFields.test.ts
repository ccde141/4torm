import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '../../i18n/LocaleContext';
import { parseTideScheduleForm } from './tide-form-values';
import TideScheduleFields from './TideScheduleFields';

const render = (schedule: string) => renderToStaticMarkup(createElement(LocaleProvider, null,
  createElement(TideScheduleFields, { value: parseTideScheduleForm(schedule), onChange: () => {} })));

test('定时表单提供可访问的模式选择和分段时间，避免打开原生时间弹窗', () => {
  const html = render('daily 08:00');
  assert.match(html, /<legend[^>]*>触发方式<\/legend>/);
  assert.match(html, /type="radio"[^>]*checked=""[^>]*value="daily"/);
  assert.equal((html.match(/role="spinbutton"/g) ?? []).length, 2);
  assert.match(html, /aria-label="时" aria-valuemin="0" aria-valuemax="23" aria-valuenow="8"/);
  assert.match(html, /aria-label="分" aria-valuemin="0" aria-valuemax="59" aria-valuenow="0"/);
  assert.match(html, /value="08"/);
  assert.match(html, /value="00"/);
  assert.match(html, /运行后端的电脑当前时区/);
  assert.match(html, /错过的时间不补跑/);
  assert.doesNotMatch(html, /type="time"|<select/);
});

test('间隔表单继续提供时分秒编辑，而不显示无关的定时时间字段', () => {
  const html = render('every 5m');
  assert.match(html, /type="radio"[^>]*checked=""[^>]*value="interval"/);
  assert.equal((html.match(/type="number"/g) ?? []).length, 3);
  assert.match(html, /aria-label="秒"/);
  assert.doesNotMatch(html, /type="time"/);
});
