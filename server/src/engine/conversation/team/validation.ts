import type { ContextMessage } from '../../shared/types.js';
import { teamError, type MemberDefinition, type TeamOwner, type TeamPermissions, type TeamState } from './types.js';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown): value is string { return typeof value === 'string'; }
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(text);
}
export function validateOwner(owner: TeamOwner): void {
  if (![owner.agentId, owner.sessionId].every(value => text(value) && /^[a-zA-Z0-9_-]{1,160}$/.test(value))) {
    throw teamError('TEAM_INVALID_OWNER');
  }
}
function permissions(value: unknown): value is TeamPermissions {
  return record(value) && strings(value.tools) && strings(value.skills)
    && ['project', 'unrestricted'].includes(String(value.sandboxLevel));
}
function definition(value: unknown): value is MemberDefinition {
  return record(value) && ['name', 'mission', 'rolePrompt', 'taskContext', 'constraints'].every(key => text(value[key]))
    && String(value.name).trim().length > 0 && String(value.mission).trim().length > 0 && permissions(value.permissions);
}
export function validateDefinition(value: unknown): asserts value is MemberDefinition {
  if (!definition(value)) throw teamError('TEAM_INVALID_MEMBER');
}
export function enforcePermissions(member: TeamPermissions, parent: TeamPermissions): void {
  if (!permissions(member) || !permissions(parent)
    || (member.sandboxLevel === 'unrestricted' && parent.sandboxLevel !== 'unrestricted')
    || member.tools.some(name => !parent.tools.includes(name))
    || member.skills.some(name => !parent.skills.includes(name))) throw teamError('TEAM_PERMISSION_DENIED');
}
export function validateContext(value: unknown): asserts value is ContextMessage[] {
  if (!Array.isArray(value) || !value.every(message => record(message)
    && ['system', 'user', 'assistant', 'tool'].includes(String(message.role)) && text(message.content)
    && (message.toolCallId === undefined || (message.role === 'tool' && text(message.toolCallId)))
    && (message.reasoningContent === undefined || text(message.reasoningContent))
    && (message.reasoningEnvelope === undefined || (record(message.reasoningEnvelope)
      && ['reasoning_details', 'anthropic_thinking'].includes(String(message.reasoningEnvelope.field))
      && Array.isArray(message.reasoningEnvelope.value)))
    && (message.images === undefined || (message.role === 'user' && Array.isArray(message.images)
      && message.images.every(image => record(image) && ['id', 'name', 'mimeType', 'dataUrl'].every(key => text(image[key])))))
    && (message.toolCalls === undefined || (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.every(call =>
      record(call) && text(call.id) && text(call.name) && text(call.arguments)))))) {
    throw teamError('TEAM_INVALID_CONTEXT');
  }
}
export function parseState(raw: string, owner: TeamOwner): TeamState {
  let state: unknown;
  try { state = JSON.parse(raw); } catch { throw teamError('TEAM_CORRUPT'); }
  if (!record(state) || state.version !== 1 || state.agentId !== owner.agentId || state.sessionId !== owner.sessionId
    || !Number.isSafeInteger(state.revision) || Number(state.revision) < 0
    || !Array.isArray(state.members) || !Array.isArray(state.reports)) throw teamError('TEAM_CORRUPT');
  const ids = new Set<string>();
  for (const member of state.members) {
    if (!record(member) || !definition(member) || !text(member.id) || ids.has(member.id)
      || !['active', 'dismissed'].includes(String(member.lifecycle))) throw teamError('TEAM_CORRUPT');
    ids.add(member.id);
    validateContext(member.context);
    if (record(member.run) && member.run.requestId !== undefined
      && (!text(member.run.requestId) || !/^[a-zA-Z0-9_-]{1,160}$/.test(member.run.requestId))) throw teamError('TEAM_CORRUPT');
    if (member.run !== undefined && (!record(member.run)
      || !['id', 'runtimeId', 'task'].every(key => text(member.run && (member.run as Record<string, unknown>)[key]))
      || !['running', 'completed', 'failed', 'aborted', 'crashed'].includes(String(member.run.status)))) throw teamError('TEAM_CORRUPT');
  }
  const reportIds = new Set<string>();
  for (const report of state.reports) {
    if (!record(report) || !['id', 'memberId', 'runId', 'task', 'content'].every(key => text(report[key]))
      || !ids.has(String(report.memberId)) || reportIds.has(String(report.id)) || typeof report.acknowledged !== 'boolean'
      || !['completed', 'failed', 'aborted', 'crashed'].includes(String(report.outcome))) throw teamError('TEAM_CORRUPT');
    reportIds.add(String(report.id));
    if (report.requestId !== undefined && (!text(report.requestId)
      || !/^[a-zA-Z0-9_-]{1,160}$/.test(report.requestId))) throw teamError('TEAM_CORRUPT');
    if (report.review !== undefined && (!record(report.review)
      || !['accepted', 'continue', 'blocked'].includes(String(report.review.decision))
      || !text(report.review.reason) || !report.review.reason.trim())) throw teamError('TEAM_CORRUPT');
  }
  return state as unknown as TeamState;
}
