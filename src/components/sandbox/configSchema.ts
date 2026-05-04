export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'toggle' | 'json';
  default?: unknown;
  options?: string[];
  placeholder?: string;
  rows?: number;
  min?: number;
  max?: number;
}

export type NodeConfigSchema = ConfigField[];

export const NODE_CONFIG_SCHEMAS: Record<string, NodeConfigSchema> = {};

export function registerConfigSchema(type: string, schema: NodeConfigSchema) {
  NODE_CONFIG_SCHEMAS[type] = schema;
}

registerConfigSchema('entry', [
  { key: 'label', label: '节点名称', type: 'text', default: '入口' },
  { key: 'inputContent', label: '输入内容', type: 'textarea', rows: 4, placeholder: '输入任务的初始指令...' },
]);

registerConfigSchema('agent', [
  { key: 'label', label: '节点名称', type: 'text', default: 'Agent' },
  { key: 'agentId', label: 'Agent ID', type: 'select', placeholder: '选择已加入沙盒的 Agent', options: [] },
  { key: 'workspacePath', label: '工作区路径', type: 'text' },
  { key: 'agentRole', label: '角色描述 (role_prompt)', type: 'textarea', rows: 4, placeholder: '定义 Agent 的角色与职责...\n支持模板变量：{{goal}} {{context}} {{input}} {{iteration}} {{fork_index}} {{variables.key名}}' },
  { key: 'outputSchema', label: '输出结构 (output_schema)', type: 'json', placeholder: '{"field":"type"}' },
]);

registerConfigSchema('condition', [
  { key: 'label', label: '节点名称', type: 'text', default: '条件分支' },
  { key: 'rules', label: '条件规则', type: 'json', placeholder: '[{"field":"input","operator":"eq","value":"yes"}]' },
]);

registerConfigSchema('loop-while', [
  { key: 'label', label: '节点名称', type: 'text', default: '条件循环' },
  { key: 'conditionField', label: '条件字段', type: 'text', default: 'input' },
  { key: 'conditionOperator', label: '条件运算符', type: 'select', options: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'regex'], default: 'neq' },
  { key: 'conditionValue', label: '条件值', type: 'text', default: 'done' },
  { key: 'maxIterations', label: '最大迭代', type: 'number', min: 1, max: 20, default: 10 },
]);

registerConfigSchema('merge', [
  { key: 'label', label: '节点名称', type: 'text', default: '合并' },
  { key: 'strategy', label: '合并策略', type: 'select', options: ['concat', 'structured', 'agent-summary'], default: 'concat' },
]);

registerConfigSchema('fork', [
  { key: 'label', label: '节点名称', type: 'text', default: '分叉' },
  { key: 'branchCount', label: '分叉数量', type: 'number', min: 2, max: 10, default: 2 },
]);

registerConfigSchema('variable', [
  { key: 'label', label: '节点名称', type: 'text', default: '变量' },
  { key: 'mode', label: '模式', type: 'select', options: ['read', 'write'], default: 'read' },
  { key: 'variableName', label: '变量键名', type: 'text', default: '' },
  { key: 'sourceField', label: '来源字段', type: 'text', default: 'input' },
]);

registerConfigSchema('human-gate', [
  { key: 'label', label: '节点名称', type: 'text', default: '人工确认' },
  { key: 'prompt', label: '提示文本', type: 'textarea', rows: 3, default: '请审阅当前内容并选择下一步操作' },
]);

registerConfigSchema('error-handler', [
  { key: 'label', label: '节点名称', type: 'text', default: '错误处理' },
  { key: 'fallbackMessage', label: '兜底提示', type: 'textarea', rows: 2, placeholder: '错误发生时的默认提示...' },
]);

registerConfigSchema('output', [
  { key: 'label', label: '节点名称', type: 'text', default: '输出' },
  { key: 'mode', label: '模式', type: 'select', options: ['snapshot', 'final'], default: 'final' },
  { key: 'filePath', label: '输出路径', type: 'text', default: 'workflow_output' },
  { key: 'fileNameTemplate', label: '文件名模板', type: 'text', default: '{flow}_output' },
  { key: 'format', label: '格式', type: 'select', options: ['json', 'xml', 'txt'], default: 'txt' },
]);

export const ARROW_CONFIG_SCHEMA: NodeConfigSchema = [
  { key: 'extractField', label: '提取字段 (extract_field)', type: 'text', placeholder: '留空 = 上游完整输出' },
  { key: 'contextMode', label: '携带上游摘要 (context_mode)', type: 'toggle', default: true },
  { key: 'injectRole', label: '覆盖下游角色 (inject_role)', type: 'toggle', default: false },
];
