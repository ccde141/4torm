/**
 * 应用内确认弹窗 —— 替换 window.confirm。
 *
 * 背景：Electron（contextIsolation）下原生 confirm 关闭后渲染进程丢焦点，
 * 表现为"点不动、输不了，切页面才恢复"。故全域改用此 promise 化弹窗。
 *
 * 用法：
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: '删除此消息？', danger: true }))) return;
 */
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import '../../styles/components/confirm-dialog.css';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

type Resolver = (ok: boolean) => void;

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null);

/** 在任意组件里取确认函数。未挂 Provider 时回退到 window.confirm（保底不崩）。 */
export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (ctx) return ctx;
  return async (opts: ConfirmOptions) => window.confirm(opts.message || opts.title);
}

interface DialogState {
  opts: ConfirmOptions;
  resolve: Resolver;
  closing: boolean;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>(resolve => {
      setState({ opts, resolve, closing: false });
    });
  }, []);

  // 关闭：先播退场动画，再结算 promise + 卸载
  const close = useCallback((ok: boolean) => {
    setState(prev => {
      if (!prev) return null;
      prev.resolve(ok);
      return { ...prev, closing: true };
    });
    window.setTimeout(() => setState(null), 160);
  }, []);

  // Esc 取消 / Enter 确认（弹窗打开时才挂）。
  // 关键：打开弹窗的那次按键（如 slash 指令 /reset + 回车）常常还按着，其 repeat keydown
  // 会瞬间被这里的 Enter 分支「确认」掉 → 弹窗一帧闪现即消失。故要求 Enter 必须先「抬起」
  // 过一次才认（ready 门闩），并忽略 e.repeat。
  useEffect(() => {
    if (!state || state.closing) return;
    let ready = false;
    const onUp = (e: KeyboardEvent) => { if (e.key === 'Enter') ready = true; };
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      else if (e.key === 'Enter') {
        if (!ready) return;   // 开窗那次回车未抬起前不认，杜绝「开即关」
        e.preventDefault(); close(true);
      }
    };
    window.addEventListener('keyup', onUp);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keyup', onUp); window.removeEventListener('keydown', onKey); };
  }, [state, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && createPortal(<ConfirmView state={state} onClose={close} />, document.body)}
    </ConfirmContext.Provider>
  );
}

function ConfirmView({ state, onClose }: { state: DialogState; onClose: (ok: boolean) => void }) {
  const { opts, closing } = state;
  return (
    <div
      className={`confirm-overlay${closing ? ' confirm-overlay--closing' : ''}`}
      onClick={() => onClose(false)}
    >
      <div className="confirm-dialog" role="alertdialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <h3 className="confirm-title">{opts.title}</h3>
        {opts.message && <p className="confirm-message">{opts.message}</p>}
        <div className="confirm-actions">
          <button className="confirm-btn confirm-btn--cancel" onClick={() => onClose(false)}>
            {opts.cancelText || '取消'}
          </button>
          <button
            className={`confirm-btn ${opts.danger ? 'confirm-btn--danger' : 'confirm-btn--confirm'}`}
            onClick={() => onClose(true)}
          >
            {opts.confirmText || '确定'}
          </button>
        </div>
      </div>
    </div>
  );
}
