import type { ToolDef } from '../shared/tool-defs-loader.js';
import {
  buildBackgroundExecutionToolDefs,
  withBackgroundExecutionGuidance,
} from '../shared/background-execution-tools.js';
import type { ContactTarget } from './contact-registry.js';
import { buildContactVirtualToolDefs, buildSeatVirtualToolDefs } from './virtual-tools.js';
import { filterSeatCollaborationTools, type SeatCollaborationPolicy } from './seat-collaboration.js';
import { withSeatFactTools } from './seat-fact-tools.js';

/** 工位私聊的唯一工具清单，同时供文本协议与执行循环使用。 */
export function buildSeatToolCatalog(
  realTools: ToolDef[],
  contactTargets: ContactTarget[],
  dispatchTargets: ContactTarget[],
  policy?: SeatCollaborationPolicy,
): ToolDef[] {
  return filterSeatCollaborationTools([
    ...withSeatFactTools([
      ...withBackgroundExecutionGuidance(realTools),
      ...buildSeatVirtualToolDefs({
        allowAsk: true,
        allowDelegate: true,
        allowDispatch: dispatchTargets.length > 0,
        allowToolRegistration: true,
        contactTargets,
        dispatchTargets,
      }),
    ]),
    ...buildBackgroundExecutionToolDefs(),
  ], policy);
}

/** 同步联络没有人类提问和任务板，仍须把虚拟工具告知文本模式。 */
export function buildContactToolCatalog(
  realTools: ToolDef[],
  contactTargets: ContactTarget[],
  policy?: SeatCollaborationPolicy,
): ToolDef[] {
  return filterSeatCollaborationTools(withSeatFactTools([...realTools, ...buildContactVirtualToolDefs(contactTargets)]), policy);
}
