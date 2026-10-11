import { tryAcquireSessionLease } from '../../../engine/conversation/session-lease.js';
import type { SessionLeaseFactory } from './session-registry.js';

/** Keeps the legacy process-wide lease implementation behind the Monsoon runtime port. */
export const acquireMonsoonSessionLease: SessionLeaseFactory = tryAcquireSessionLease;
