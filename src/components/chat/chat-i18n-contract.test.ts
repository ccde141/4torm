import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = (name: string) => fs.readFileSync(`src/components/chat/${name}.tsx`, 'utf8');

test('interactive shared chat cards resolve framework labels through locale context', () => {
  for (const name of ['AskCard', 'DelegateCard', 'MessageImages', 'QueuedChips', 'StructuredMessage']) {
    assert.match(source(name), /useLocale/);
  }
  assert.match(source('AskCard'), /chat\.ask\.composerHint/);
  assert.match(source('DelegateCard'), /chat\.delegate\.executionSteps/);
  assert.match(source('MessageImages'), /chat\.images\.open/);
  assert.match(source('MessageImages'), /chat\.images\.missing/);
  assert.match(source('MessageImages'), /onError/);
  assert.match(source('QueuedChips'), /chat\.queue\.count/);
  assert.match(source('StructuredMessage'), /chat\.tool\.params/);
});

test('execution surfaces localize controls without changing observation payloads', () => {
  for (const name of ['ExecutionSurfaceOverlay', 'TerminalObservationView', 'NativeObservationView', 'VisualObservationView']) {
    assert.match(source(name), /useLocale/);
  }
  assert.match(source('TerminalObservationView'), /chat\.execution\.waitingOutput/);
  assert.match(source('NativeObservationView'), /chat\.execution\.giveHumanControl/);
  assert.match(source('ExecutionSurfaceOverlay'), /chat\.execution\.window/);
});

test('workflow and automation result cards localize framework summaries', () => {
  for (const name of ['AutomationDraftCard', 'WorkflowExecutionCard']) {
    assert.match(source(name), /useLocale/);
  }
  assert.match(source('AutomationDraftCard'), /chat\.automation\.name/);
  assert.match(source('WorkflowExecutionCard'), /chat\.workflow\.running/);
  assert.match(source('WorkflowExecutionCard'), /inspectOperation/);
  assert.doesNotMatch(source('WorkflowExecutionCard'), /\/api\/tradewind\/status/);
});

test('ask card keeps choices and directs free-form answers to the chat composer', () => {
  const card = source('AskCard');
  const translations = fs.readFileSync('src/i18n/chat-messages.ts', 'utf8');
  assert.match(card, /options\.map/);
  assert.match(card, /onReply\(opt\)/);
  assert.doesNotMatch(card, /<input\b|<textarea\b|customInput/);
  assert.match(translations, /'chat\.ask\.composerHint': '您也可以直接在对话框输入内容回答问题'/);
  assert.match(translations, /'chat\.ask\.composerHint': 'You can also answer directly in the chat box\.'/);
});

test('task board localizes presentation and stays below the feature file limit', () => {
  const drawer = source('TaskBoardDrawer');
  assert.match(drawer, /useLocale/);
  assert.match(drawer, /chat\.taskboard\.empty/);
  assert.match(drawer, /chat\.taskboard\.clearTitle/);
  assert.ok(drawer.split(/\r?\n/).length <= 300);
});

test('monsoon page and session hooks localize controls and framework notices', () => {
  const page = source('ChatPage') + source('MonsoonConversation') + source('MonsoonSidebar');
  const sessions = fs.readFileSync('src/components/chat/useSessionList.ts', 'utf8');
  const editor = fs.readFileSync('src/components/chat/useMessageEditor.ts', 'utf8');
  assert.match(page, /useLocale/);
  assert.match(page, /chat\.page\.inputPlaceholder/);
  assert.match(page, /chat\.page\.deleteSessionTitle/);
  assert.match(sessions, /useLocale/);
  assert.match(sessions, /chat\.compact\.progress/);
  assert.match(editor, /useLocale/);
  assert.match(editor, /chat\.page\.deleteMessageTitle/);
});
