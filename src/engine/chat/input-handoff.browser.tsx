// Isolated browser fixture: every API request is handled in memory, with no real backend/model.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useHumanInput } from '../../components/chat/useHumanInput';
import { useStreamRunners } from '../../components/chat/useStreamRunners';
import PendingHumanInput from '../../components/chat/PendingHumanInput';
import type { Agent, ChatMessage } from '../../types';
import type { InputSubmission } from './input-submission';

const sid = 'agent-test-session';
const agent = { id: 'agent-test', name: 'Test' } as Agent;
const mode = new URLSearchParams(location.search).get('mode') ?? 'closed';
const answer: ChatMessage = { id: 'old', role: 'assistant', content: 'final old answer',
  timestamp: 'now', inputRunId: 'old', inputReady: true };
const files = new Map<string, unknown>([
  [`agents/agent-test/sessions/${sid}.json`, { id: sid, agentId: agent.id, agentName: 'Test',
    title: 'Test', titleState: 'attempted', messages: [answer], model: '', createdAt: 'now', updatedAt: 'now' }],
  ['agents/agent-test/sessions/_index.json', []],
]);
const submitted: InputSubmission[] = [];
let chats = 0;
let finished = false;
let journalReads = 0;
const receipts = () => submitted.map((input, index) => ({ id: input.id, content: input.content,
  runId: input.runId, sequence: index + 1, receivedAt: new Date().toISOString() }));
const journal = () => ({ active: !finished, entries: mode === 'closed' ? [] : receipts(),
  checkpoint: finished ? { closed: true, includedIds: mode === 'included' ? submitted.map(input => input.id) : [], context: [] } : undefined });

window.fetch = async (target, init) => {
  const url = new URL(String(target), location.href);
  if (url.pathname === '/api/conversation/input') {
    if (init?.method !== 'POST') {
      if (mode === 'reordered' && ++journalReads === 1) await new Promise(resolve => setTimeout(resolve, 100));
      return Response.json(journal());
    }
    const input = JSON.parse(String(init.body)) as InputSubmission;
    submitted.push(input);
    if (mode === 'uncertain') throw new TypeError('simulated lost response');
    return Response.json(mode === 'closed' ? { disposition: 'next-turn' } : { receipt: receipts().at(-1) });
  }
  if (url.pathname === '/api/conversation/chat') {
    chats++;
    const body = JSON.parse(String(init?.body));
    const events = [{ type: 'input-ready', runId: body.inputRunId },
      { type: 'answer', content: `new answer ${chats}` },
      { type: 'input-closed', runId: body.inputRunId, retained: [] }, { type: 'done' }];
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
      { headers: { 'Content-Type': 'text/event-stream' } });
  }
  if (url.pathname === '/api/storage/read') {
    const value = files.get(url.searchParams.get('path')!);
    return value === undefined ? new Response('', { status: 404 }) : Response.json(value);
  }
  if (url.pathname === '/api/storage/write') {
    files.set(url.searchParams.get('path')!, JSON.parse(String(init?.body)));
    return Response.json({ ok: true });
  }
  if (url.pathname === '/api/storage/mkdir') return Response.json({ ok: true });
  throw new Error(`Unexpected fixture request: ${url.pathname}`);
};

function Fixture() {
  const [messages, setMessages] = useState<ChatMessage[]>([answer]);
  const [streaming, setStreaming] = useState(true);
  const [text, setText] = useState('first correction');
  const [selected, setSelected] = useState(sid);
  const active = useRef(selected);
  const runners = useStreamRunners(() => active.current, setMessages, setStreaming);
  useEffect(() => { active.current = selected; }, [selected]);
  useEffect(() => {
    runners.register(sid, () => {}, [answer]);
    runners.emit(sid, [answer]);
  }, []);
  const input = useHumanInput({ agent, sessionId: selected, model: '', runners,
    getMessages: () => messages, refresh: () => {}, onTaskboard: () => {},
    clearText: value => setText(previous => previous === value ? '' : previous) });
  function finish(completed: boolean) {
    finished = true;
    const value = files.get(`agents/agent-test/sessions/${sid}.json`) as { messages: ChatMessage[] };
    value.messages = [{ ...answer, inputReady: false, inputClosed: true }];
    runners.emit(sid, value.messages);
    runners.finalize(sid, completed);
  }
  return <main>
    <textarea aria-label="Message" value={text} onChange={event => setText(event.target.value)} />
    <button disabled={input.busy} onClick={() => { void input.send(text); }}>Send</button>
    <button onClick={() => finish(true)}>Finish</button>
    <button onClick={() => finish(false)}>Stop</button>
    <button onClick={() => setSelected(selected === sid ? 'agent-test-other' : sid)}>Switch</button>
    <output>{selected} | streaming={String(streaming)} | chats={chats} | posts={submitted.length}</output>
    {messages.map(message => <p key={message.id}>{message.content}</p>)}
    {input.pending.map(entry => <PendingHumanInput key={entry.input.id} pending={entry}
      busy={input.isWorking(entry.input.id)} english={false} onCheck={() => { void input.check(entry); }} />)}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
