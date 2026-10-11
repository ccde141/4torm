import type { CollaborationRouter } from '../engine/collaboration/router.js';
import type { ConvectionFeature } from '../modules/convection/public.js';

export interface ConvectionRouteOptions {
  router: CollaborationRouter;
  feature: ConvectionFeature;
}
