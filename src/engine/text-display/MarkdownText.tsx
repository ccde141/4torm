import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import BoundedText from './BoundedText';
import { mayRenderMarkdown } from './markdown-budget';

function CodeBlockRenderer({ className, children }: { className?: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const lang = className?.replace('language-', '') || 'text';
  const code = String(children ?? '').replace(/\n$/, '');
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* Clipboard rejection does not change the displayed source. */ }
  };
  return <div className="md-code-block">
    <div className="md-code-block__header">
      <span className="md-code-block__lang">{lang}</span>
      <button className="md-code-block__copy" onClick={handleCopy} type="button">
        {copied ? '已复制' : '复制'}
      </button>
    </div>
    <pre className="md-code-block__body"><code>{code}</code></pre>
  </div>;
}

const components = {
  code({ className, children, ...props }: any) {
    const isBlock = className || String(children).includes('\n');
    return isBlock ? <CodeBlockRenderer className={className}>{children}</CodeBlockRenderer>
      : <code className="md-inline-code" {...props}>{children}</code>;
  },
  a({ href, children, ...props }: any) {
    return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
  },
};
const mathOptions = { maxExpand: 100, maxSize: 20, trust: false };

/** Preserve the existing delimiter conversion after the resource budget has accepted the source. */
function normalizeLatex(text: string): string {
  const segments: { type: 'code' | 'text'; body: string }[] = [];
  const re = /```[\s\S]*?```|`[^`\n]+`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) segments.push({ type: 'text', body: text.slice(lastIndex, match.index) });
    segments.push({ type: 'code', body: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ type: 'text', body: text.slice(lastIndex) });
  return segments.map(segment => {
    if (segment.type === 'code') return segment.body;
    return segment.body.replace(/\\\[([\s\S]+?)\\\]/g, (_, inner) => `$$${inner}$$`)
      .replace(/\\\(([\s\S]+?)\\\)/g, (_, inner) => `$${inner}$`)
      .replace(/(?<!\\)\(\s*(\\[a-zA-Z]+[\s\S]+?)\s*\)/g, (_, inner) => `$${inner}$`);
  }).join('');
}

/** Shared by every feature island; large/expanding markup falls back to navigable original text. */
export default function MarkdownText({ text, id }: { text: string; id: string }) {
  if (!mayRenderMarkdown(text)) return <BoundedText text={text} id={id} />;
  return <div className="md-rendered"><ReactMarkdown
    remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, mathOptions]]} components={components}
  >{normalizeLatex(text)}</ReactMarkdown></div>;
}
