import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useLocale } from '../../../i18n/LocaleContext';
import './bulletin-entry-card.css';

export function BulletinEntryCard({ text, author, updatedAt, isNew, onChange, onRemove }: {
  text: string; author: string; updatedAt?: number; isNew: boolean;
  onChange(text: string): void; onRemove(): void;
}) {
  const { t, locale } = useLocale();
  const bodyId = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState(isNew);
  const displayedAuthor = author === '人类' ? t('cyclone.bulletin.authorHuman') : author;
  const time = updatedAt ? new Date(updatedAt) : null;
  const timestamp = time && !Number.isNaN(time.valueOf()) ? time : null;
  const local = (zh: string, en: string) => locale === 'zh-CN' ? zh : en;

  useLayoutEffect(() => {
    const element = textarea.current;
    if (!editing || !element) return;
    const fit = () => {
      const border = element.offsetHeight - element.clientHeight;
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight + border}px`;
    };
    fit();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width === element.clientWidth) return;
      width = element.clientWidth; fit();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [editing, text]);

  return <article className="cy-bulletin-card">
    <header className="cy-bulletin-card__header">
      <div className="cy-bulletin-card__meta">
        <span className="cy-bulletin-card__author" title={t('cyclone.bulletin.lastAuthor', { author: displayedAuthor })}>
          {displayedAuthor}
        </span>
        {timestamp ? <time dateTime={timestamp.toISOString()}>{timestamp.toLocaleString(locale, {
          year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        })}</time> : <span>{local('尚未保存', 'Not saved yet')}</span>}
      </div>
      <div className="cy-bulletin-card__actions">
        <button type="button" onClick={() => setEditing(value => !value)}
          aria-expanded={editing} aria-controls={bodyId}>
          {editing ? local('收起编辑', 'Close editor') : t('common.edit')}
        </button>
        <button type="button" className="cy-bulletin-card__delete" onClick={onRemove}
          title={t('cyclone.bulletin.deleteEntry')}>{t('common.delete')}</button>
      </div>
    </header>
    <div id={bodyId} className="cy-bulletin-card__body">
      {editing ? <>
        <textarea ref={textarea} autoFocus rows={1} value={text} onChange={event => onChange(event.target.value)}
          aria-label={local('公告内容', 'Bulletin content')} placeholder={t('cyclone.bulletin.placeholder')} />
        <p className="cy-bulletin-card__hint">{local('编辑后，在底部保存公告板。收起编辑会保留草稿。',
          'Save the bulletin below when finished. Closing this editor keeps your draft.')}</p>
      </> : <p className="cy-bulletin-card__text">{text || local('尚未填写内容', 'No content yet')}</p>}
    </div>
  </article>;
}
