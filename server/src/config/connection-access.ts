import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { HumanIdentityPort, HumanPrincipal } from '../routes/collaboration-context.js';
import { COLLABORATION_FEATURES, COLLABORATION_PERMISSIONS } from '../engine/collaboration/contracts.js';

interface ConnectionEnvironment {
  FOURTORM_HOST?: string;
  FOURTORM_ACCESS_TOKEN?: string;
  FOURTORM_ACCESS_TOKEN_FILE?: string;
  FOURTORM_PUBLIC_ORIGIN?: string;
}

export interface ConnectionConfiguration {
  host: string;
  accessToken?: string;
}

const COOKIE = '__Host-4torm-session';
const SESSION_SECONDS = 12 * 60 * 60;

export function isLoopbackAddress(address: string): boolean {
  return address === 'localhost' || address === '::1' || address === '[::1]'
    || /^127(?:\.\d{1,3}){3}$/.test(address) || address.startsWith('::ffff:127.');
}

/** A public listener never inherits the unrestricted local desktop identity. */
export function readConnectionConfiguration(env: ConnectionEnvironment = process.env): ConnectionConfiguration {
  const host = env.FOURTORM_HOST?.trim() || 'localhost';
  if (!['localhost', '127.0.0.1', '::1', '0.0.0.0', '::'].includes(host)) {
    throw new Error('FOURTORM_HOST 仅支持 localhost、127.0.0.1、::1、0.0.0.0 或 ::，确保内部工具桥接可通过本机连接');
  }
  if (env.FOURTORM_ACCESS_TOKEN && env.FOURTORM_ACCESS_TOKEN_FILE) {
    throw new Error('FOURTORM_ACCESS_TOKEN 与 FOURTORM_ACCESS_TOKEN_FILE 只能设置一个');
  }
  let accessToken = env.FOURTORM_ACCESS_TOKEN;
  if (env.FOURTORM_ACCESS_TOKEN_FILE) {
    if (!path.isAbsolute(env.FOURTORM_ACCESS_TOKEN_FILE)) throw new Error('访问口令文件必须使用绝对路径');
    accessToken = readFileSync(env.FOURTORM_ACCESS_TOKEN_FILE, 'utf8').trim();
  }
  if (accessToken !== undefined && (accessToken.length < 32 || accessToken.length > 4096 || /[\r\n]/.test(accessToken))) {
    throw new Error('远程访问口令需要 32–4096 个字符，且不能包含换行');
  }
  if (!isLoopbackAddress(host) && (!accessToken || !env.FOURTORM_PUBLIC_ORIGIN)) {
    throw new Error('非本机监听必须配置访问口令和 FOURTORM_PUBLIC_ORIGIN');
  }
  return { host, accessToken };
}

export interface ConnectionHandshake {
  protocolVersion: 1;
  authentication: { required: boolean; authenticated: boolean };
  identity: { id: string } | null;
  capabilities: {
    providerRuntime: 'backend'; serverPlatform: NodeJS.Platform;
    desktopBrowser: boolean; localFilePaths: boolean;
  };
}

export function createConnectionAccess(options: {
  configuration: ConnectionConfiguration;
  internalToken: string;
  desktopBrowser?: boolean;
  now?: () => number;
}) {
  const { configuration, internalToken } = options;
  const now = options.now ?? Date.now;
  const secret = configuration.accessToken;
  const attempts = new Map<string, { count: number; until: number }>();
  const principal: HumanPrincipal = { id: secret ? 'remote-human' : 'local-human',
    enabledFeatures: COLLABORATION_FEATURES, permissions: COLLABORATION_PERMISSIONS };

  function authenticated(request: FastifyRequest): boolean {
    if (!secret) return isLoopbackAddress(configuration.host);
    const cookie = readCookie(request.headers.cookie, COOKIE);
    if (!cookie) return false;
    const [expires, nonce, signature, extra] = cookie.split('.');
    if (extra || !expires || !nonce || !signature || !/^\d+$/.test(expires)
      || !/^[a-f0-9]{32}$/.test(nonce) || Number(expires) <= now()) return false;
    return constantEqual(signature, sign(`${expires}.${nonce}`, secret));
  }

  const identity: HumanIdentityPort = { resolve: request => authenticated(request) ? principal : null };

  function handshake(request: FastifyRequest): ConnectionHandshake {
    const signedIn = authenticated(request);
    return { protocolVersion: 1, authentication: { required: Boolean(secret), authenticated: signedIn },
      identity: signedIn ? { id: principal.id } : null,
      capabilities: { providerRuntime: 'backend', serverPlatform: process.platform,
        desktopBrowser: Boolean(options.desktopBrowser), localFilePaths: !secret } };
  }

  async function guard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const route = request.url.split('?')[0];
    if (!route.startsWith('/api/') && route !== '/skin' && !route.startsWith('/skin/')) return;
    if (request.method === 'OPTIONS' || route === '/api/health' || route === '/api/connection'
      || route === '/api/connection/session') return;
    // This capability is process-private and grants access to the local tool bridge only.
    const supplied = request.headers['x-4torm-internal-token'];
    const internal = route === '/api/tools/exec' && isLoopbackAddress(request.ip)
      && typeof supplied === 'string' && constantEqual(supplied, internalToken);
    if (!internal && !authenticated(request)) {
      void reply.header('x-4torm-auth-required', '1').code(401)
        .send({ error: '请先连接此 4torm 后端', errorCode: 'BACKEND_AUTH_REQUIRED' });
    }
  }

  function signIn(request: FastifyRequest, reply: FastifyReply): ConnectionHandshake | undefined {
    if (!secret) return handshake(request);
    const current = attempts.get(request.ip);
    if (current && current.until > now() && current.count >= 20) {
      void reply.code(429).send({ error: '口令尝试过于频繁，请稍后重试', errorCode: 'BACKEND_AUTH_RATE_LIMIT' });
      return;
    }
    const token = (request.body as { token?: unknown } | null)?.token;
    if (typeof token !== 'string' || token.length > 4096 || !constantEqual(token, secret)) {
      if (attempts.size >= 1000) for (const [ip, attempt] of attempts) if (attempt.until <= now()) attempts.delete(ip);
      if (!current && attempts.size >= 1000) {
        void reply.code(429).send({ error: '口令尝试过于频繁，请稍后重试', errorCode: 'BACKEND_AUTH_RATE_LIMIT' });
        return;
      }
      attempts.set(request.ip, current && current.until > now()
        ? { ...current, count: current.count + 1 } : { count: 1, until: now() + 5 * 60_000 });
      void reply.code(401).send({ error: '后端访问口令不正确', errorCode: 'BACKEND_AUTH_INVALID' });
      return;
    }
    attempts.delete(request.ip);
    const payload = `${now() + SESSION_SECONDS * 1000}.${randomBytes(16).toString('hex')}`;
    reply.header('Set-Cookie', sessionCookie(`${payload}.${sign(payload, secret)}`, SESSION_SECONDS));
    return { ...handshake(request), authentication: { required: true, authenticated: true }, identity: { id: principal.id } };
  }

  function signOut(request: FastifyRequest, reply: FastifyReply): ConnectionHandshake {
    reply.header('Set-Cookie', sessionCookie('', 0));
    return { ...handshake(request), authentication: { required: Boolean(secret), authenticated: !secret },
      identity: secret ? null : { id: principal.id } };
  }

  return { guard, identity, handshake, signIn, signOut };
}

export type ConnectionAccess = ReturnType<typeof createConnectionAccess>;

function constantEqual(left: string, right: string): boolean {
  return timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest());
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function sessionCookie(value: string, maxAge: number): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  return header?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
}
