/**
 * 原生思考流展示块（可折叠）
 *
 * 显示模型的原生 reasoning 通道（reasoning_content/reasoning/thinking），
 * 与正文物理分开。无原生思考的模型 reasoningContent 为空 → 不渲染。
 *
 * 流式期间默认展开（让用户看到"它在想"）；落定后默认折叠（不喧宾夺主）。
 */

import { useState } from 'react';

interface Props {
  reasoning: string;
  /** 是否正在流式输出（决定光标 + 默认展开态） */
  isStreaming: boolean;
  /**
   * 覆盖默认展开态。不传时：流式默认展开、落定默认折叠（对话/工位用）。
   * 群聊传 false，即便流式也默认折叠，避免多 agent 思考刷屏。
   */
  defaultOpen?: boolean;
}

export default function ReasoningBlock({ reasoning, isStreaming, defaultOpen }: Props) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  if (!reasoning) return null;

  // 默认态：显式 defaultOpen 优先，否则流式展开/落定折叠。用户手动点过以手动为准。
  const open = manualOpen ?? defaultOpen ?? isStreaming;

  return (
    <div className={`reasoning-block${open ? ' reasoning-block--open' : ''}`}>
      <button
        className="reasoning-block__header"
        onClick={() => setManualOpen(!open)}
        aria-expanded={open}
      >
        <span className="reasoning-block__arrow">{open ? '▼' : '▶'}</span>
        <span className="reasoning-block__label">
          {isStreaming ? '思考中' : '思考过程'}
        </span>
        {isStreaming && <span className="reasoning-block__spinner" />}
      </button>
      {open && (
        <div className="reasoning-block__body">
          {reasoning}
          {isStreaming && <span className="thinking-cursor" />}
        </div>
      )}
    </div>
  );
}
