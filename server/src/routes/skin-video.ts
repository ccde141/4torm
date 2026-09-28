import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Transform, type TransformCallback, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { getAppContext } from '../services/app-context.js';

const VIDEO_ID = /^background-[a-f0-9-]+\.(mp4|webm)$/;
const INVALID_VIDEO = 'INVALID_BACKGROUND_VIDEO';

function validVideo(data: Buffer, type: string): boolean {
  if (type === 'video/mp4') return data.length >= 12 && data.toString('ascii', 4, 8) === 'ftyp';
  return data.length >= 4 && data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
}

function videoHeaderValidator(type: string): Transform {
  const required = type === 'video/mp4' ? 12 : 4;
  let header = Buffer.alloc(0);
  let checked = false;
  return new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback) {
      if (checked) { done(null, chunk); return; }
      header = Buffer.concat([header, chunk.subarray(0, Math.max(0, required - header.length))]);
      if (header.length < required) { done(null, chunk); return; }
      if (!validVideo(header, type)) { done(Object.assign(new Error('仅支持有效的 MP4 或 WebM 视频'), { code: INVALID_VIDEO })); return; }
      checked = true;
      done(null, chunk);
    },
    flush(done) {
      done(checked ? undefined : Object.assign(new Error('仅支持有效的 MP4 或 WebM 视频'), { code: INVALID_VIDEO }));
    },
  });
}

function videoPath(dataDir: string, id: string): string | null {
  return VIDEO_ID.test(id) ? path.join(dataDir, 'skin-videos', id) : null;
}

function requestedRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!match[1]) start = Math.max(0, size - end);
  if (match[1] && !match[2]) end = size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

export async function skinVideoRoutes(app: FastifyInstance): Promise<void> {
  const { dataDir } = getAppContext(app);
  app.addContentTypeParser(/^video\/(mp4|webm)$/, (_request, stream, done) => done(null, stream));

  app.put('/', async (request, reply) => {
    const type = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if ((type !== 'video/mp4' && type !== 'video/webm') || !request.body) {
      return reply.status(415).send({ error: '仅支持有效的 MP4 或 WebM 视频' });
    }
    const id = `background-${randomUUID()}.${type === 'video/mp4' ? 'mp4' : 'webm'}`;
    const target = videoPath(dataDir, id)!;
    const temporary = `${target}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await pipeline(request.body as Readable, videoHeaderValidator(type), createWriteStream(temporary, { flags: 'wx' }));
      await fs.rename(temporary, target);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      if ((error as NodeJS.ErrnoException).code === INVALID_VIDEO) {
        return reply.status(415).send({ error: '仅支持有效的 MP4 或 WebM 视频' });
      }
      throw error;
    }
    return { id };
  });

  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const target = videoPath(dataDir, request.params.id);
    if (!target) return reply.status(400).send({ error: '视频标识无效' });
    let size: number;
    try { size = (await fs.stat(target)).size; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reply.status(404).send({ error: '视频不存在' });
      throw error;
    }
    const rangeHeader = request.headers.range;
    const range = requestedRange(rangeHeader, size);
    if (rangeHeader && !range) return reply.status(416).header('Content-Range', `bytes */${size}`).send();
    reply.header('Content-Type', target.endsWith('.mp4') ? 'video/mp4' : 'video/webm');
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    if (range) {
      reply.status(206).header('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      reply.header('Content-Length', range.end - range.start + 1);
      return reply.send(createReadStream(target, range));
    }
    reply.header('Content-Length', size);
    return reply.send(createReadStream(target));
  });

  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const target = videoPath(dataDir, request.params.id);
    if (!target) return reply.status(400).send({ error: '视频标识无效' });
    await fs.rm(target, { force: true });
    return { ok: true };
  });
}
