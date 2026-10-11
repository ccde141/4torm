import { frameworkError } from '../../../engine/shared/framework-error.js';
import {
  ConversationAttachmentMissingError, deleteConversationAttachment,
  deleteConversationAttachments, readConversationAttachment, saveConversationAttachment,
} from '../infrastructure/attachments.js';

export interface AttachmentSessionLookup {
  get(agentId: string, sessionId: string): Promise<unknown | null>;
}

export class MonsoonAttachmentService {
  constructor(private readonly dataDir: string, private readonly sessions: AttachmentSessionLookup) {}

  async upload(input: {
    agentId: string; sessionId: string; name: string; mimeType: string; dataUrl: string;
  }) {
    await this.requireSession(input.agentId, input.sessionId);
    try {
      return await saveConversationAttachment(this.dataDir, input.agentId, input.sessionId, input);
    } catch (error) { return imageError(error); }
  }

  async read(agentId: string, sessionId: string, attachmentId: string) {
    await this.requireSession(agentId, sessionId);
    try { return await readConversationAttachment(this.dataDir, agentId, sessionId, attachmentId); }
    catch (error) { return imageError(error); }
  }

  async deleteOne(agentId: string, sessionId: string, attachmentId: string) {
    await this.requireSession(agentId, sessionId);
    try { await deleteConversationAttachment(this.dataDir, agentId, sessionId, attachmentId); }
    catch (error) { imageError(error); }
    return { ok: true };
  }

  async deleteAll(agentId: string, sessionId: string) {
    await deleteConversationAttachments(this.dataDir, agentId, sessionId);
    return { ok: true };
  }

  private async requireSession(agentId: string, sessionId: string): Promise<void> {
    if (!await this.sessions.get(agentId, sessionId)) throw frameworkError({
      code: 'MONSOON_ATTACHMENT_SESSION_NOT_FOUND', kind: 'not_found',
      message: '会话不存在', source: 'monsoon.attachments', retryable: false,
    });
  }
}

function imageError(error: unknown): never {
  if (error instanceof ConversationAttachmentMissingError) throw frameworkError({
    code: 'MONSOON_ATTACHMENT_NOT_FOUND', kind: 'not_found', message: '附件不存在',
    source: 'monsoon.attachments', retryable: false,
  }, { cause: error });
  if (error instanceof Error && /^(无效附件标识|不支持的图片类型|图片)/.test(error.message)) {
    throw frameworkError({ code: 'MONSOON_ATTACHMENT_INVALID', kind: 'validation',
      message: error.message, source: 'monsoon.attachments', retryable: false }, { cause: error });
  }
  throw error;
}
