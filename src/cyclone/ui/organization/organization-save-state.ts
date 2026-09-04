import type { EditableOrganization } from './organization-types';

export type OrganizationSaveState = 'unsaved' | 'saving' | 'saved';

export function deriveOrganizationSaveState(
  draft: EditableOrganization,
  savedDraft: EditableOrganization,
  saving: boolean,
): OrganizationSaveState {
  if (saving) return 'saving';
  if (draft.activatesExplicitMode || draft !== savedDraft) return 'unsaved';
  return 'saved';
}
