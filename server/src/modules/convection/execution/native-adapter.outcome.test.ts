import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContextMessage } from '../../../engine/shared/types.js';
import { runConvectionReActNativeWith } from './native-adapter.js';

test('convection native loop sends failed tool status to the model and stream once', async () => {
  const events: Array<{ type: string; ok?: boolean }> = [];
  let secondMessages: ContextMessage[] = [];
  let calls = 0;
  await runConvectionReActNativeWith({
    dataDir: 'data', model: 'demo:model', temperature: 0, agentId: 'a',
    sessionId: 's', label: 'Agent A', messages: [{ role: 'user', content: 'Discuss.' }],
    toolDefs: [{ name: 'mcp:demo:search', description: 'search', parameters: { type: 'object' } }],
    onEvent: event => events.push(event),
  }, {
    callModel: async messages => {
      if (++calls === 1) return {
        content: '', finishReason: 'tool_calls',
        toolCalls: [{ id: 'call-1', name: 'mcp:demo:search', arguments: '{}' }],
      };
      secondMessages = [...messages];
      return { content: 'Done.', finishReason: 'stop' };
    },
    callAgentTool: async () => ({ result: 'disabled tool', ok: false }),
  });

  assert.deepEqual(events.filter(event => event.type === 'tool-call').map(event => event.type), ['tool-call']);
  assert.deepEqual(events.filter(event => event.type === 'tool-result').map(event => event.ok), [false]);
  const toolMessage = secondMessages.find(message => message.role === 'tool');
  assert.equal(toolMessage?.content, 'disabled tool');
  assert.equal(toolMessage?.toolOk, false);
});

test('convection native stream forwards a rejected tool without executing it', async () => {
  const events: Array<{ type: string; ok?: boolean }> = [];
  let executions = 0;
  let calls = 0;
  await runConvectionReActNativeWith({
    dataDir: 'data', model: 'demo:model', temperature: 0, agentId: 'a',
    sessionId: 's', label: 'Agent A', messages: [{ role: 'user', content: 'Discuss.' }],
    toolDefs: [{ name: 'read_file', description: 'read', parameters: { type: 'object' } }],
    onEvent: event => events.push(event),
  }, {
    callModel: async () => (++calls === 1
      ? { content: '', finishReason: 'tool_calls',
        toolCalls: [{ id: 'call-1', name: 'mcp:demo:search', arguments: '{}' }] }
      : { content: 'Done.', finishReason: 'stop' }),
    callAgentTool: async () => { executions++; return 'unexpected'; },
  });

  assert.equal(executions, 0);
  assert.deepEqual(events.filter(event => event.type === 'tool-call').map(event => event.type), ['tool-call']);
  assert.deepEqual(events.filter(event => event.type === 'tool-result').map(event => event.ok), [false]);
});

test('convection native tool images keep their references through events and the next model call', async () => {
  const toolImages = [{ id: 'f4f82d73-4c42-4b3f-95b5-a8646ab58d9f', name: 'screen.png', mimeType: 'image/png', size: 8 }];
  const events: Array<{ type: string; toolImages?: unknown }> = [];
  let calls = 0;
  await runConvectionReActNativeWith({
    dataDir: 'unused', model: 'test:model', temperature: 0, agentId: 'a', sessionId: 's',
    label: 'A', messages: [{ role: 'user', content: 'Inspect.' }],
    toolDefs: [{ name: 'mcp:demo:observe', description: 'observe', parameters: { type: 'object' } }],
    onEvent: event => events.push(event),
  }, {
    callModel: async messages => {
      if (++calls === 1) return { content: '', finishReason: 'tool_calls',
        toolCalls: [{ id: 'call-a', name: 'mcp:demo:observe', arguments: '{}' }] };
      assert.deepEqual(messages.find(message => message.role === 'tool')?.toolImages, toolImages);
      return { content: 'Done.', finishReason: 'stop' };
    },
    callAgentTool: async () => ({ result: '{"observation_id":"obs-a"}', ok: true, toolImages }),
  });
  assert.deepEqual(events.filter(event => event.type === 'tool-result').map(event => event.toolImages), [toolImages]);
  assert.doesNotMatch(JSON.stringify(events), /base64|data:image/);
});
