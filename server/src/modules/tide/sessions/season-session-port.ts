import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { MonsoonExternalSessionPort } from '../../monsoon/public.js';

export type SeasonSessionPort = MonsoonExternalSessionPort;

export function requireSeasonSessionPort(port?: SeasonSessionPort): SeasonSessionPort {
  if (port) return port;
  throw frameworkError({ code: 'TIDE_SEASON_PORT_UNAVAILABLE', kind: 'internal',
    message: '季风会话接口尚未接入', source: 'tide.sessions', retryable: false });
}
