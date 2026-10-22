import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { TradewindWorkflowAdmin } from '../application/workflow-admin.js';
import { parseWorkflowProfile } from '../domain/workflow-profile.js';
import { agentOutputPage, parseTextPageInput, type TextPageInput } from './agent-output-page.js';

const workflowId = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$' };
const expectedRevision = { type: 'string', pattern: '^[a-f0-9]{64}$' };

export function tradewindProfileManifests(): ModuleMethodManifest[] {
  return [method('readWorkflowProfileCatalog', 'list_workflow_profiles', 'observe',
    '分页读取指定工作流的循环档案正文和 revision。正文在 text 中，续读携带 revision 与 nextOffset；版本变化时从 0 重新读取，修改时携带完整读取的 revision。',
    ['workflowId'], { workflowId, offset: { type: 'integer', minimum: 0 },
      revision: expectedRevision,
      maxChars: { type: 'integer', minimum: 1, maximum: 16_384 } }),
  method('saveWorkflowProfile', 'save_workflow_profile', 'design',
    '创建或更新一份循环档案，保留其他档案。先读取 list_workflow_profiles 并携带 revision；只保存，不启动。循环仅支持 relative 间隔，lapBound 为 null 表示持续运行，需有明确授权。',
    ['workflowId', 'profile', 'expectedRevision'], { workflowId, expectedRevision, profile: {
      type: 'object', additionalProperties: false,
      required: ['id', 'name', 'cadence', 'overlap', 'lapBound', 'carryOver'], properties: {
        id: workflowId, name: { type: 'string', minLength: 1, maxLength: 200 },
        cadence: { type: 'object', additionalProperties: false, required: ['kind', 'gapSec'],
          properties: { kind: { const: 'relative' }, gapSec: { type: 'number', minimum: 0 } } },
        overlap: { enum: ['skip', 'queue'] }, lapBound: { type: ['integer', 'null'], minimum: 1 },
        carryOver: { enum: ['accumulate', 'reset', 'summary'] },
        loopNote: { type: 'string', minLength: 1, maxLength: 4_000 },
        summaryPrompt: { type: 'string', minLength: 1, maxLength: 4_000 },
      } },
    })];
}

export function tradewindProfileHandlers(admin: TradewindWorkflowAdmin): Record<string, ModuleMethodHandler> {
  return {
    readWorkflowProfileCatalog: { parse: value => {
      const item = exact(value, ['workflowId', 'offset', 'maxChars', 'revision']);
      return { workflowId: id(item.workflowId), ...parseTextPageInput(item) };
    }, invoke: async (context, input) => {
      const value = input as { workflowId: string } & TextPageInput;
      const catalog = await admin.readProfileCatalog(value.workflowId);
      return { workflowId: catalog.workflowId,
        ...agentOutputPage(catalog.profiles, value, context.budget, catalog.revision) };
    } },
    saveWorkflowProfile: { parse: value => {
      const item = exact(value, ['workflowId', 'profile', 'expectedRevision']);
      if (typeof item.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(item.expectedRevision)) throw invalid();
      try {
        const profile = parseWorkflowProfile(item.profile);
        if (profile.cadence.kind !== 'relative') throw invalid();
        return { workflowId: id(item.workflowId), profile, expectedRevision: item.expectedRevision };
      } catch { throw invalid(); }
    }, invoke: (_context, input) => {
      const value = input as { workflowId: string; profile: ReturnType<typeof parseWorkflowProfile>; expectedRevision: string };
      return admin.saveProfile(value.workflowId, value.profile, value.expectedRevision);
    } },
  };
}

function method(id: string, name: string, permission: 'observe' | 'design', description: string,
  required: string[], properties: Record<string, unknown>): ModuleMethodManifest {
  return { id, kind: permission === 'observe' ? 'query' : 'command', permission,
    audiences: ['agent', 'internal'], agentTool: { name, description },
    inputSchema: { type: 'object', additionalProperties: false, required, properties },
    output: { mode: 'inline', budget: { textChars: { default: 8_000, max: 16_000 },
      textLines: { default: 160, max: 320 } } } };
}
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) throw invalid();
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(value)) throw invalid();
  return value;
}
function invalid() { return frameworkError({ code: 'TRADEWIND_PROFILE_INPUT_INVALID', kind: 'validation',
  message: '循环档案参数无效，请读取当前档案版本后保存 relative 间隔配置',
  source: 'tradewind.profile', retryable: false }); }
