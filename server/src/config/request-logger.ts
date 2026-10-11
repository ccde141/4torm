import type { FastifyInstance } from 'fastify';
import type { ModuleMethodKind } from '../engine/collaboration/contracts.js';
import { requestLogPath, shouldLogRequest } from './request-log-policy.js';

interface LogManifest {
  id: string;
  methods: readonly { id: string; kind: ModuleMethodKind }[];
}

interface RequestLogOptions {
  write?: (line: string) => void;
  detailed?: boolean;
}

interface CallLogMetadata {
  kind: ModuleMethodKind;
  label: string;
}

/** 日志只消费注册协议，不参与权限、调度或响应内容。 */
export function installRequestLogging(
  app: FastifyInstance, manifests: readonly LogManifest[], options: RequestLogOptions = {},
): void {
  const catalog = new Map<string, CallLogMetadata>();
  for (const manifest of manifests) {
    for (const method of manifest.methods) {
      const label = `${manifest.id}.${method.id}`;
      catalog.set(label, { kind: method.kind, label });
    }
  }
  const detailed = options.detailed ?? process.env.FOURTORM_HTTP_LOG === 'all';
  const write = options.write ?? ((line: string) => { process.stdout.write(line); });
  app.addHook('onResponse', (request, reply, done) => {
    const pathname = requestLogPath(request.url);
    const call = pathname === '/api/collaboration/invoke'
      ? callMetadata(request.body, catalog) : undefined;
    if (shouldLogRequest(request.method, pathname, reply.statusCode, call?.kind, detailed)) {
      const time = new Date().toTimeString().slice(0, 8);
      const elapsed = reply.elapsedTime.toFixed(0);
      write(`${time} ${request.method} ${pathname}${call ? ` ${call.label}` : ''}`
        + ` ${reply.statusCode} ${elapsed}ms\n`);
    }
    done();
  });
}

function callMetadata(
  body: unknown, catalog: ReadonlyMap<string, CallLogMetadata>,
): CallLogMetadata | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.feature !== 'string' || typeof record.method !== 'string') return undefined;
  return catalog.get(`${record.feature}.${record.method}`);
}
