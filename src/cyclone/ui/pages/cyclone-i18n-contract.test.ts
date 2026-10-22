import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name: string) => fs.readFileSync(`src/cyclone/ui/pages/${name}`, 'utf8');

test('cyclone activity cards localize framework copy without translating payloads', () => {
  const files = [
    'ContactCard.tsx',
    'DispatchCard.tsx',
    'CycloneSystemToolCard.tsx',
    'CycloneToolActivityList.tsx',
    'SeatTurnCard.tsx',
    'SeatDispatchCard.tsx',
  ].map(read).join('\n');

  assert.match(files, /useLocale/);
  assert.match(files, /cyclone\.activity\.running/);
  assert.match(files, /cyclone\.dispatch\.status\.queued/);
  assert.match(files, /cyclone\.contact\.title/);
});

test('cyclone creation and room controls localize labels while retaining mode values', () => {
  const files = [
    'CreateRoomPanel.tsx',
    'CreateWorkshopPanel.tsx',
    'RoomComposer.tsx',
    'RoomSettingsPanel.tsx',
    'ChairDrawer.tsx',
  ].map(read).join('\n');

  assert.match(files, /cyclone\.room\.createTitle/);
  assert.match(files, /cyclone\.settings\.title/);
  assert.match(files, /cyclone\.composer\.placeholder/);
  assert.match(files, /\['build', 'plan'\]/);
  assert.match(files, /setMode\(m\)/);
});

test('cyclone seat editor localizes guidance without changing submitted fields', () => {
  const files = [read('SeatPanel.tsx'), read('SeatEditorLoading.tsx')].join('\n');
  assert.match(files, /cyclone\.seat\.createTitle/);
  assert.match(files, /cyclone\.seat\.rolePrompt/);
  assert.match(files, /onSubmit\(\{ agentId, title: title\.trim\(\), rolePrompt, duty: duty\.trim\(\), overrideAgentRole: override \}\)/);
});

test('cyclone shell localizes navigation without changing view and runner keys', () => {
  const files = [read('CyclonePage.tsx'), read('CycloneSidebar.tsx'), read('DispatchIndex.tsx')].join('\n');
  assert.match(files, /cyclone\.shell\.workshops/);
  assert.match(files, /cyclone\.shell\.deleteRoomTitle/);
  assert.match(files, /cyclone\.dispatch\.index/);
  assert.match(files, /chairStreamKey\(room\.id\)/);
  assert.match(files, /kind: 'room'/);
});

test('cyclone bulletin localizes chrome while preserving incremental operations', () => {
  const source = read('BulletinBoard.tsx');
  assert.match(source, /cyclone\.bulletin\.title/);
  assert.match(source, /cyclone\.bulletin\.changeUpdate/);
  assert.match(source, /mutateCycloneBulletin\(workshopId, ops\)/);
  assert.match(source, /author: '人类'/);
});

test('cyclone room feed localizes turn chrome while preserving speaker content', () => {
  const source = read('RoomFeedRow.tsx');
  assert.match(source, /cyclone\.roomFeed\.included/);
  assert.match(source, /cyclone\.activity\.worklog/);
  assert.match(source, /renderTextWithCode\(m\.content/);
  assert.match(source, /<code>\{tool\.tool\}<\/code>/);
});

test('cyclone room panel localizes actions without changing reset protocol', () => {
  const source = read('RoomPanel.tsx');
  assert.match(source, /cyclone\.roomPanel\.deleteTitle/);
  assert.match(source, /cyclone\.roomPanel\.resetTitle/);
  assert.match(source, /text === '\/reset all summary'/);
  assert.match(source, /resetRoomContextThroughCenter\(workshopId, roomId, mode, scope, signal\)/);
});

test('cyclone seat chat localizes controls without changing chat and resume actions', () => {
  const source = read('SeatChat.tsx');
  assert.match(source, /cyclone\.seatChat\.loadingSeat/);
  assert.match(source, /cyclone\.seatChat\.resetTitle/);
  assert.match(source, /action: 'chat' \| 'resume'/);
  assert.match(source, /text === '\/reset summary'/);
});

test('cyclone stream runners project locale without changing event protocol', () => {
  const source = [
    read('useSeatStreamRunners.ts'), read('useRoomStreamRunners.ts'),
    read('seat-stream-events.ts'), read('room-stream-events.ts'),
  ].join('\n');
  assert.match(source, /localeRef\.current/);
  assert.match(source, /formatStreamStatus\([^;]*locale/s);
  assert.match(source, /case 'contact-start'/);
  assert.match(source, /case 'seat-waiting'/);
});

test('cyclone room feed localizes framework speakers without rewriting stored speaker values', () => {
  const source = read('RoomFeedRow.tsx');
  assert.match(source, /m\.speaker === '系统'/);
  assert.match(source, /m\.speaker === '归档摘要'/);
  assert.match(source, /cyclone\.roomFeed\.system/);
  assert.match(source, /cyclone\.roomFeed\.archiveSpeaker/);
});
