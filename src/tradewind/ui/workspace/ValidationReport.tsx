import type { WorkflowValidation } from './validation-client';
import { useLocale } from '../../../i18n/LocaleContext';

export function ValidationReport({ result, onLocate }: {
  result: WorkflowValidation | null; onLocate: (nodeId?: string, edgeId?: string) => void;
}) {
  const { locale } = useLocale();
  if (!result || result.valid) return null;
  return <div className="tw-validation" role="alert">
    <strong>{locale === 'zh-CN' ? '请先完成这些连接与设置' : 'Check these connections and settings'}</strong>
    <ul>{result.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>
      {issue.nodeId || issue.edgeId ? <button type="button" onClick={() => onLocate(issue.nodeId, issue.edgeId)}>
        {issue.message}</button> : <span>{issue.message}</span>}
      <small>{issue.code}</small>
    </li>)}</ul>
  </div>;
}
