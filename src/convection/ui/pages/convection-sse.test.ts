import assert from 'node:assert/strict';
import test from 'node:test';
import { ConvectionHttpError, streamConvectionSSE } from './convection-sse.js';

function response(frames: string[], status = 200): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  }), { status });
}

test('收到 done 后正常结束并保留事件顺序', async () => {
  const events: string[] = [];
  await streamConvectionSSE('/test', {}, event => events.push(event.type), undefined, async () => response([
    'data: {"type":"token","chunk":"a"}\n\n',
    'data: {"type":"done"}\n\n',
  ]));

  assert.deepEqual(events, ['token']);
});

test('连接在 done 前关闭时报告意外中断', async () => {
  await assert.rejects(
    streamConvectionSSE('/test', {}, () => {}, undefined, async () => response([
      'data: {"type":"token","chunk":"a"}\n\n',
    ])),
    /连接意外中断/,
  );
});

test('服务端 error 事件转换为真实异常', async () => {
  await assert.rejects(
    streamConvectionSSE('/test', {}, () => {}, undefined, async () => response([
      'data: {"type":"error","message":"模型失败"}\n\n',
    ])),
    /模型失败/,
  );
});

test('HTTP 冲突保留状态码供界面撤销乐观消息', async () => {
  await assert.rejects(
    streamConvectionSSE('/test', {}, () => {}, undefined, async () => new Response(
      JSON.stringify({ error: '该会话正在处理中，请稍后再试' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    )),
    (error: unknown) => error instanceof ConvectionHttpError && error.status === 409,
  );
});
