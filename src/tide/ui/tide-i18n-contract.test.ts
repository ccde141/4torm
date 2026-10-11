import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { formatSchedule } from './tide-styles';

test('tide task cards localize chrome without changing task payloads', () => {
  const source = fs.readFileSync('src/tide/ui/TideTaskItem.tsx', 'utf8');
  assert.match(source, /useLocale/);
  assert.match(source, /tide\.task\.status\.scheduled/);
  assert.match(source, /resolveTideRuntime/);
  assert.match(source, /tide\.task\.runNow/);
  assert.match(source, /\{task\.name\}/);
  assert.match(source, /\{r\.error\.slice/);
  assert.match(source, /formatSchedule\(task\.schedule, locale\)/);
});

test('tide schedule display follows locale without changing its storage syntax', () => {
  assert.equal(formatSchedule('every 1h30m', 'zh-CN'), '1 小时 30 分钟');
  assert.equal(formatSchedule('every 1h30m', 'en-US'), '1 hr 30 min');
  assert.equal(formatSchedule('cron 0 9 * * *', 'en-US'), 'cron 0 9 * * *');
});

test('tide create form localizes guidance without changing scheduler values', () => {
  const source = fs.readFileSync('src/tide/ui/TideCreateForm.tsx', 'utf8');
  assert.match(source, /useLocale/);
  assert.match(source, /tide\.create\.selfLoop/);
  assert.match(source, /tide\.create\.validation\.interval/);
  assert.match(source, /value="accumulate"/);
  assert.match(source, /value="designated"/);
  assert.match(source, /const schedule = `every \$\{scheduleH\}h\$\{scheduleM\}m\$\{scheduleS\}s`/);
  assert.match(source, /prompt\.trim\(\)/);
  assert.match(source, /targetSessionId/);
});

test('tide session rendering is separated from page polling', () => {
  const page = fs.readFileSync('src/tide/ui/TidePage.tsx', 'utf8');
  const main = fs.readFileSync('src/tide/ui/TidePageMain.tsx', 'utf8');
  const entities = fs.readFileSync('src/tide/ui/use-tide-entities.ts', 'utf8');
  const view = fs.readFileSync('src/tide/ui/TideSessionView.tsx', 'utf8');
  assert.match(main, /import TideSessionView/);
  assert.match(page, /setInterval/);
  assert.match(entities, /createLatestRequestGuard/);
  assert.match(view, /visibleTideMessages\(session\)/);
  assert.match(view, /renderTextWithCode|StructuredMessage/);
  assert.match(view, /JSON\.stringify\(parsed\.args/);
  assert.match(view, /parsed\.result\.slice/);
  assert.ok(view.split(/\r?\n/).length <= 300);
});

test('tide session view localizes chrome without translating conversation content', () => {
  const view = fs.readFileSync('src/tide/ui/TideSessionView.tsx', 'utf8');
  assert.match(view, /useLocale/);
  assert.match(view, /tide\.session\.close/);
  assert.match(view, /tide\.session\.messageCount/);
  assert.match(view, /\{session\.title\}/);
  assert.match(view, /answer=\{message\.content\}/);
  assert.match(view, /JSON\.parse\(content\)/);
  assert.match(view, /JSON\.stringify\(parsed\.args/);
  assert.match(view, /parsed\.result\.slice/);
});

test('tide task detail is separated without moving page polling or request guards', () => {
  const page = fs.readFileSync('src/tide/ui/TidePage.tsx', 'utf8');
  const main = fs.readFileSync('src/tide/ui/TidePageMain.tsx', 'utf8');
  const entities = fs.readFileSync('src/tide/ui/use-tide-entities.ts', 'utf8');
  const detail = fs.readFileSync('src/tide/ui/TideTaskDetail.tsx', 'utf8');
  assert.match(main, /import TideTaskDetail/);
  assert.match(page, /setInterval/);
  assert.match(entities, /createLatestRequestGuard/);
  assert.match(page, /handleDeleteSession/);
  assert.match(detail, /updateTask/);
  assert.match(detail, /\[task\.id\]/);
  assert.match(detail, /task\.pushMode === 'accumulate'/);
  assert.match(detail, /onDeleteSession/);
  assert.ok(detail.split(/\r?\n/).length <= 300);
});

test('tide task detail localizes chrome while preserving task and run payloads', () => {
  const detail = fs.readFileSync('src/tide/ui/TideTaskDetail.tsx', 'utf8');
  assert.match(detail, /useLocale/);
  assert.match(detail, /tide\.detail\.schedule/);
  assert.match(detail, /tide\.detail\.runHistory/);
  assert.match(detail, /task\.name/);
  assert.match(detail, /task\.prompt/);
  assert.match(detail, /run\.error/);
  assert.match(detail, /run\.answer\.slice/);
  assert.match(detail, /task\.pushMode === 'accumulate'/);
  assert.match(detail, /`every \$\{form\.scheduleH\}h\$\{form\.scheduleM\}m\$\{form\.scheduleS\}s`/);
});

test('tide page localizes shell without translating entity names or changing polling', () => {
  const page = fs.readFileSync('src/tide/ui/TidePage.tsx', 'utf8');
  const sidebar = fs.readFileSync('src/tide/ui/TidePageSidebar.tsx', 'utf8');
  const entities = fs.readFileSync('src/tide/ui/use-tide-entities.ts', 'utf8');
  assert.match(sidebar, /useLocale/);
  assert.match(sidebar, /tide\.page\.agentFilter/);
  assert.match(sidebar, /tide\.page\.sessions/);
  assert.match(sidebar, /formatRelative\(session\.updatedAt, locale\)/);
  assert.match(sidebar, /\{agent\.name\}/);
  assert.match(sidebar, /\{session\.title\}/);
  assert.match(page, /setInterval/);
  assert.match(entities, /useTideOverview\(identity\.agentId \?\? undefined, active\)/);
  assert.match(entities, /refreshAgents\(\)/);
  assert.match(entities, /refreshSessions\(\)/);
});

test('tide overview consumes router probes with stale-request protection', () => {
  const source = fs.readFileSync('src/tide/ui/use-tide-overview.ts', 'utf8');
  assert.match(source, /observeAllFeature\('tide'/);
  assert.match(source, /Promise\.all/);
  assert.match(source, /createLatestRequestGuard/);
  assert.match(source, /if \(!request\.isCurrent\(\)\) return/);
  assert.match(source, /if \(!active\)/);
});
