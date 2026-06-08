/**
 * markdown.tsx — 基于 react-markdown 的完整 Markdown 渲染
 *
 * 支持：粗体/斜体/删除线/标题/列表/引用/表格/链接/代码块/行内code/LaTeX数学公式
 * 三个对话窗口（季风/对流/信风/潮汐/会议室）共用此组件。
 */

import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

/** 代码块组件：深底色 + 语言标签 + 复制按钮 */
function CodeBlockRenderer({ className, children }: { className?: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const lang = className?.replace('language-', '') || 'text';
  const code = String(children ?? '').replace(/\n$/, '');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="md-code-block">
      <div className="md-code-block__header">
        <span className="md-code-block__lang">{lang}</span>
        <button className="md-code-block__copy" onClick={handleCopy} type="button">
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="md-code-block__body"><code>{code}</code></pre>
    </div>
  );
}

/** 自定义组件映射 */
const components = {
  code({ className, children, ...props }: any) {
    const isBlock = className || String(children).includes('\n');
    if (isBlock) {
      return <CodeBlockRenderer className={className}>{children}</CodeBlockRenderer>;
    }
    return <code className="md-inline-code" {...props}>{children}</code>;
  },
  a({ href, children, ...props }: any) {
    return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
  },
};

/**
 * 预处理 LaTeX 定界符：把 \( \) → $...$，\[ \] → $$...$$
 * 仅在代码块外做替换，避免误伤代码内容。
 * 同时把单独成行的 ( \frac{...} ) 这种形式也转成 $...$
 */
function normalizeLatex(text: string): string {
  // 切出代码块（围栏 ``` 和行内 `）保护起来
  const segments: { type: 'code' | 'text'; body: string }[] = [];
  const re = /```[\s\S]*?```|`[^`\n]+`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', body: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'code', body: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', body: text.slice(lastIndex) });
  }

  return segments.map(seg => {
    if (seg.type === 'code') return seg.body;
    let s = seg.body;
    // \[ ... \] → $$ ... $$
    s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, inner) => `$$${inner}$$`);
    // \( ... \) → $ ... $
    s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, inner) => `$${inner}$`);
    // 单独的 ( \frac... ) 这种 LLM 错误格式（不带反斜杠的圆括号但含 LaTeX 命令）
    s = s.replace(/(?<!\\)\(\s*(\\[a-zA-Z]+[\s\S]+?)\s*\)/g, (_, inner) => `$${inner}$`);
    return s;
  }).join('');
}

/**
 * 主入口：把字符串转成 ReactNode[]，含完整 Markdown 渲染
 * 保留旧签名兼容（keyPrefix 不再使用但不报错）
 */
export function renderTextWithCode(text: string, _keyPrefix = 'md'): ReactNode[] {
  if (!text) return [];
  const normalized = normalizeLatex(text);
  return [
    <div key={_keyPrefix} className="md-rendered">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  ];
}
