import { useRef, useState } from 'react';
import type { Agent } from '../../types';
import AgentAvatar from './AgentAvatar';
import { normalizeAvatarFile } from './agent-avatar-client';

export default function AgentAvatarField({ agent, name, draft, removed, onChange, onError }: {
  agent: Agent | null;
  name: string;
  draft: string | null;
  removed: boolean;
  onChange: (draft: string | null, removed: boolean) => void;
  onError: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const previewAgent = removed ? null : agent;

  const chooseFile = async (file?: File) => {
    if (!file) return;
    setProcessing(true);
    onError('');
    try {
      onChange(await normalizeAvatarFile(file), false);
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setProcessing(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="agent-avatar-field">
      {draft ? (
        <div className="agent-avatar-field__preview"><img src={draft} alt="待保存的 Agent 头像" /></div>
      ) : (
        <AgentAvatar agent={previewAgent} className="agent-avatar-field__preview" fallback={name.slice(0, 2) || 'AI'} />
      )}
      <div className="agent-avatar-field__actions">
        <label className="config-label">头像<span className="config-hint">自动居中裁切并保存为 256px WebP</span></label>
        <div className="agent-avatar-field__buttons">
          <button type="button" className="config-btn config-btn-cancel"
            onClick={() => inputRef.current?.click()} disabled={processing}>
            {processing ? '处理中…' : agent?.avatar || draft ? '更换图片' : '选择图片'}
          </button>
          {(agent?.avatar || draft) && !removed && (
            <button type="button" className="config-btn config-btn-cancel"
              onClick={() => onChange(null, true)}>移除头像</button>
          )}
        </div>
        <input ref={inputRef} className="agent-avatar-field__input" type="file" accept="image/*"
          onChange={event => void chooseFile(event.target.files?.[0])} />
      </div>
    </div>
  );
}
