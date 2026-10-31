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
import { createContext, useContext, useState, useCallback, useEffect, useLayoutEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from '../../i18n/LocaleContext';
import { createConfirmationController, type ConfirmationState } from './confirmation-controller';
import { confirmationCapturesKey } from './native-modal-keys';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null);

/** 在任意组件里取确认函数。未挂 Provider 时回退到 window.confirm（保底不崩）。 */
export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (ctx) return ctx;
  return async (opts: ConfirmOptions) => window.confirm(opts.message || opts.title);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmationState<ConfirmOptions> | null>(null);
  const [controller] = useState(() => createConfirmationController<ConfirmOptions>(setState));
  useEffect(() => {
    controller.activate();
    return () => controller.dispose();
  }, [controller]);
  const confirm = useCallback((options: ConfirmOptions) => controller.request(options), [controller]);
  const close = useCallback((accepted: boolean) => controller.settle(accepted), [controller]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && createPortal(<ConfirmView key={state.id} state={state} onClose={close} />, document.body)}
    </ConfirmContext.Provider>
  );
}

function ConfirmView({ state, onClose }: {
  state: ConfirmationState<ConfirmOptions>;
  onClose: (accepted: boolean) => void;
}) {
  const { t } = useLocale();
  const { options: opts, closing } = state;
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement;
    cancelRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!confirmationCapturesKey(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (closing || event.repeat) return;
      if (event.key === 'Escape') onClose(false);
      else if (event.key === 'Enter') onClose(document.activeElement === acceptRef.current);
      else {
        const buttons = [cancelRef.current, acceptRef.current];
        const index = buttons.findIndex(button => button === document.activeElement);
        buttons[index < 0 ? 0 : (index + (event.shiftKey ? -1 : 1) + 2) % 2]?.focus();
      }
    };
    // Capture before underlying dialogs handle Escape or move their own focus.
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [closing, onClose]);
  return (
    <div
      data-confirm-overlay
      className={`confirm-overlay${closing ? ' confirm-overlay--closing' : ''}`}
      onClick={event => { event.stopPropagation(); onClose(false); }}
    >
      <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId}
        aria-describedby={opts.message ? messageId : undefined} onClick={e => e.stopPropagation()}>
        <h3 id={titleId} className="confirm-title">{opts.title}</h3>
        {opts.message && <p id={messageId} className="confirm-message">{opts.message}</p>}
        <div className="confirm-actions">
          <button ref={cancelRef} type="button" disabled={closing} className="confirm-btn confirm-btn--cancel" onClick={() => onClose(false)}>
            {opts.cancelText || t('common.cancel')}
          </button>
          <button
            ref={acceptRef} type="button" disabled={closing}
            className={`confirm-btn ${opts.danger ? 'confirm-btn--danger' : 'confirm-btn--confirm'}`}
            onClick={() => onClose(true)}
          >
            {opts.confirmText || t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
