import { useState, useEffect } from 'react';
import { listSkills, readSkillFile, readSkillToolDefs, createSkill, deleteSkill } from '../../store/skills';
import type { SkillMeta } from '../../types';
import '../../styles/components/skills.css';

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [preview, setPreview] = useState<{ meta: SkillMeta; content: string; tools: Array<{ name: string; description: string }> | null } | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('通用');
  const [newDesc, setNewDesc] = useState('');
  const [newContent, setNewContent] = useState('# 新技能\n\n在这里编写技能提示词...\n');

  useEffect(() => {
    listSkills().then(setSkills);
  }, []);

  useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(null); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [preview]);

  const handlePreview = async (skill: SkillMeta) => {
    const [content, tools] = await Promise.all([
      readSkillFile(skill.id, 'SKILL.md').catch(() => null),
      skill.hasTools ? readSkillToolDefs(skill.id).catch(() => null) : null,
    ]);
    setPreview({ meta: skill, content: content || '(空)', tools });
  };

  const handleDelete = async (skillId: string) => {
    try {
      await deleteSkill(skillId);
      setSkills(await listSkills());
    } catch { /* ignore */ }
  };

  const handleCreate = async () => {
    if (!newId.trim() || !newName.trim()) return;
    const meta: SkillMeta = {
      id: newId.trim().toLowerCase().replace(/\s+/g, '-'),
      name: newName.trim(),
      description: newDesc.trim(),
      category: newCategory,
      version: '1.0.0',
      author: 'User',
      hasTools: false,
    };
    await createSkill(meta.id, meta, newContent);
    setNewId(''); setNewName(''); setNewDesc(''); setNewContent('# 新技能\n\n在这里编写技能提示词...\n');
    setShowCreate(false);
    setSkills(await listSkills());
  };

  return (
    <div className="skills-page">
      <div className="skills-header">
        <div>
          <h2>技能</h2>
          <p className="skills-subtitle">Skill = 提示词注入 + 专属工具（可选）— 为 Agent 赋予领域专长</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button onClick={() => setShowCreate(!showCreate)}
            style={{ padding: 'var(--space-2) var(--space-4)', background: showCreate ? 'var(--color-bg)' : 'var(--color-accent)', color: showCreate ? 'var(--color-text)' : 'var(--color-text-inverse)', border: showCreate ? '1px solid var(--border-color)' : 'none', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
            {showCreate ? '关闭' : '+ 新建技能'}
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="skill-create-section">
          <h3>开发者模式 — 创建新技能</h3>
          <div className="skill-create-form">
            <div className="skill-create-row">
              <div style={{ flex: 1 }}>
                <label>技能 ID（文件夹名）</label>
                <input value={newId} onChange={e => setNewId(e.target.value)} placeholder="my-skill" style={{ width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label>名称</label>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="我的技能" style={{ width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 0.6 }}>
                <label>分类</label>
                <select value={newCategory} onChange={e => setNewCategory(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }}>
                  <option>通用</option><option>开发</option><option>设计</option><option>写作</option><option>分析</option><option>其他</option>
                </select>
              </div>
            </div>
            <div>
              <label>描述</label>
              <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="简短的技能描述..." style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label>SKILL.md（提示词注入内容）</label>
              <textarea value={newContent} onChange={e => setNewContent(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} rows={8} />
            </div>
            <button className="skill-create-submit" onClick={handleCreate}>创建技能</button>
          </div>
        </div>
      )}

      <div className="skills-grid" style={{ marginTop: showCreate ? 'var(--space-6)' : 0 }}>
        {skills.length === 0 && (
          <div style={{ padding: 'var(--space-8)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)', textAlign: 'center', gridColumn: '1 / -1' }}>
            暂无技能。<br />
            <span style={{ fontSize: 'var(--text-xs)' }}>小白模式：等待系统推送预置技能<br />开发者模式：点击「新建技能」手动创建<br />Agent 自注册：Agent 通过 write_file 自动创建</span>
          </div>
        )}
        {skills.map(skill => (
          <div key={skill.id} className="skill-card">
            <div className="skill-card__header">
              <h4 className="skill-card__name">{skill.name}</h4>
              <span className="skill-card__badge">{skill.category}</span>
            </div>
            <p className="skill-card__desc">{skill.description}</p>
            <div className="skill-card__meta">
              <span>{skill.version}</span>
              <span>by {skill.author}</span>
              {skill.hasTools && <span>🔧 含工具</span>}
            </div>
            <div className="skill-card__actions">
              <button className="skill-btn-preview" onClick={() => handlePreview(skill)}>预览 SKILL.md</button>
              <button className="skill-btn-delete" onClick={() => handleDelete(skill.id)}>移除</button>
            </div>
          </div>
        ))}
      </div>

      {preview && (
        <div className="skill-preview-overlay" role="dialog" aria-modal="true" aria-label={preview.meta.name} onClick={() => setPreview(null)}>
          <div className="skill-preview-modal" onClick={e => e.stopPropagation()}>
            <h3>{preview.meta.name}</h3>
            <div className="skill-preview-meta">
              <span>ID: {preview.meta.id}</span>
              <span>v{preview.meta.version}</span>
              <span>{preview.meta.category}</span>
            </div>
            <div className="skill-preview-content">{preview.content}</div>
            {preview.tools && preview.tools.length > 0 && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-2)' }}>附带工具 ({preview.tools.length})</div>
                {preview.tools.map((t, i) => (
                  <div key={i} style={{ padding: 'var(--space-2)', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', marginBottom: 'var(--space-1)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent)', fontWeight: 'var(--font-semibold)' }}>{t.name}</span>
                    <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 'var(--space-2)' }}>{t.description}</span>
                  </div>
                ))}
              </div>
            )}
            <button className="skill-preview-close" onClick={() => setPreview(null)}>关闭</button>
          </div>
        </div>
      )}
    </div>
  );
}
