import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (relative: string) => fs.readFileSync(
  path.resolve(process.cwd(), 'src/tradewind/ui', relative),
  'utf8',
);

test('tradewind shell localizes chrome without changing workflow protocol values', () => {
  const source = [
    read('pages/TradeWindPage.tsx'),
    read('workspace/useWorkspaceCommands.ts'),
    read('panels/Toolbar.tsx'),
    read('panels/WorkflowListPanel.tsx'),
  ].join('\n');
  assert.match(source, /useLocale/);
  assert.match(source, /tradewind\.toolbar\.manualRun/);
  assert.match(source, /tradewind\.workflowList\.nodeCount/);
  assert.match(source, /onRun\('manual'\)/);
  assert.match(source, /execution\.start\([^;]*mode/s);
  assert.match(source, /formatTime\(wf\.updatedAt, locale/);
});

test('tradewind config keeps shell and node-specific fields below the file limit', () => {
  const shell = read('panels/ConfigPanel.tsx');
  const fields = read('panels/ConfigFields.tsx');
  assert.match(shell, /import \{ ConfigFields \} from '\.\/ConfigFields'/);
  assert.ok(shell.split(/\r?\n/).length <= 300);
  assert.ok(fields.split(/\r?\n/).length <= 300);
  assert.match(fields, /onUpdate\(nodeId, \{ label, config:/);
});

test('tradewind config localizes guidance without changing persisted field keys', () => {
  const source = [read('panels/ConfigPanel.tsx'), read('panels/ConfigFields.tsx')].join('\n');
  assert.match(source, /tradewind\.config\.displayName/);
  assert.match(source, /tradewind\.config\.initialEnvelopeHint/);
  assert.match(source, /onChange\('agentId'/);
  assert.match(source, /onChange\('participantNodeIds'/);
  assert.match(source, /onChange\('archiveName'/);
});

test('tradewind profiles localize controls without changing profile values', () => {
  const source = read('panels/ProfilePanel.tsx');
  assert.match(source, /tradewind\.profile\.singleRun/);
  assert.match(source, /onRun\('auto', p\.id\)/);
  assert.match(source, /carryOver: e\.target\.value as 'accumulate' \| 'reset' \| 'summary'/);
  assert.match(source, /cadence: \{ kind: 'relative'/);
});

test('tradewind info panel localizes status without translating streamed payloads', () => {
  const source = read('panels/WorkflowInfoPanel.tsx');
  assert.match(source, /tradewind\.info\.nodeProgress/);
  assert.match(source, /tradewind\.info\.currentEnvelope/);
  assert.match(source, /e\.split\('当前信封：'\)/);
  assert.match(source, /BoundedText text=\{\(finalOutput\) \?\? ''\}/);
  assert.match(source, /subscribeAll\(handler\)/);
});

test('tradewind agent chat separates rendering from stream reconciliation', () => {
  const session = read('chat/AgentChatWindow.tsx');
  const view = read('chat/AgentChatView.tsx');
  assert.match(session, /import AgentChatView/);
  assert.match(session, /subscribe\(nodeId, onStreamEvent\)/);
  assert.match(view, /onPauseRound/);
  assert.match(view, /onStopWorkflow/);
  assert.match(view, /messages\.map/);
  assert.ok(view.split(/\r?\n/).length <= 300);
  assert.match(view, /tradewind\.chat\.sealedMessage/);
  assert.match(view, /tradewind\.chat\.stopWorkflow/);
});

test('tradewind chat cards localize chrome without translating tool payloads', () => {
  const source = ['DelegateCard.tsx', 'ContactCard.tsx', 'ToolCallMessage.tsx',
    'TwReasoningBlock.tsx', 'TwToolActivityGroup.tsx', 'HumanGatePanel.tsx',
    'FileDiffCard.tsx', 'StructuredMessage.tsx'].map(file => read(`chat/${file}`)).join('\n');
  assert.match(source, /tradewind\.chat\.tools\.activity/);
  assert.match(source, /tradewind\.chat\.delegate\.task/);
  assert.match(source, /tradewind\.chat\.contact\.label/);
  assert.match(source, /tradewind\.chat\.gate\.envelope/);
  assert.match(source, /tradewind\.chat\.diff\.hidden/);
  assert.match(source, /toolCall\.params/);
  assert.match(source, /toolCall\.result/);
});

test('tradewind meeting separates rendering from its dual stream state', () => {
  const panel = read('meeting/MeetingPanel.tsx');
  const view = read('meeting/MeetingPanelView.tsx');
  assert.match(panel, /import MeetingPanelView/);
  assert.match(panel, /subscribe\(nodeId, handler\)/);
  assert.match(panel, /publicStreamRef/);
  assert.match(panel, /chairStreamRef/);
  assert.match(view, /onEndMeeting/);
  assert.match(view, /onSendPublic/);
  assert.match(view, /onSendChair/);
  assert.match(view, /activeView/);
  assert.match(view, /hidden=\{activeView !== 'public'\}/);
  assert.match(view, /hidden=\{activeView !== 'chair'\}/);
  assert.ok(view.split(/\r?\n/).length <= 300);
});

test('tradewind meeting localizes chrome without translating meeting payloads', () => {
  const panel = read('meeting/MeetingPanel.tsx');
  const view = read('meeting/MeetingPanelView.tsx');
  const chair = read('meeting/MeetingChairMessageItem.tsx');
  const status = read('meeting/meeting-status.ts');
  assert.match(view, /useLocale/);
  assert.match(view, /tradewind\.meeting\.publicTitle/);
  assert.match(view, /tradewind\.meeting\.chairTitle/);
  assert.match(view, /tradewind\.meeting\.openingBanner/);
  assert.match(panel, /tradewind\.meeting\.sendPublicFailed/);
  assert.match(status, /tradewind\.meeting\.status\.ended/);
  assert.match(view, /\{participant\.label\}/);
  assert.match(chair, /renderTextWithCode\(part\.message\.content/);
  assert.match(panel, /subscribe\(nodeId, handler\)/);
  assert.doesNotMatch(panel, /subscribe\(nodeId, handler\)[\s\S]{0,160}\bt\b/);
});

test('tradewind meeting message cards localize labels without mutating payloads', () => {
  const item = read('meeting/MeetingMessageItem.tsx');
  assert.match(item, /useLocale/);
  assert.match(item, /tradewind\.meeting\.tools\.params/);
  assert.match(item, /tradewind\.meeting\.tools\.result/);
  assert.match(item, /tradewind\.meeting\.noReply/);
  assert.match(item, /tradewind\.meeting\.reasoning/);
  assert.match(item, /msg\.speaker === '人类'/);
  assert.match(item, /JSON\.stringify\(step\.args/);
  assert.match(item, /\{step\.result/);
  assert.match(item, /\{edit\.path/);
});

test('tradewind canvas localizes menus and node chrome without changing node types', () => {
  const menu = read('canvas/ContextMenu.tsx');
  const palette = read('panels/NodePalette.tsx');
  const model = read('canvas/context-menu-model.ts');
  const store = read('hooks/useWorkflowStore.ts');
  const nodes = ['AgentNode.tsx', 'MeetingNode.tsx', 'HumanGateNode.tsx',
    'EntryNode.tsx', 'OutputNode.tsx'].map(file => read(`canvas/nodes/${file}`)).join('\n');
  assert.match(menu, /tradewind\.canvas\.menu\.addNode/);
  assert.match(palette, /tradewind\.canvas\.palette\.nodes/);
  assert.match(model, /labelKey: 'tradewind\.canvas\.node\.entry'/);
  assert.match(store, /getDefaultLabel\(type, t\)/);
  assert.match(nodes, /tradewind\.canvas\.agent\.openChat/);
  assert.match(nodes, /tradewind\.canvas\.gate\.review/);
  assert.match(nodes, /tradewind\.canvas\.output\.reached/);
  assert.match(model, /type: 'human-gate'/);
  assert.match(store, /data: \{ label, config:/);
  assert.match(nodes, /\{label\}/);
  assert.match(nodes, /\{memo\}/);
});

test('tradewind validation localizes framework errors while preserving node labels', () => {
  const validation = read('workflow-validation.ts');
  const page = read('workspace/useWorkspaceCommands.ts');
  assert.match(validation, /tradewind\.validation\.autoMeeting/);
  assert.match(validation, /tradewind\.validation\.missingOutput/);
  assert.match(validation, /\{ name: node\.label \}/);
  assert.match(page, /prepareValidatedStart/);
  assert.match(read('workspace/validation-client.ts'), /'validateWorkflow', \{ graph, mode \}/);
  assert.match(validation, /node\.type === 'human-gate'/);
  assert.match(validation, /node\.type === 'entry'/);
  assert.match(validation, /node\.type === 'output'/);
});
