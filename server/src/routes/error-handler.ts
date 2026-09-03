import type { FastifyInstance } from 'fastify';
import { frameworkHttpErrorFromUnknown } from '../engine/shared/framework-error-transport.js';

/** 安装最后一道 HTTP 错误出口；路由专有错误仍可在路由内先行映射。 */
export function installFrameworkErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const resolved = frameworkHttpErrorFromUnknown(error, `http.${request.method.toLowerCase()}`);
    app.log.error(error);
    reply.status(resolved.statusCode).send(resolved.body);
  });
}
