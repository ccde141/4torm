export { createChatCompletion } from './chat-completions';
export { listModels } from './models';
export { createTextCompletion } from './text-completions';
export { LLMError, streamChatCompletion } from './client';
export type { RequestOptions } from './client';
export {
  getProviders,
  addProvider,
  updateProvider,
  removeProvider,
  getProvider,
  getProviderForModel,
  getAllModels,
  getActiveModel,
  setActiveModel,
  PROVIDER_PRESETS,
} from './config';
export type { ProviderEntry, ModelOption } from './config';

export type {
  MessageRole,
  ChatMessage,
  ToolCall,
  Tool,
  ChatCompletionParams,
  ChatCompletionResponse,
  Choice,
  Usage,
  TextCompletionParams,
  TextCompletionResponse,
  TextCompletionChoice,
  ModelInfo,
  ListModelsResponse,
} from './types';
