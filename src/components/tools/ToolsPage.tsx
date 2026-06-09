import { useState, useEffect } from 'react';
import { getTools, saveTools, seedTools, CATEGORY_LABELS, buildToolsPrompt } from '../../store/tools';
import type { ToolDef } from '../../store/tools';

export default function ToolsPage() {
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);

  useEffect(() => {
    seedTools().then(() => getTools().then(setTools));
  }, []);

  const refresh = () => getTools().then(setTools);

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: '900px', margin: '0 auto', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)', margin: '0 0 var(--space-1) 0' }}>全局工具注册表</h2>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', margin: 0 }}>
            注册一次，所有 Agent 共用。在 Agent 配置中勾选即可启用。
          </p>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} style={{ padding: 'var(--space-2) var(--space-4)', background: 'var(--color-accent)', color: 'var(--color-text-inverse)', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', cursor: 'pointer', flexShrink: 0 }}>
            + 注册工具
          </button>
        )}
      </div>

      {adding && (
        <ToolForm
          onSave={async (tool) => { await saveTools([...tools, tool]); setAdding(false); refresh(); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {editingName && (
        <ToolForm
          initial={tools.find(t => t.name === editingName)}
          onSave={async (tool) => { await saveTools(tools.map(t => t.name === editingName ? tool : t)); setEditingName(null); refresh(); }}
          onCancel={() => setEditingName(null)}
        />
      )}

      {tools.length === 0 && !adding && (
        <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-tertiary)' }}>
          <p style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>还没有注册任何工具</p>
          <p style={{ fontSize: 'var(--text-xs)' }}>点击右上角「注册工具」开始，或系统会自动导入 4 个内置工具模板</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: adding ? 'var(--space-4)' : 0 }}>
        {tools.map(t => (
          <ToolCard key={t.name} tool={t} onEdit={() => setEditingName(t.name)} onDelete={async () => {
            await saveTools(tools.filter(x => x.name !== t.name));
            refresh();
          }} />
        ))}
      </div>
    </div>
  );
}

function ToolCard({ tool, onEdit, onDelete }: { tool: ToolDef; onEdit: () => void; onDelete: () => void }) {
  return (
    <div style={{ padding: 'var(--space-4)', background: 'var(--color-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-2)' }}>
        <div>
          <span style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-semibold)', fontFamily: 'var(--font-mono)' }}>{tool.name}</span>
          <span style={{ marginLeft: 'var(--space-2)', padding: '1px 6px', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{CATEGORY_LABELS[tool.category]}</span>
          {tool.dangerous && <span style={{ marginLeft: 'var(--space-1)', color: '#fbbf24', fontSize: 'var(--text-xs)' }}>⚠ 需确认</span>}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button onClick={onEdit} style={ghostBtnStyle}>编辑</button>
          <button onClick={onDelete} style={{ ...ghostBtnStyle, color: '#f87171' }}>删除</button>
        </div>
      </div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>{tool.description}</div>
      <pre style={{
        padding: 'var(--space-2)',
        background: 'var(--color-bg)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--text-xs)',
        fontFamily: 'var(--font-mono)',
        color: 'var(--color-text-tertiary)',
        margin: 0,
        whiteSpace: 'pre-wrap',
      }}>
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
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [category, setCategory] = useState<ToolDef['category']>(initial?.category ?? 'custom');
  const [dangerous, setDangerous] = useState(initial?.dangerous ?? false);
  const [executorType, setExecutorType] = useState<ToolDef['executorType']>(initial?.executorType ?? 'builtin');
  const [executorFile, setExecutorFile] = useState(initial?.executorFile ?? '');
  const [executorTemplate, setExecutorTemplate] = useState(initial?.executorTemplate ?? '');
  const [paramsJson, setParamsJson] = useState(initial ? JSON.stringify(initial.parameters, null, 2) : '{\n  \n}');
  const [jsonError, setJsonError] = useState('');

  const previewName = name || '工具名';

  const handleSave = () => {
    if (!name.trim()) return;
    let params: Record<string, unknown> = {};
    try { params = JSON.parse(paramsJson); setJsonError(''); } catch {
      setJsonError('JSON 格式无效，请检查语法');
      return;
    }
    onSave({ name: name.trim(), description, category, dangerous, executorType, executorFile: executorFile || undefined, executorTemplate: executorTemplate || undefined, parameters: params });
  };

  return (
    <div style={{ padding: 'var(--space-5)', background: 'var(--color-surface)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-4)' }}>
      <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-semibold)', margin: '0 0 var(--space-4) 0' }}>
        {initial ? `编辑 ${name}` : '注册新工具'}
      </h3>

      <div style={{ display: 'flex', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>工具名称 <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 'var(--font-normal)' }}>— LLM 调用时使用的标识符</span></label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="例如: web_search" style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
        </div>
        <div style={{ width: '140px' }}>
          <label style={labelStyle}>分类</label>
          <select value={category} onChange={e => setCategory(e.target.value as ToolDef['category'])} style={inputStyle}>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 'var(--space-4)' }}>
        <label style={labelStyle}>功能描述 <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 'var(--font-normal)' }}>— 告诉 LLM 这个工具是干什么的</span></label>
        <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="例如: 使用搜索引擎查询最新信息" style={inputStyle} />
      </div>

      <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', marginBottom: 'var(--space-4)' }}>
        <input type="checkbox" checked={dangerous} onChange={e => setDangerous(e.target.checked)} />
        危险操作 — 选中后，Agent 执行此工具前会弹窗请求人工确认
      </label>

      <div style={{ display: 'flex', gap: 'var(--space-6)' }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>
            参数 Schema <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 'var(--font-normal)' }}>— JSON Schema 格式，定义参数名、类型、是否必填</span>
      </label>

      <div style={{ marginBottom: 'var(--space-4)' }}>
        <label style={labelStyle}>执行方式 <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 'var(--font-normal)' }}>— 内置无需代码，模板填命令即可，自定义需写 JS</span></label>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
          {(['builtin', 'template', 'custom'] as const).map(t => (
            <button key={t} onClick={() => setExecutorType(t)} style={{
              ...tinyBtn, padding: 'var(--space-1) var(--space-3)',
              background: executorType === t ? 'var(--color-accent)' : 'var(--color-surface)',
              color: executorType === t ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
            }}>
              {{ builtin: '内置', template: '命令模板', custom: '自定义 JS' }[t]}
            </button>
          ))}
        </div>
        {executorType === 'template' && (
          <input type="text" value={executorTemplate} onChange={e => setExecutorTemplate(e.target.value)}
            placeholder='例如: curl -s https://api.example.com/{{query}}'
            style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }} />
        )}
        {executorType === 'custom' && (
          <div>
            <input type="text" value={executorFile} onChange={e => setExecutorFile(e.target.value)}
              placeholder='文件名 (如 my_tool，对应 executors/my_tool.js)'
              style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }} />
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-1)' }}>
              在 data/tools/executors/ 下创建同名 .js 文件，方舟会自动加载
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
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>快速模板：</span>
            {SCHEMA_TEMPLATES.map(tpl => (
              <button key={tpl.label} onClick={() => { setParamsJson(tpl.value); setJsonError(''); }} style={{ ...tinyBtn, padding: '1px var(--space-2)' }}>
                {tpl.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <label style={labelStyle}>注入预览</label>
          <pre style={{
            padding: 'var(--space-3)',
            background: 'var(--color-bg)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-xs)',
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-text-secondary)',
            whiteSpace: 'pre-wrap',
            margin: 0,
            minHeight: '100px',
          }}>
            {buildToolsPrompt([{ name: previewName, description: description || '（描述）', category, dangerous, executorType, parameters: (() => { try { return JSON.parse(paramsJson); } catch { return {}; } })() }])}
          </pre>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)', borderTop: '1px solid var(--border-color)', paddingTop: 'var(--space-4)' }}>
        <button onClick={handleSave} style={{ padding: 'var(--space-2) var(--space-5)', background: 'var(--color-accent)', color: 'var(--color-text-inverse)', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', cursor: 'pointer' }}>
          {initial ? '保存修改' : '注册工具'}
        </button>
        <button onClick={onCancel} style={{ padding: 'var(--space-2) var(--space-5)', background: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
          取消
        </button>
      </div>
    </div>
  );
}

const SCHEMA_TEMPLATES = [
  { label: '空模板', value: '{\n  \n}' },
  { label: '字符串参数', value: '{\n  "type": "object",\n  "properties": {\n    "text": { "type": "string", "description": "文本内容" }\n  },\n  "required": ["text"]\n}' },
  { label: '数值参数', value: '{\n  "type": "object",\n  "properties": {\n    "count": { "type": "number", "description": "数量" }\n  },\n  "required": ["count"]\n}' },
  { label: '文件路径', value: '{\n  "type": "object",\n  "properties": {\n    "filePath": { "type": "string", "description": "文件路径" }\n  },\n  "required": ["filePath"]\n}' },
  { label: '读写混合', value: '{\n  "type": "object",\n  "properties": {\n    "filePath": { "type": "string", "description": "文件路径" },\n    "content": { "type": "string", "description": "写入内容" }\n  },\n  "required": ["filePath"]\n}' },
];

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-medium)', marginBottom: 'var(--space-1)' };
const inputStyle: React.CSSProperties = { width: '100%', padding: 'var(--space-2) var(--space-3)', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text)', fontSize: 'var(--text-sm)', fontFamily: 'inherit', boxSizing: 'border-box' };
const ghostBtnStyle: React.CSSProperties = { padding: '2px var(--space-2)', background: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', cursor: 'pointer' };
const tinyBtn: React.CSSProperties = { fontSize: 'var(--text-xs)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text-secondary)', cursor: 'pointer' };
