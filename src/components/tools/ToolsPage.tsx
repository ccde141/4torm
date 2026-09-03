import { useState } from 'react';
import { getTools, saveTools, CATEGORY_LABELS, buildToolsPrompt } from '../../store/tools';
import type { ToolDef } from '../../store/tools';
import { useLocale } from '../../i18n/LocaleContext';
import type { Locale } from '../../i18n/locale';
import { useActiveCapabilityList } from '../capabilities/useActiveCapabilityList';
import '../../styles/components/capability-management.css';

export default function ToolsPage({ active }: { active: boolean }) {
  const { t } = useLocale();
  const { items: tools, loadError, refresh } = useActiveCapabilityList(active, getTools);
  const [adding, setAdding] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);

  return (
    <div className="capability-page" style={{ height: '100%', overflowY: 'auto' }}>
      <div className="capability-header">
        <div className="capability-heading">
          <h2 className="capability-title">{t('tools.page.title')}</h2>
          <p className="capability-subtitle">
            {t('tools.page.subtitle')}
          </p>
        </div>
        <div className="capability-actions">
          <button className="capability-button capability-button--secondary" onClick={() => void refresh().catch(() => undefined)}>
            {t('tools.page.refresh')}
          </button>
          {!adding && (
            <button className="capability-button capability-button--primary" onClick={() => setAdding(true)}>
              {t('tools.page.register')}
            </button>
          )}
        </div>
      </div>

      {loadError && <div className="capability-alert" role="alert">{loadError.message}</div>}

      {adding && (
        <ToolForm
          onSave={async (tool) => { await saveTools([...tools, { ...tool, source: 'custom', readonly: false }]); setAdding(false); await refresh(); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {tools.length === 0 && !adding && (
        <div className="capability-empty">
          <p style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>{t('tools.page.empty')}</p>
          <p style={{ fontSize: 'var(--text-xs)' }}>{t('tools.page.emptyHint')}</p>
        </div>
      )}

      <div className="capability-list" style={{ marginTop: adding ? 'var(--space-4)' : 0 }}>
        {tools.map(t => (
          // 编辑时在原位用表单替换卡片，避免表单跳到页面顶部、看起来「没反应」
          t.name === editingName && !t.readonly ? (
            <ToolForm
              key={t.name}
              initial={t}
              onSave={async (tool) => { await saveTools(tools.map(x => x.name === editingName ? { ...tool, source: 'custom', readonly: false } : x)); setEditingName(null); await refresh(); }}
              onCancel={() => setEditingName(null)}
            />
          ) : (
            <ToolCard key={t.name} tool={t} onEdit={() => setEditingName(t.name)} onDelete={async () => {
              await saveTools(tools.filter(x => x.name !== t.name));
              await refresh();
            }} />
          )
        ))}
      </div>
    </div>
  );
}

function ToolCard({ tool, onEdit, onDelete }: { tool: ToolDef; onEdit: () => void; onDelete: () => void }) {
  const { t } = useLocale();
  const category = t(`tools.category.${tool.category}` as 'tools.category.io');
  return (
    <div className="capability-panel capability-record">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-2)' }}>
        <div>
          <span style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-semibold)', fontFamily: 'var(--font-mono)' }}>{tool.name}</span>
          <span className="capability-badge" style={{ marginLeft: 'var(--space-2)' }}>{category}</span>
          {tool.readonly && <span className="capability-badge" style={{ marginLeft: 'var(--space-1)' }}>{t('tools.card.readonly')}</span>}
          {tool.dangerous && <span className="capability-badge capability-badge--warning" style={{ marginLeft: 'var(--space-1)' }}>{t('tools.card.dangerous')}</span>}
          <span style={{ marginLeft: 'var(--space-1)', color: tool.executionMode === 'detachable' ? 'var(--color-accent)' : 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)' }}>
            {tool.executionMode === 'detachable' ? t('tools.card.detachable') : t('tools.card.sync')}
          </span>
        </div>
        {!tool.readonly && (
          <div className="capability-actions">
            <button className="capability-button capability-button--secondary capability-button--compact" onClick={onEdit}>{t('tools.card.edit')}</button>
            <button className="capability-button capability-button--danger capability-button--compact" onClick={onDelete}>{t('tools.card.delete')}</button>
          </div>
        )}
      </div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>{tool.description}</div>
      <pre className="capability-code">
        {JSON.stringify(tool.parameters, null, 2)}
      </pre>
    </div>
  );
}

function ToolForm({ initial, onSave, onCancel }: {
  initial?: ToolDef;
  onSave: (tool: ToolDef) => void;
  onCancel: () => void;
}) {
  const { locale, t } = useLocale();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [category, setCategory] = useState<ToolDef['category']>(initial?.category ?? 'custom');
  const [dangerous, setDangerous] = useState(initial?.dangerous ?? false);
  const [executorType, setExecutorType] = useState<ToolDef['executorType']>(initial?.executorType ?? 'custom');
  const [executorFile, setExecutorFile] = useState(initial?.executorFile ?? '');
  const [executorTemplate, setExecutorTemplate] = useState(initial?.executorTemplate ?? '');
  const [executionMode, setExecutionMode] = useState<NonNullable<ToolDef['executionMode']>>(initial?.executionMode ?? 'sync');
  const [paramsJson, setParamsJson] = useState(initial ? JSON.stringify(initial.parameters, null, 2) : '{\n  \n}');
  const [jsonError, setJsonError] = useState('');

  const previewName = name || t('tools.form.previewName');
  const schemaTemplates = getSchemaTemplates(locale);

  const handleSave = () => {
    if (!name.trim()) return;
    let params: Record<string, unknown>;
    try { params = JSON.parse(paramsJson); setJsonError(''); } catch {
      setJsonError(t('tools.form.invalidJson'));
      return;
    }
    onSave({ name: name.trim(), description, category, dangerous, executorType, executorFile: executorFile || undefined, executorTemplate: executorTemplate || undefined, executionMode, parameters: params });
  };

  return (
    <div className="capability-panel capability-panel--active capability-form" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-4)' }}>
      <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-semibold)', margin: '0 0 var(--space-4) 0' }}>
        {initial ? t('tools.form.editTitle', { name }) : t('tools.form.createTitle')}
      </h3>

      <div style={{ display: 'flex', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>{t('tools.form.name')} <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 'var(--font-normal)' }}>{t('tools.form.nameHint')}</span></label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t('tools.form.namePlaceholder')} style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
        </div>
        <div style={{ width: '140px' }}>
          <label style={labelStyle}>{t('tools.form.category')}</label>
          <select value={category} onChange={e => setCategory(e.target.value as ToolDef['category'])} style={inputStyle}>
            {Object.keys(CATEGORY_LABELS).map(k => (<option key={k} value={k}>{t(`tools.category.${k}` as 'tools.category.io')}</option>))}
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 'var(--space-4)' }}>
        <label style={labelStyle}>{t('tools.form.description')} <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 'var(--font-normal)' }}>{t('tools.form.descriptionHint')}</span></label>
        <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder={t('tools.form.descriptionPlaceholder')} style={inputStyle} />
      </div>

      <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', marginBottom: 'var(--space-4)' }}>
        <input type="checkbox" checked={dangerous} onChange={e => setDangerous(e.target.checked)} />
        {t('tools.form.dangerous')}
      </label>

      <div style={{ marginBottom: 'var(--space-4)' }}>
        <label style={labelStyle}>{t('tools.form.executionLifecycle')}</label>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {(['sync', 'detachable'] as const).map(mode => (
            <button key={mode} type="button" onClick={() => setExecutionMode(mode)}
              className={`capability-button capability-button--secondary${executionMode === mode ? ' is-active' : ''}`}>
              {mode === 'sync' ? t('tools.form.sync') : t('tools.form.detachable')}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-1)', lineHeight: 1.5 }}>
          {t('tools.form.lifecycleHint')}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-6)' }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>
            {t('tools.form.schema')} <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 'var(--font-normal)' }}>{t('tools.form.schemaHint')}</span>
      </label>

      <div style={{ marginBottom: 'var(--space-4)' }}>
        <label style={labelStyle}>{t('tools.form.executor')} <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 'var(--font-normal)' }}>{t('tools.form.executorHint')}</span></label>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
          {(['template', 'custom'] as const).map(executor => (
            <button key={executor} onClick={() => setExecutorType(executor)}
              className={`capability-button capability-button--secondary capability-button--compact${executorType === executor ? ' is-active' : ''}`}>
              {executor === 'template' ? t('tools.form.template') : t('tools.form.customJs')}
            </button>
          ))}
        </div>
        {executorType === 'template' && (
          <input type="text" value={executorTemplate} onChange={e => setExecutorTemplate(e.target.value)}
            placeholder={t('tools.form.templatePlaceholder')}
            style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }} />
        )}
        {executorType === 'custom' && (
          <div>
            <input type="text" value={executorFile} onChange={e => setExecutorFile(e.target.value)}
              placeholder={t('tools.form.filePlaceholder')}
              style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }} />
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-1)' }}>
              {t('tools.form.fileHint')}
            </div>
          </div>
        )}
      </div>
          <textarea
            value={paramsJson}
            onChange={e => { setParamsJson(e.target.value); setJsonError(''); }}
            rows={8}
            style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', resize: 'vertical', border: jsonError ? '1px solid #f87171' : '1px solid var(--border-color)' }}
            spellCheck={false}
          />
          {jsonError && <div style={{ fontSize: 'var(--text-xs)', color: '#f87171', marginTop: '2px' }}>{jsonError}</div>}
          <div style={{ marginTop: 'var(--space-2)', display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{t('tools.form.schemaTemplates')}</span>
            {schemaTemplates.map(tpl => (
              <button className="capability-button capability-button--secondary capability-button--compact" key={tpl.label} onClick={() => { setParamsJson(tpl.value); setJsonError(''); }}>
                {tpl.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <label style={labelStyle}>{t('tools.form.preview')}</label>
          <pre className="capability-code" style={{ color: 'var(--color-text-secondary)', minHeight: '100px' }}>
            {buildToolsPrompt([{ name: previewName, description: description || t('tools.form.previewDescription'), category, dangerous, executorType, executionMode, parameters: (() => { try { return JSON.parse(paramsJson); } catch { return {}; } })() }])}
          </pre>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)', borderTop: '1px solid var(--border-color)', paddingTop: 'var(--space-4)' }}>
        <button className="capability-button capability-button--primary" onClick={handleSave}>
          {initial ? t('tools.form.save') : t('tools.form.register')}
        </button>
        <button className="capability-button capability-button--secondary" onClick={onCancel}>
          {t('tools.form.cancel')}
        </button>
      </div>
    </div>
  );
}

function getSchemaTemplates(locale: Locale) {
  const english = locale === 'en-US';
  return [
    { label: english ? 'Empty' : '空模板', value: '{\n  \n}' },
    { label: english ? 'String parameter' : '字符串参数', value: `{\n  "type": "object",\n  "properties": {\n    "text": { "type": "string", "description": "${english ? 'Text content' : '文本内容'}" }\n  },\n  "required": ["text"]\n}` },
    { label: english ? 'Number parameter' : '数值参数', value: `{\n  "type": "object",\n  "properties": {\n    "count": { "type": "number", "description": "${english ? 'Quantity' : '数量'}" }\n  },\n  "required": ["count"]\n}` },
    { label: english ? 'File path' : '文件路径', value: `{\n  "type": "object",\n  "properties": {\n    "filePath": { "type": "string", "description": "${english ? 'File path' : '文件路径'}" }\n  },\n  "required": ["filePath"]\n}` },
    { label: english ? 'Read and write' : '读写混合', value: `{\n  "type": "object",\n  "properties": {\n    "filePath": { "type": "string", "description": "${english ? 'File path' : '文件路径'}" },\n    "content": { "type": "string", "description": "${english ? 'Content to write' : '写入内容'}" }\n  },\n  "required": ["filePath"]\n}` },
  ];
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-medium)', marginBottom: 'var(--space-1)' };
const inputStyle: React.CSSProperties = { width: '100%', color: 'var(--color-text)', fontSize: 'var(--text-sm)', fontFamily: 'inherit', boxSizing: 'border-box' };
