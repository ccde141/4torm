export type ProviderProfileId =
  | 'openai-compatible'
  | 'kimi'
  | 'lmstudio'
  | 'deepseek'
  | 'zhipu-glm'
  | 'dashscope'
  | 'openrouter'
  | 'minimax'
  | 'siliconflow-thinking';

export type ProviderProfileSelection = 'auto' | ProviderProfileId;

export const PROVIDER_PROFILE_OPTIONS: ReadonlyArray<{
  value: ProviderProfileSelection;
  label: string;
}> = [
  { value: 'auto', label: '自动' },
  { value: 'openai-compatible', label: '通用 OpenAI' },
  { value: 'kimi', label: 'Kimi' },
  { value: 'lmstudio', label: 'LM Studio' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'zhipu-glm', label: '智谱 GLM 推理' },
  { value: 'dashscope', label: '通义 Qwen 推理' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'minimax', label: 'MiniMax' },
  { value: 'siliconflow-thinking', label: '硅基流动 · 启用推理' },
];

export function setModelProfile(
  current: Record<string, ProviderProfileId> | undefined,
  model: string,
  selection: ProviderProfileSelection,
): Record<string, ProviderProfileId> {
  const next = { ...(current ?? {}) };
  if (selection === 'auto') delete next[model];
  else next[model] = selection;
  return next;
}

export function retainModelProfiles(
  current: Record<string, ProviderProfileId> | undefined,
  models: string[],
): Record<string, ProviderProfileId> {
  const allowed = new Set(models);
  return Object.fromEntries(
    Object.entries(current ?? {}).filter(([model]) => allowed.has(model)),
  );
}
