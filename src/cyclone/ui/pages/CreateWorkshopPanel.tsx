import { useId, useRef, useState } from 'react';
import type { Agent } from '../../../types';
import { useLocale } from '../../../i18n/LocaleContext';
import { ConsoleIcon } from '../console/ConsoleIcon';
import type { CycloneEntityReceipt } from './cyclone-control-client';
import { prepareWorkshopCreation } from './workshop-creation';
import './create-workshop.css';

export default function CreateWorkshopPanel({ agents, onCreated, onCancel }: {
  agents: Agent[];
  onCreated: (workshop: CycloneEntityReceipt) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const id = useId();
  const [title, setTitle] = useState(() => t('cyclone.workshop.defaultTitle'));
  const [chairAgentId, setChairAgentId] = useState('');
  const [supervisorAgentId, setSupervisorAgentId] = useState('');
  const [rolePrompt, setRolePrompt] = useState('');
  const [createdWorkshop, setCreatedWorkshop] = useState<CycloneEntityReceipt>();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);

  async function submit(skipSupervisor = false) {
    if (submitting.current) return;
    submitting.current = true;
    setCreating(true); setError('');
    try {
      const result = await prepareWorkshopCreation({
        title: title.trim() || t('cyclone.workshop.defaultTitle'), chairAgentId: chairAgentId || undefined,
        supervisorAgentId: skipSupervisor ? undefined : supervisorAgentId || undefined,
        supervisorRolePrompt: rolePrompt,
      }, createdWorkshop);
      setCreatedWorkshop(result.workshop);
      if (result.supervisorError) setError(result.supervisorError);
      else await onCreated(result.workshop);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { submitting.current = false; setCreating(false); }
  }

  return <section className="cyclone-create" aria-labelledby={`${id}-heading`}>
    <form className="cyclone-create__form" aria-busy={creating}
      onSubmit={event => { event.preventDefault(); void submit(); }}>
      <header className="cyclone-create__heading">
        <span className="cyclone-create__symbol"><ConsoleIcon name="folder" /></span>
        <div><h2 id={`${id}-heading`}>{t('cyclone.workshop.createTitle')}</h2>
          <p>{t('cyclone.workshop.createDescription')}</p></div>
      </header>

      <div className="cyclone-create__name">
        <label htmlFor={`${id}-name`}>{t('cyclone.workshop.name')}</label>
        <input id={`${id}-name`} autoFocus value={title} disabled={creating || !!createdWorkshop}
          onChange={event => setTitle(event.target.value)} />
      </div>

      <div className="cyclone-create__section-heading"><h3>{t('cyclone.workshop.roles')}</h3>
        <span>{t('cyclone.workshop.rolesOptional')}</span></div>
      <div className="cyclone-create__roles">
        <section className="cyclone-create__role" data-selected={!!supervisorAgentId}
          aria-labelledby={`${id}-supervisor-title`}>
          <div className="cyclone-create__role-heading"><span className="cyclone-create__role-icon"><ConsoleIcon name="collaboration" /></span>
            <h3 id={`${id}-supervisor-title`}>{t('cyclone.workshop.supervisorTitle')}</h3>
            <span className="cyclone-create__scope">{t('cyclone.workshop.supervisorScope')}</span></div>
          <p id={`${id}-supervisor-hint`}>{t('cyclone.workshop.supervisorHint')}</p>
          <label htmlFor={`${id}-supervisor`}>{t('cyclone.workshop.supervisorLabel')}</label>
          <select id={`${id}-supervisor`} value={supervisorAgentId} disabled={creating}
            aria-describedby={`${id}-supervisor-hint`} onChange={event => setSupervisorAgentId(event.target.value)}>
            <option value="">{t('cyclone.workshop.noSupervisor')}</option>
            {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>)}
          </select>
          {supervisorAgentId && <details className="cyclone-create__prompt">
            <summary>{t('cyclone.workshop.supervisorPrompt')}</summary>
            <textarea aria-label={t('cyclone.workshop.supervisorPrompt')} value={rolePrompt} rows={3}
              maxLength={20_000} disabled={creating} placeholder={t('cyclone.workshop.supervisorPromptPlaceholder')}
              onChange={event => setRolePrompt(event.target.value)} />
          </details>}
        </section>

        <section className="cyclone-create__role" data-selected={!!chairAgentId}
          aria-labelledby={`${id}-chair-title`}>
          <div className="cyclone-create__role-heading"><span className="cyclone-create__role-icon"><ConsoleIcon name="chat" /></span>
            <h3 id={`${id}-chair-title`}>{t('cyclone.workshop.chairTitle')}</h3>
            <span className="cyclone-create__scope">{t('cyclone.workshop.chairScope')}</span></div>
          <p id={`${id}-chair-hint`}>{t('cyclone.workshop.chairHint')}</p>
          <label htmlFor={`${id}-chair`}>{t('cyclone.workshop.chairLabel')}</label>
          <select id={`${id}-chair`} value={chairAgentId} disabled={creating || !!createdWorkshop}
            aria-describedby={`${id}-chair-hint`} onChange={event => setChairAgentId(event.target.value)}>
            <option value="">{t('cyclone.workshop.noChair')}</option>
            {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>)}
          </select>
        </section>
      </div>
      <p className="cyclone-create__role-note">{t('cyclone.workshop.roleBindings')}</p>

      {error && <div role="alert" className="cyclone-create__error">
        {createdWorkshop && <strong>{t('cyclone.workshop.supervisorSetupFailed')}</strong>}
        <p>{error}</p>
        {createdWorkshop && <p>{t('cyclone.workshop.supervisorRetryHint')}</p>}
      </div>}
      <footer className="cyclone-create__actions">
        <button type="button" className="secondary-action-btn" disabled={creating}
          onClick={() => createdWorkshop ? void submit(true) : onCancel()}>
          {createdWorkshop ? t('cyclone.workshop.configureLater') : t('common.cancel')}</button>
        <button type="submit" className="primary-cta-btn" disabled={creating}>
          {creating ? t('cyclone.workshop.creating')
            : createdWorkshop ? t('cyclone.workshop.retrySupervisor') : t('cyclone.workshop.create')}</button>
      </footer>
    </form>
  </section>;
}
