import type { FastifyInstance } from 'fastify';
import { registerCycloneSeatRoutes } from './cyclone-seat-routes.js';
import { registerCycloneChairRoutes } from './cyclone-chair-routes.js';
import { registerCycloneRoomRoutes } from './cyclone-room-routes.js';
import { registerCycloneWorkshopRoutes } from './cyclone-workshop-routes.js';
import type { CycloneRouteOptions } from './cyclone-route-support.js';
import { registerCycloneSupervisorRoutes } from './cyclone-supervisor-routes.js';
import { registerCycloneContactRoutes } from './cyclone-contact-routes.js';

export async function cycloneRoutes(app: FastifyInstance, options: CycloneRouteOptions): Promise<void> {
  options.feature.connectSupervisorRouter(options.router);
  app.addHook('onClose', async () => {
    await options.feature.shutdown();
    options.feature.dispose();
  });
  await registerCycloneWorkshopRoutes(app, options);
  await registerCycloneSeatRoutes(app, options);
  await registerCycloneChairRoutes(app, options);
  await registerCycloneRoomRoutes(app, options);
  registerCycloneSupervisorRoutes(app, options);
  registerCycloneContactRoutes(app, options);
}
