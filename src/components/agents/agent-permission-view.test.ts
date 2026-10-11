import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '../../i18n/LocaleContext.js';
import AgentPermissionField from './AgentPermissionField.js';

Object.assign(globalThis, { React });

function render(value: 'project' | 'unrestricted') {
  return renderToStaticMarkup(React.createElement(LocaleProvider, null,
    React.createElement(AgentPermissionField, { value, onChange: () => {} })));
}

test('执行权限在两种取值下都有可见且可读的选中态', () => {
  const project = render('project');
  const unrestricted = render('unrestricted');
  assert.match(project, /aria-pressed="true"[^>]*>[^<]*<span[^>]*>✓<\/span>项目级/);
  assert.match(project, /aria-pressed="false"[^>]*>[^<]*<span[^>]*><\/span>无限制/);
  assert.match(unrestricted, /aria-pressed="false"[^>]*>[^<]*<span[^>]*><\/span>项目级/);
  assert.match(unrestricted, /aria-pressed="true"[^>]*>[^<]*<span[^>]*>✓<\/span>无限制/);
});

test('详情弹窗的按钮通用样式不能覆盖权限选中态', () => {
  const css = readFileSync('src/styles/components/agent-permission.css', 'utf8');
  assert.match(css, /\.agent-detail__content \.agent-permission__option--selected/);
});
