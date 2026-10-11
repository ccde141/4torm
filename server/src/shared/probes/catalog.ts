import { PROBE_STATUSES, type ProbeAudience, type ProbeField, type ProbeFieldDefinition } from './contracts.js';

type Definition = Omit<ProbeFieldDefinition, 'key'>;
const visible: ProbeAudience[] = ['human', 'agent', 'internal'];
const text = (description: string, maxLength = 12000): Definition => ({
  description, type: 'string', required: false, since: 1, audiences: visible, maxLength,
});
const id = (description: string): Definition => ({ ...text(description, 160), format: 'identifier' });
const count = (description: string): Definition => ({
  description, type: 'number', required: false, since: 1, audiences: visible, minimum: 0,
});

/** The single vocabulary; feature islands supply values, never their own probe schemas. */
const definitions: Record<ProbeField, Definition> = {
  operationId: { ...id('功能区内的实体标识；必须与信封 feature 一起作为键'), required: true },
  status: { ...text('公共生命周期状态；未知状态不得当作空闲', 32),
    required: true, format: 'status', values: PROBE_STATUSES },
  title: { ...text('可公开的简短名称'), required: true },
  phase: text('功能区当前细分阶段；不能替代公共生命周期状态', 160),
  updatedAt: { ...text('源状态更新时间，带时区的 ISO 8601', 32), format: 'timestamp' },
  agentId: id('负责此工作的 Agent 标识'),
  runId: id('本次运行标识；用于区分同一实体的多次执行'),
  parentOperationId: id('同功能区内的父实体标识'),
  completedUnits: count('已完成单位数量；缺失表示未提供，0 是真实零值'),
  totalUnits: count('已知总单位数量；不得猜测未知的总量'),
  unit: text('进度单位名称，例如节点或文件', 80),
  waitingReason: text('可公开的等待原因'),
  errorCode: text('稳定错误代码，不含堆栈', 160),
  errorMessage: text('已脱敏的公开错误说明'),
  resultSummary: text('运行产物的有界文本摘要；缺失表示功能区未提供结果正文'),
  artifactId: id('产物引用标识；读取产物仍需单独鉴权'),
  schedule: text('调度规则；独立于运行阶段', 512),
  enabled: { description: '功能实体是否启用，不代表正在运行', type: 'boolean',
    required: false, since: 1, audiences: visible },
  diagnosticCode: { ...text('仅内部诊断代码；不承载原始日志或密钥', 160), audiences: ['internal'] },
};

export function probeDefinitions(): ProbeFieldDefinition[] {
  return Object.entries(definitions).map(([key, definition]) =>
    structuredClone({ key: key as ProbeField, ...definition }));
}

export function probeCatalog(audience: ProbeAudience): { schemaVersion: 1; fields: ProbeFieldDefinition[] } {
  return { schemaVersion: 1, fields: probeDefinitions().filter(field => field.audiences.includes(audience)) };
}
