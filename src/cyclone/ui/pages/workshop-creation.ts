import { createCycloneWorkshop, type CycloneEntityReceipt } from './cyclone-control-client';
import { configureSupervisor } from './supervisor-client';

export interface WorkshopCreationDraft {
  title: string;
  chairAgentId?: string;
  supervisorAgentId?: string;
  supervisorRolePrompt?: string;
}

export async function prepareWorkshopCreation(
  draft: WorkshopCreationDraft,
  existing?: CycloneEntityReceipt,
): Promise<{ workshop: CycloneEntityReceipt; supervisorError?: string }> {
  const workshop = existing ?? await createCycloneWorkshop({
    title: draft.title,
    chairAgentId: draft.chairAgentId,
  });
  if (!draft.supervisorAgentId) return { workshop };
  try {
    await configureSupervisor(workshop.id, draft.supervisorAgentId, draft.supervisorRolePrompt ?? '');
    return { workshop };
  } catch (error) {
    // Creation has already committed; a configuration retry must reuse its receipt.
    return { workshop, supervisorError: error instanceof Error ? error.message : String(error) };
  }
}
