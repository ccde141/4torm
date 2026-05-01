import { useState, useEffect } from 'react';
import { updateAgentConfig, createAgent } from '../../store/agent';
import { getAllModels } from '../../llm';
import { getTools, seedTools, buildToolsPrompt } from '../../store/tools';
import { listSkills } from '../../store/skills';
import { readSkillFile } from '../../store/skills';
import { getStatuses, addStatus, getPresetColors } from '../../store/statuses';
import type { Agent, AgentConfig } from '../../types';
import type { ToolDef } from '../../store/tools';
import type { SkillMeta } from '../../types';
import type { StatusDef } from '../../store/statuses';
import '../../styles/components/config-modal.css';

interface CreateMode { mode: 'create'; onClose: () => void; onSave: () => void; }
interface EditMode { mode: 'edit'; agent: Agent; onClose: () => void; onSave: () => void; }
type Props = CreateMode | EditMode;

const EXAMPLE_MASTER = '你是全栈代码开发助手。\n遵循 ReAct 模式（Thought → Action → Observation）。\n严格遵守用户指令，代码完整可运行。';
const EXAMPLE_ROLE = '你是一个认真思考、注重质量的编程专家。';

const TABS = ['基本', '提示词', '技能'] as const;
type Tab = typeof TABS[number];

export default function AgentConfigModal(props: Props) {
  const isCreate = props.mode === 'create';
  const agent = isCreate ? null : props.agent;

  const [tab, setTab] = useState<Tab>('基本');
  const [name, setName] = useState(agent?.name ?? '');
  const [role, setRole] = useState(agent?.role ?? '');
  const [description, setDescription] = useState(agent?.description ?? '');
  const [masterPrompt, setMasterPrompt] = useState(agent?.config?.masterPrompt ?? (isCreate ? EXAMPLE_MASTER : ''));
  const [rolePrompt, setRolePrompt] = useState(agent?.config?.rolePrompt ?? (isCreate ? EXAMPLE_ROLE : ''));
  const [temperature, setTemperature] = useState(agent?.config?.temperature ?? 0.7);
  const [workspace, setWorkspace] = useState(agent?.config?.workspace ?? (isCreate ? '' : `data/agents/${(agent as Agent).id}/.workspace/`));
  const [maxToolCalls, setMaxToolCalls] = useState(agent?.config?.maxToolCalls ?? 100);
  const [maxContext, setMaxContext] = useState(agent?.config?.maxContextTokens ?? 256000);
  const [model, setModel] = useState(agent?.model ?? '');
  const [status, setStatus] = useState(agent?.status ?? 'idle');
  const [saved, setSaved] = useState(false);
  const [allModels, setAllModels] = useState<{ key: string; label: string }[]>([]);
  const [allTools, setAllTools] = useState<ToolDef[]>([]);
  const [checkedTools, setCheckedTools] = useState<Set<string>>(new Set(agent?.config?.tools ?? []));
  const [allSkills, setAllSkills] = useState<SkillMeta[]>([]);
  const [checkedSkills, setCheckedSkills] = useState<Set<string>>(new Set(agent?.config?.skills ?? []));
  const [skillPreviews, setSkillPreviews] = useState<Record<string, string>>({});
  const [allStatuses, setAllStatuses] = useState<StatusDef[]>([]);
  const [newStatusLabel, setNewStatusLabel] = useState('');
  const [newStatusColor, setNewStatusColor] = useState('#a78bfa');
  const [showAddStatus, setShowAddStatus] = useState(false);

  useEffect(() => {
    getAllModels().then(setAllModels);
    seedTools().then(() => getTools().then(setAllTools));
    listSkills().then(setAllSkills);
    getStatuses().then(setAllStatuses);
  }, []);

  useEffect(() => {
    if (tab !== '技能' || allSkills.length === 0) return;
    const ids = checkedSkills.size > 0 ? [...checkedSkills] : allSkills.map(s => s.id);
    Promise.all(ids.map(async id => {
      const content = await readSkillFile(id, 'SKILL.md');
      return { id, content: content || '(空)' };
    })).then(results => {
      const map: Record<string, string> = {};
      results.forEach(r => { map[r.id] = r.content; });
      setSkillPreviews(map);
    });
  }, [tab, allSkills, checkedSkills]);

  const handleAddStatus = async () => {
    if (!newStatusLabel.trim()) return;
    const def = await addStatus(newStatusLabel.trim(), newStatusColor);
    setAllStatuses(prev => [...prev, def]);
    setStatus(def.id);
    setNewStatusLabel('');
    setShowAddStatus(false);
  };

  const close = () => props.onClose();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleSave = async () => {
    const config: AgentConfig = { masterPrompt: '', rolePrompt, temperature: temperature || undefined, tools: [...checkedTools], skills: [...checkedSkills], maxToolCalls, maxContextTokens: maxContext, workspace: workspace || undefined };
    if (isCreate) {
      await createAgent({ name: name || '新 Agent', role, description, model, config, status });
    } else {
      const a = agent as Agent;
      await updateAgentConfig(a.id, config, model);
      const { updateAgent } = await import('../../store/agent');
      await updateAgent(a.id, { name, role, description, status });
    }
    setSaved(true);
    props.onSave();
    setTimeout(props.onClose, 600);
  };

  return (
    <div className="config-modal-overlay" onClick={close}>
      <div className="config-modal" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh' }}>
        <div className="config-modal-header">
          <div>
            <h3>{isCreate ? '创建 Agent' : `配置 ${agent?.name}`}</h3>
            <p className="config-modal-subtitle">{isCreate ? '分步填写' : `${agent?.role} · ${agent?.id}`}</p>
          </div>
          <button className="config-modal-close" onClick={close}>✕</button>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', padding: '0 var(--space-5)' }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: 'var(--space-3) var(--space-4)',
              background: 'none', border: 'none',
              borderBottom: tab === t ? '2px solid var(--color-accent)' : '2px solid transparent',
              color: tab === t ? 'var(--color-text)' : 'var(--color-text-tertiary)',
              fontSize: 'var(--text-sm)', fontWeight: tab === t ? 'var(--font-semibold)' : 'var(--font-normal)',
              cursor: 'pointer', marginBottom: '-1px',
            }}>{t}</button>
          ))}
        </div>

        <div className="config-modal-body" style={{ overflowY: 'auto' }}>
          {tab === '基本' && (
            <>
              <div style={{ display: 'flex', gap: 'var(--space-4)', marginBottom: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
                <div className="config-field" style={{ flex: 1 }}>
                  <label className="config-label">名称</label>
                  <input type="text" className="config-input config-input-full" value={name} onChange={e => setName(e.target.value)} placeholder="CoderAgent" />
                </div>
                <div className="config-field" style={{ flex: 1 }}>
                  <label className="config-label">角色</label>
                  <input type="text" className="config-input config-input-full" value={role} onChange={e => setRole(e.target.value)} placeholder="编程助手" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
                <div className="config-field" style={{ flex: 2 }}>
                  <label className="config-label">描述</label>
                  <input type="text" className="config-input config-input-full" value={description} onChange={e => setDescription(e.target.value)} placeholder="可配置的自定义智能体" />
                </div>
                <div className="config-field" style={{ flex: 1 }}>
                  <label className="config-label">状态</label>
                  <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                    <select className="config-input config-input-full" value={status} onChange={e => setStatus(e.target.value)}>
                      {allStatuses.map(s => (<option key={s.id} value={s.id}>{s.label}</option>))}
                    </select>
                    <button onClick={() => setShowAddStatus(!showAddStatus)} title="自定义状态" style={miniBtn}>+</button>
                  </div>
                  {showAddStatus && (
                    <div style={{ marginTop: 'var(--space-2)', padding: 'var(--space-2)', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                      <input value={newStatusLabel} onChange={e => setNewStatusLabel(e.target.value)} placeholder="状态名" style={{ ...inputStyle, flex: 1, fontSize: 'var(--text-xs)' }} />
                      <div style={{ display: 'flex', gap: '2px' }}>{getPresetColors().slice(0, 5).map(c => (
                        <button key={c} onClick={() => setNewStatusColor(c)} style={{ width: 16, height: 16, borderRadius: '50%', background: c, border: newStatusColor === c ? '2px solid #fff' : '1px solid transparent' }} />
                      ))}</div>
                      <input value={newStatusColor} onChange={e => setNewStatusColor(e.target.value)} style={{ ...inputStyle, width: '65px', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }} />
                      <button onClick={handleAddStatus} style={{ ...miniBtn, background: 'var(--color-accent)', color: 'var(--color-text-inverse)', border: 'none' }}>添加</button>
                    </div>
                  )}
                </div>
              </div>
              <div className="config-field" style={{ marginBottom: 'var(--space-4)' }}>
                <label className="config-label">模型</label>
                <select className="config-input config-input-full" value={model} onChange={e => setModel(e.target.value)}>
                  <option value="">未选择</option>
                  {allModels.map(m => (<option key={m.key} value={m.key}>{m.label}</option>))}
                </select>
              </div>
              <div className="config-field" style={{ marginBottom: 'var(--space-4)' }}>
                <label className="config-label">工作区<span className="config-hint">文件操作基础路径，多个 Agent 可共享同一工作区</span></label>
                <input type="text" className="config-input config-input-full" value={workspace} onChange={e => setWorkspace(e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}
                  placeholder={`data/agents/${agent?.id || '{id}'}/.workspace/`} />
              </div>
              <div className="config-field">
                <label className="config-label">Temperature<span className="config-value-display">{temperature}</span></label>
                <input type="range" className="config-slider" min={0} max={2} step={0.1} value={temperature} onChange={e => setTemperature(Number(e.target.value))} />
                <div className="config-slider-labels"><span>0（精准）</span><span>2（创意）</span></div>
              </div>
              <div className="config-field" style={{ marginBottom: 'var(--space-4)' }}>
                <label className="config-label">最大工具调用次数<span className="config-value-display">{maxToolCalls}</span></label>
                <input type="range" className="config-slider" min={1} max={200} step={1} value={maxToolCalls} onChange={e => setMaxToolCalls(Number(e.target.value))} />
                <div className="config-slider-labels"><span>1</span><span>200</span></div>
              </div>
              <div className="config-field" style={{ marginBottom: 'var(--space-4)' }}>
                <label className="config-label">上下文最大长度 (K tokens)<span className="config-value-display">{Math.round(maxContext / 1000)}K</span></label>
                <input type="range" className="config-slider" min={8000} max={1048576} step={8000} value={maxContext} onChange={e => setMaxContext(Number(e.target.value))} />
                <div className="config-slider-labels"><span>8K</span><span>1M</span></div>
              </div>
            </>
          )}

          {tab === '技能' && (
            <div className="config-field" style={{ marginTop: 'var(--space-4)' }}>
              <label className="config-label">已安装技能<span className="config-hint">勾选后 Agent 可调用 use_skill 按需加载。技能内容不注入系统提示词，由工具调用时动态返回</span></label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: 'var(--space-3)' }}>
                {allSkills.length === 0 && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>暂无技能 — 去「技能」页创建或安装</span>}
                {allSkills.map(s => {
                  const on = checkedSkills.has(s.id);
                  return (
                    <button key={s.id} onClick={() => { const next = new Set(checkedSkills); on ? next.delete(s.id) : next.add(s.id); setCheckedSkills(next); }}
                      style={{ ...toolTagStyle, background: on ? 'var(--color-accent)' : 'var(--color-bg)', color: on ? 'var(--color-text-inverse)' : 'var(--color-text)', border: `1px solid ${on ? 'var(--color-accent)' : 'var(--border-color)'}`, cursor: 'pointer' }}>
                      {on ? '✓ ' : ''}{s.name}{s.hasTools && <span style={{ fontSize: '10px', marginLeft: '2px' }}>🔧</span>}
                      <span style={{ fontSize: '10px', marginLeft: 'var(--space-1)', opacity: 0.6 }}>{s.category}</span>
                    </button>
                  );
                })}
              </div>
              {checkedSkills.size > 0 && (
                <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-3)' }}>
                  <div style={{ fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-2)', color: '#7c3aed' }}>已启用 {checkedSkills.size} 个技能</div>
                  {allSkills.filter(s => checkedSkills.has(s.id)).map(s => (
                    <div key={s.id} style={{ marginBottom: 'var(--space-3)' }}>
                      <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-1)' }}>📋 {s.name} ({s.id})</div>
                      <pre style={{ margin: 0, padding: 'var(--space-2)', background: 'var(--color-surface)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', maxHeight: '120px', overflow: 'auto', opacity: 0.85 }}>
                        {skillPreviews[s.id] || '加载中...'}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
              {allSkills.length > 0 && checkedSkills.size === 0 && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-3)' }}>
                  提示：勾选上方技能卡片即可启用
                </div>
              )}
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-2)' }}>
                     技能加载方式：Agent 调用 use_skill("技能名") → executor 返回 SKILL.md → 仅本条 tool result 占用上下文
              </div>
            </div>
          )}

          {tab === '提示词' && (
            <>

              <div className="config-field" style={{ marginTop: 'var(--space-4)' }}>
                <label className="config-label">工具<span className="config-hint">勾选后运行时自动注入到提示词末尾</span></label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: 'var(--space-3)' }}>
                  {allTools.length === 0 && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>暂无工具 — 去「工具」页注册</span>}
                  {allTools.map(t => {
                    const on = checkedTools.has(t.name);
                    return (
                      <button key={t.name} onClick={() => { const next = new Set(checkedTools); on ? next.delete(t.name) : next.add(t.name); setCheckedTools(next); }}
                        style={{ ...toolTagStyle, background: on ? 'var(--color-accent)' : 'var(--color-bg)', color: on ? 'var(--color-text-inverse)' : 'var(--color-text)', border: `1px solid ${on ? 'var(--color-accent)' : 'var(--border-color)'}`, cursor: 'pointer' }}>
                        {on ? '✓ ' : ''}{t.name}{t.dangerous && <span style={{ fontSize: '10px', marginLeft: '2px' }}>⚠</span>}
                      </button>
                    );
                  })}
                </div>

                {checkedTools.size > 0 && (
                  <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', opacity: 0.65, userSelect: 'none', marginBottom: 'var(--space-3)' }}>
                    {buildToolsPrompt(allTools.filter(t => checkedTools.has(t.name)))}
                  </div>
                )}
              </div>

              <div className="config-field" style={{ marginBottom: 'var(--space-4)' }}>
                <label className="config-label">角色提示词<span className="config-hint">模型角色定位，拼在系统提示词最前面。定义 Agent 的身份、语气和核心行为</span></label>
                <textarea className="config-textarea" value={rolePrompt} onChange={e => setRolePrompt(e.target.value)} rows={5} placeholder={EXAMPLE_ROLE} />
              </div>
            </>
          )}
        </div>

        <div className="config-modal-footer">
          <button className="config-btn config-btn-cancel" onClick={close}>取消</button>
          <button className={`config-btn config-btn-save ${saved ? 'config-btn-done' : ''}`} onClick={handleSave}>{saved ? '✓ 已保存' : isCreate ? '创建 Agent' : '保存配置'}</button>
        </div>
      </div>
    </div>
  );
}

const toolTagStyle: React.CSSProperties = { padding: '3px var(--space-2)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', borderRadius: 'var(--radius-sm)' };
const miniBtn: React.CSSProperties = { padding: 'var(--space-1) var(--space-2)', background: 'var(--color-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--text-sm)' };
const inputStyle: React.CSSProperties = { padding: 'var(--space-1) var(--space-2)', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text)', fontFamily: 'inherit', boxSizing: 'border-box' };
