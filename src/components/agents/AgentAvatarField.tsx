import { useRef, useState } from 'react';
import type { Agent } from '../../types';
import AgentAvatar from './AgentAvatar';
import { normalizeAvatarFile } from './agent-avatar-client';
import { useLocale } from '../../i18n/LocaleContext';

export default function AgentAvatarField({ agent, name, draft, removed, onChange, onError }: {
  agent: Agent | null;
  name: string;
  draft: string | null;
  removed: boolean;
  onChange: (draft: string | null, removed: boolean) => void;
  onError: (message: string) => void;
}) {
  const { t } = useLocale();
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
        <div className="agent-avatar-field__preview"><img src={draft} alt={t('avatar.preview')} /></div>
      ) : (
        <AgentAvatar agent={previewAgent} className="agent-avatar-field__preview" fallback={name.slice(0, 2) || 'AI'} />
      )}
      <div className="agent-avatar-field__actions">
        <label className="config-label">{t('avatar.label')}<span className="config-hint">{t('avatar.hint')}</span></label>
        <div className="agent-avatar-field__buttons">
          <button type="button" className="config-btn config-btn-cancel"
            onClick={() => inputRef.current?.click()} disabled={processing}>
            {processing ? t('avatar.processing') : agent?.avatar || draft ? t('avatar.change') : t('avatar.select')}
          </button>
          {(agent?.avatar || draft) && !removed && (
            <button type="button" className="config-btn config-btn-cancel"
              onClick={() => onChange(null, true)}>{t('avatar.remove')}</button>
          )}
        </div>
        <input ref={inputRef} className="agent-avatar-field__input" type="file" accept="image/*"
          onChange={event => void chooseFile(event.target.files?.[0])} />
      </div>
    </div>
  );
}
