import { useState, useEffect } from 'react';
import { updateAgentConfig, createAgent, updateAgent } from '../../store/agent';
import { getAllModels } from '../../llm';
import type { Agent, AgentConfig } from '../../types';
import AgentConfigTabs, { type AgentConfigTab } from './AgentConfigTabs';
import AgentPermissionField from './AgentPermissionField';
import AgentAvatarField from './AgentAvatarField';
import { removeAgentAvatar, uploadAgentAvatar } from './agent-avatar-client';
import { normalizeAgentPermission } from './agent-permission';
import { useSkillSelection, useToolSelection } from './useAgentCapabilitySelection';
import { useLocale } from '../../i18n/LocaleContext';
import AgentToolCapabilities from './AgentToolCapabilities';
import { useMcpToolCatalog } from './useMcpToolCatalog';
import '../../styles/components/config-modal.css';
import '../../styles/components/agent-permission.css';

interface CreateMode { mode: 'create'; onClose: () => void; onSave: () => void; }
interface EmbeddedMode { mode: 'embedded'; agent: Agent; tab: AgentConfigTab;
  onClose: () => void; onSave: () => void; }
type Props = CreateMode | EmbeddedMode;

export default function AgentConfigModal(props: Props) {
  const { t, locale } = useLocale();
  const { onClose } = props;
  const isCreate = props.mode === 'create';
  const embedded = props.mode === 'embedded';
  const agent = isCreate ? null : props.agent;

  const [ownTab, setTab] = useState<AgentConfigTab>('basic');
  const tab = embedded ? props.tab : ownTab;
  const [name, setName] = useState(agent?.name ?? '');
  const [role, setRole] = useState(agent?.role ?? '');
  const [description, setDescription] = useState(agent?.description ?? '');
  const [rolePrompt, setRolePrompt] = useState(agent?.config?.rolePrompt ?? (isCreate ? t('config.exampleRole') : ''));
  const [compactionPrompt, setCompactionPrompt] = useState(agent?.config?.compactionPrompt ?? '');
  const [workspace, setWorkspace] = useState(agent?.config?.workspace ?? (isCreate ? '' : `data/agents/${(agent as Agent).id}/.workspace/`));
  const [sandboxLevel, setSandboxLevel] = useState(() => normalizeAgentPermission(agent?.config?.sandboxLevel));
  const [model, setModel] = useState(agent?.model ?? '');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null);
  const [avatarRemoved, setAvatarRemoved] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [allModels, setAllModels] = useState<{ key: string; label: string }[]>([]);
  const { allTools, checkedTools, setCheckedTools, catalogError } = useToolSelection(agent?.config, isCreate, tab === 'tools');
  const { allSkills, checkedSkills, setCheckedSkills, skillPreviews } = useSkillSelection(agent?.config, isCreate);
  const mcp = useMcpToolCatalog(tab === 'tools');

  useEffect(() => {
    getAllModels().then(setAllModels);
  }, []);

  const close = () => onClose();

  useEffect(() => {
    if (embedded) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [embedded, onClose]);

  const handleSave = async () => {
    if (saving || saved) return;
    const config: AgentConfig = { masterPrompt: '', rolePrompt, compactionPrompt,
      temperature: agent?.config?.temperature, tools: [...checkedTools],
      toolMode: 'selected', skills: [...checkedSkills],
      workspace: workspace || undefined, sandboxLevel };
    setSaveError('');
    setSaving(true);
    let savedAgent: Agent;
    let avatarFailed = false;
    try {
      if (isCreate) {
        savedAgent = await createAgent({ name: name || t('config.defaultName'), role, description, model, config });
      } else {
        const a = agent as Agent;
        await updateAgentConfig(a.id, config, model, {
          name, role, description,
        });
        savedAgent = { ...a, name, role, description, model, config };
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Agent 保存失败');
      setSaving(false);   // 失败：恢复，允许重试
      return;
    }
    try {
      if (avatarDraft) {
        const version = await uploadAgentAvatar(savedAgent.id, avatarDraft);
        await updateAgent(savedAgent.id, { avatar: { version } });
      } else if (avatarRemoved && savedAgent.avatar) {
        await updateAgent(savedAgent.id, { avatar: undefined });
        await removeAgentAvatar(savedAgent.id);
      }
    } catch (error) {
      avatarFailed = true;
      setAvatarError(t('config.avatarFailed', { error: (error as Error).message }));
    }
    setSaved(true);       // 成功：转「✓ 已保存」并在关闭前保持禁用
    props.onSave();
    if (embedded) {
      setSaving(false);
      if (!avatarFailed) { setAvatarDraft(null); setAvatarRemoved(false); }
      window.setTimeout(() => setSaved(false), 1200);
    } else setTimeout(props.onClose, avatarFailed ? 1800 : 600);
  };

  const content = (
    <>
        <div className="config-modal-body" style={{ overflowY: 'auto' }}>
          {tab === 'basic' && (
            <>
              <AgentAvatarField agent={agent} name={name} draft={avatarDraft} removed={avatarRemoved}
                onChange={(draft, removed) => { setAvatarDraft(draft); setAvatarRemoved(removed); setAvatarError(''); }}
                onError={setAvatarError} />
              {avatarError && <div className="agent-avatar-field__error" role="alert">{avatarError}</div>}
              <div style={{ display: 'flex', gap: 'var(--space-4)', marginBottom: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
                <div className="config-field" style={{ flex: 1 }}>
                  <label className="config-label">{t('config.name')}</label>
                  <input type="text" className="config-input config-input-full" value={name} onChange={e => setName(e.target.value)} placeholder="CoderAgent" />
                </div>
                <div className="config-field" style={{ flex: 1 }}>
                  <label className="config-label">{t('config.role')}</label>
                  <input type="text" className="config-input config-input-full" value={role} onChange={e => setRole(e.target.value)} placeholder={t('config.rolePlaceholder')} />
                </div>
              </div>
              <div className="config-field" style={{ marginBottom: 'var(--space-4)' }}>
                <label className="config-label">{t('config.description')}</label>
                <input type="text" className="config-input config-input-full" value={description} onChange={e => setDescription(e.target.value)} placeholder={t('config.descriptionPlaceholder')} />
              </div>
              <div className="config-field" style={{ marginBottom: 'var(--space-4)' }}>
                <label className="config-label">{t('config.model')}</label>
                <select className="config-input config-input-full" value={model} onChange={e => setModel(e.target.value)}>
                  <option value="">{t('config.notSelected')}</option>
                  {allModels.map(m => (<option key={m.key} value={m.key}>{m.label}</option>))}
                </select>
              </div>
              <div className="config-field" style={{ marginBottom: 'var(--space-4)' }}>
                <label className="config-label">{t('config.workspace')}<span className="config-hint">{t('config.workspaceHint')}</span></label>
                <input type="text" className="config-input config-input-full" value={workspace} onChange={e => setWorkspace(e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}
                  placeholder={`data/agents/${agent?.id || '{id}'}/.workspace/`} />
              </div>
              <AgentPermissionField value={sandboxLevel} onChange={setSandboxLevel} />
            </>
          )}

          {tab === 'skills' && (
            <div className="config-field" style={{ marginTop: 'var(--space-4)' }}>
              <label className="config-label">{t('config.installedSkills')}<span className="config-hint">{t('config.skillsHint')}</span></label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: 'var(--space-3)' }}>
                {allSkills.length === 0 && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{t('config.noSkills')}</span>}
                {allSkills.map(s => {
                  const on = checkedSkills.has(s.id);
                  return (
                    <button key={s.id} onClick={() => { const next = new Set(checkedSkills); if (on) next.delete(s.id); else next.add(s.id); setCheckedSkills(next); }}
                      style={{ ...toolTagStyle, background: on ? 'var(--color-accent)' : 'var(--color-bg)', color: on ? 'var(--color-on-accent)' : 'var(--color-text)', border: `1px solid ${on ? 'var(--color-accent)' : 'var(--border-color)'}`, cursor: 'pointer' }}>
                      {on ? '✓ ' : ''}{s.name}{s.hasTools && <span style={{ fontSize: '10px', marginLeft: '2px' }}>🔧</span>}
                      <span style={{ fontSize: '10px', marginLeft: 'var(--space-1)', opacity: 0.6 }}>{s.category}</span>
                    </button>
                  );
                })}
              </div>
              {checkedSkills.size > 0 && (
                <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-3)' }}>
                  <div style={{ fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-2)', color: '#7c3aed' }}>{t('config.enabledSkills', { count: checkedSkills.size })}</div>
                  {allSkills.filter(s => checkedSkills.has(s.id)).map(s => (
                    <div key={s.id} style={{ marginBottom: 'var(--space-3)' }}>
                      <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-1)' }}>📋 {s.name} ({s.id})</div>
                      <pre style={{ margin: 0, padding: 'var(--space-2)', background: 'var(--color-surface)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', maxHeight: '120px', overflow: 'auto', opacity: 0.85 }}>
                        {skillPreviews[s.id] || t('config.skillLoading')}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
              {allSkills.length > 0 && checkedSkills.size === 0 && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-3)' }}>
                  {t('config.selectSkillHint')}
                </div>
              )}
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-2)' }}>
                     {t('config.skillMechanism')}
              </div>
            </div>
          )}

          {tab === 'prompt' && (
            <div className="config-field" style={{ marginTop: 'var(--space-4)' }}>
              <label className="config-label">{t('config.rolePrompt')}<span className="config-hint">{t('config.rolePromptHint')}</span></label>
              <textarea className="config-textarea" value={rolePrompt}
                onChange={e => setRolePrompt(e.target.value)} rows={5}
                placeholder={t('config.exampleRole')} />
              <label className="config-label" style={{ marginTop: 'var(--space-4)' }}>{t('config.compactionPrompt')}</label>
              <textarea className="config-textarea" value={compactionPrompt}
                onChange={event => setCompactionPrompt(event.target.value)} rows={3}
                placeholder={t('config.compactionPromptHint')} />
            </div>
          )}

          {tab === 'tools' && (
            <div className="config-field" style={{ marginTop: 'var(--space-4)' }}>
              <label className="config-label">{t('config.tools')}<span className="config-hint">{t('config.toolsHint')}</span></label>
              {catalogError && <div className="agent-avatar-field__error" role="alert">
                {t('config.toolCatalogFailed', { error: catalogError })}
              </div>}
              <button type="button" className="config-btn config-btn-cancel" disabled={mcp.loading} onClick={mcp.refresh}>
                {locale === 'en-US' ? (mcp.loading ? 'Loading MCP tools…' : 'Refresh MCP tools')
                  : (mcp.loading ? '正在获取 MCP 工具…' : '刷新 MCP 工具')}
              </button>
              {mcp.error && <div className="agent-avatar-field__error" role="alert">{mcp.error}</div>}
              <AgentToolCapabilities allTools={allTools} checkedTools={checkedTools}
                mcpGroups={mcp.groups} onChange={setCheckedTools} />
            </div>
          )}
        </div>

        {saveError && <div className="agent-avatar-field__error" role="alert">{saveError}</div>}
        <div className="config-modal-footer">
          <button className="config-btn config-btn-cancel" onClick={close} disabled={saving}>
            {embedded ? t('dashboard.detail.backOverview') : t('common.cancel')}</button>
          <button className={`config-btn config-btn-save ${saved ? 'config-btn-done' : ''}`} onClick={handleSave} disabled={saving || saved}>{saved ? t('config.saved') : saving ? t('config.saving') : isCreate ? t('config.createTitle') : t('config.save')}</button>
        </div>
    </>
  );
  if (embedded) return content;
  return <div className="config-modal-overlay" onClick={close}>
    <div className="config-modal" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh' }}>
      <div className="config-modal-header">
        <div><h3>{t('config.createTitle')}</h3>
          <p className="config-modal-subtitle">{t('config.stepByStep')}</p></div>
        <button className="config-modal-close" onClick={close} aria-label={t('config.close')}>✕</button>
      </div>
      <AgentConfigTabs active={tab} onChange={setTab} />
      {content}
    </div>
  </div>;
}

const toolTagStyle: React.CSSProperties = { padding: '3px var(--space-2)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', borderRadius: 'var(--radius-sm)' };
