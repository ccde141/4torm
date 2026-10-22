import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useWorkspaceCopy } from './workspace-copy';
import { useLocale } from '../../../i18n/LocaleContext';

export function WorkflowModeHelp() {
  const { copy } = useWorkspaceCopy();
  const { t } = useLocale();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 16 });

  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const bounds = panel.current.getBoundingClientRect();
    setPosition({
      left: Math.max(16, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 16)),
      top: Math.max(16, Math.min(anchor.bottom + 10, window.innerHeight - bounds.height - 16)),
    });
    panel.current.querySelector('button')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    const resize = () => setOpen(false);
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', resize);
    };
  }, [open]);

  return <>
    <button ref={trigger} type="button" className="tw-mode-help__trigger" aria-label={copy.help}
      title={copy.help} aria-expanded={open} aria-controls={id} aria-haspopup="dialog"
      onClick={() => setOpen(value => !value)}>?</button>
    {open && createPortal(
      <section ref={panel} id={id} className="tw-mode-help" role="dialog"
        aria-labelledby={`${id}-title`} style={position}>
        <header><h3 id={`${id}-title`}>{copy.helpTitle}</h3>
          <button type="button" aria-label={copy.closeHelp}
            onClick={() => { setOpen(false); trigger.current?.focus(); }}>×</button></header>
        <div><h4><i className="tw-mode-mark" />{copy.strict}</h4>
          <p>{copy.strictHelp}</p><small>{copy.strictUse}</small></div>
        <div><h4><i className="tw-mode-mark tw-mode-mark--handoff" />{copy.handoff}</h4>
          <p>{copy.handoffHelp}</p><small>{copy.handoffUse}</small></div>
        <div><h4>{copy.execution}</h4>
          <p><strong>{t('tradewind.toolbar.manualRun')}</strong> · {copy.interactiveHelp}</p>
          <p><strong>{t('tradewind.toolbar.autoRun')}</strong> · {copy.unattendedHelp}</p>
          <small>{copy.runUse}</small></div>
        <footer>{copy.contactHelp}</footer>
      </section>, document.body,
    )}
  </>;
}
