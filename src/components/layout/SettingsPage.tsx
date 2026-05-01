import { useState, useEffect } from 'react';
import {
  getProviders,
  addProvider,
  updateProvider,
  removeProvider,
  getAllModels,
  listModels,
  PROVIDER_PRESETS,
} from '../../llm';
import type { ProviderEntry } from '../../llm';

export default function SettingsPage() {
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [allModels, setAllModels] = useState<{ key: string; label: string }[]>([]);
  const [showPresets, setShowPresets] = useState(false);

  useEffect(() => {
    getProviders().then(setProviders);
    getAllModels().then(setAllModels);
  }, []);

  const refresh = () => {
    getProviders().then(setProviders);
    getAllModels().then(setAllModels);
  };

  const handleQuickAdd = async (baseUrl: string, label: string) => {
    await addProvider(label, baseUrl, '');
    setShowPresets(false);
    refresh();
  };

  const handleAdd = async () => {
    await addProvider('新提供商', '', '');
    refresh();
  };

  const handleRemove = async (id: string) => {
    await removeProvider(id);
    refresh();
  };

  const handleChange = async (id: string, field: keyof ProviderEntry, value: string) => {
    await updateProvider(id, { [field]: value });
    refresh();
  };

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: '720px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)', margin: '0 0 var(--space-1) 0' }}>LLM 提供商设置</h2>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', margin: 0 }}>添加多个提供商，模型自动同步到对话页面的选择清单</p>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', margin: 'var(--space-1) 0 0 0' }}>
            预设均为 OpenAI 兼容服务。使用 Anthropic 等非 OpenAI API，可部署 <a href="https://github.com/songquanpeng/one-api" target="_blank" style={{color: 'var(--color-accent)'}}>one-api</a> 或 <a href="https://github.com/BerriAI/litellm" target="_blank" style={{color: 'var(--color-accent)'}}>LiteLLM</a> 作为翻译层，填入其地址即可
          </p>
        </div>
        <div style={{ position: 'relative' }}>
          <button onClick={() => setShowPresets(!showPresets)} style={{ padding: 'var(--space-2) var(--space-4)', background: 'var(--color-accent)', color: 'var(--color-text-inverse)', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', cursor: 'pointer' }}>
            + 添加提供商 {showPresets ? '▲' : '▼'}
          </button>
          {showPresets && (
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', background: 'var(--color-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: 'var(--space-1)', zIndex: 10, minWidth: '200px', boxShadow: 'var(--shadow-md)' }}>
              {PROVIDER_PRESETS.map(p => (
                <button key={p.label} onClick={() => handleQuickAdd(p.baseUrl, p.label)} style={{ display: 'block', width: '100%', padding: 'var(--space-2) var(--space-3)', background: 'transparent', border: 'none', color: 'var(--color-text)', fontSize: 'var(--text-sm)', cursor: 'pointer', textAlign: 'left', borderRadius: 'var(--radius-sm)' }}
                  onMouseEnter={e => (e.target as HTMLElement).style.background = 'var(--color-bg-hover)'}
                  onMouseLeave={e => (e.target as HTMLElement).style.background = 'transparent'}
                >{p.label}</button>
              ))}
              <div style={{ borderTop: '1px solid var(--border-color)', margin: 'var(--space-1) 0' }} />
              <button onClick={handleAdd} style={{ display: 'block', width: '100%', padding: 'var(--space-2) var(--space-3)', background: 'transparent', border: 'none', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)', cursor: 'pointer', textAlign: 'left', borderRadius: 'var(--radius-sm)' }}
                onMouseEnter={e => (e.target as HTMLElement).style.background = 'var(--color-bg-hover)'}
                onMouseLeave={e => (e.target as HTMLElement).style.background = 'transparent'}
              >自定义（空白）</button>
            </div>
          )}
        </div>
      </div>

      {providers.length === 0 && (
        <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)' }}>还没有配置提供商，点击「添加提供商」开始</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {providers.map(p => (
          <ProviderCard key={p.id} provider={p} onChange={handleChange} onRemove={handleRemove} onRefresh={refresh} />
        ))}
      </div>

      {allModels.length > 0 && (
        <div style={{ marginTop: 'var(--space-6)', padding: 'var(--space-4)', background: 'var(--color-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-2)' }}>已注册模型清单（{allModels.length}）</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
            {allModels.map(m => (<span key={m.key} style={tagStyle}>{m.label}</span>))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderCard({ provider: p, onChange, onRemove, onRefresh }: {
  provider: ProviderEntry;
  onChange: (id: string, field: keyof ProviderEntry, value: string) => void;
  onRemove: (id: string) => void;
  onRefresh: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [headersJson, setHeadersJson] = useState(p.customHeaders ? JSON.stringify(p.customHeaders, null, 2) : '');

  const handleTest = async () => {
    if (!p.baseUrl) return;
    setTesting(true);
    try {
      const res = await listModels({ baseUrl: p.baseUrl, apiKey: p.apiKey });
      const ids = res.data.map(m => m.id);
      setFetchedModels(ids);
      setChecked(new Set(ids));
    } catch {
      setFetchedModels([]);
      setChecked(new Set());
    } finally {
      setTesting(false);
    }
  };

  const handleConfirmModels = async () => {
    await updateProvider(p.id, { models: [...checked] });
    setFetchedModels([]);
    onRefresh();
  };

  const handleToggleModel = (modelId: string) => {
    const next = new Set(checked);
    if (next.has(modelId)) next.delete(modelId);
    else next.add(modelId);
    setChecked(next);
  };

  const hasChange = fetchedModels.length > 0 && (p.models.length !== checked.size || !p.models.every(m => checked.has(m)));

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            type="text"
            value={p.label}
            onChange={e => onChange(p.id, 'label', e.target.value)}
            placeholder="未命名提供商"
            style={{ ...inputStyle, fontSize: 'var(--text-base)', fontWeight: 'var(--font-semibold)', border: '1px solid transparent', background: 'transparent', padding: '2px var(--space-1)', width: 'auto', minWidth: '120px' }}
            onFocus={e => { e.target.style.border = '1px solid var(--border-color)'; e.target.style.background = 'var(--color-bg)'; }}
            onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
          />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginLeft: 'var(--space-1)' }}>点击名称可编辑</span>
        </div>
        <button onClick={() => onRemove(p.id)} style={removeBtnStyle}>删除</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div>
          <label style={fieldLabel}>API 地址</label>
          <input type="text" value={p.baseUrl} onChange={e => onChange(p.id, 'baseUrl', e.target.value)} style={inputStyle} placeholder="http://localhost:1234/v1" />
        </div>
        <div>
          <label style={fieldLabel}>API Key</label>
          <input type="password" value={p.apiKey} onChange={e => onChange(p.id, 'apiKey', e.target.value)} style={inputStyle} placeholder="无需 key 则留空" />
        </div>
      </div>

      <div style={{ marginTop: 'var(--space-2)' }}>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{ background: 'none', border: 'none', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)', cursor: 'pointer', padding: 0 }}
        >
          {showAdvanced ? '▲' : '▶'} 高级选项
        </button>
      </div>
      {showAdvanced && (
        <div style={{ marginTop: 'var(--space-2)' }}>
          <label style={fieldLabel}>自定义请求头 <span style={{ fontWeight: 'var(--font-normal)', color: 'var(--color-text-tertiary)' }}>— JSON 格式，非标 API 需要</span></label>
          <textarea
            value={headersJson}
            onChange={e => { setHeadersJson(e.target.value); try { const h = JSON.parse(e.target.value); updateProvider(p.id, { customHeaders: h }); } catch { /* invalid JSON, don't save */ } }}
            rows={3}
            style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', resize: 'vertical' }}
            placeholder='{"x-api-key": "sk-xxx"}'
          />
        </div>
      )}

      {fetchedModels.length > 0 ? (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <span style={{ ...fieldLabel, marginBottom: 0 }}>选择要启用的模型（{checked.size}/{fetchedModels.length}）</span>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button onClick={() => setChecked(new Set(fetchedModels))} style={tinyBtnStyle}>全选</button>
              <button onClick={() => setChecked(new Set())} style={tinyBtnStyle}>清空</button>
              <button onClick={handleConfirmModels} style={{ ...tinyBtnStyle, background: hasChange ? 'var(--color-accent)' : 'var(--color-surface)', color: hasChange ? 'var(--color-text-inverse)' : 'var(--color-text-tertiary)', border: `1px solid ${hasChange ? 'var(--color-accent)' : 'var(--border-color)'}` }}>确认选择</button>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {fetchedModels.map(m => {
              const sel = checked.has(m);
              return (
                <button key={m} onClick={() => handleToggleModel(m)} style={{ ...modelTagStyle, background: sel ? 'var(--color-accent)' : 'var(--color-bg)', color: sel ? 'var(--color-text-inverse)' : 'var(--color-text)', border: `1px solid ${sel ? 'var(--color-accent)' : 'var(--border-color)'}`, cursor: 'pointer' }}>
                  {sel ? '✓ ' : ''}{m}
                </button>
              );
            })}
          </div>
        </div>
      ) : p.models.length > 0 ? (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <div style={{ ...fieldLabel, marginBottom: 'var(--space-1)' }}>已启用模型（{p.models.length}）</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {p.models.map(m => (<span key={m} style={modelTagStyle}>{m}</span>))}
          </div>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
        <button onClick={handleTest} disabled={testing} style={{ ...smallBtnStyle, background: 'var(--color-surface)', border: '1px solid var(--border-color)', color: testing ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)' }}>
          {testing ? '测试中...' : fetchedModels.length > 0 ? '重新获取模型列表' : '测试连接并获取模型'}
        </button>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = { padding: 'var(--space-4)', background: 'var(--color-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' };
const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 'var(--text-xs)', fontWeight: 'var(--font-medium)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-1)' };
const inputStyle: React.CSSProperties = { width: '100%', padding: 'var(--space-1) var(--space-2)', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text)', fontSize: 'var(--text-sm)', fontFamily: 'inherit', boxSizing: 'border-box' };
const removeBtnStyle: React.CSSProperties = { padding: 'var(--space-1) var(--space-2)', background: 'transparent', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', cursor: 'pointer', flexShrink: 0 };
const smallBtnStyle: React.CSSProperties = { padding: 'var(--space-1) var(--space-3)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', fontWeight: 'var(--font-medium)', cursor: 'pointer' };
const tinyBtnStyle: React.CSSProperties = { padding: '0 var(--space-2)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', border: '1px solid var(--border-color)', background: 'var(--color-bg)', color: 'var(--color-text-secondary)', cursor: 'pointer', lineHeight: '22px' };
const tagStyle: React.CSSProperties = { padding: 'var(--space-1) var(--space-2)', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' };
const modelTagStyle: React.CSSProperties = { padding: '1px 6px', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', color: 'var(--color-text)', fontFamily: 'var(--font-mono)' };
