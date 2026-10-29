import { memberStatus, type TeamSnapshot } from './types';
import type { en } from './messages';
export function TeamPreviewGraph({ data, busy, mainName, w, open }: {
  data: TeamSnapshot; busy: boolean; mainName: string; w: typeof en; open: (id?: string) => void;
}) {
  return <div className="team-preview-graph">
    <button className="team-preview-root" onClick={() => open()}>
      <small>{w.main}</small><strong>{mainName}</strong><small>{busy ? w.running : w.idle}</small>
    </button>
    <div className="team-preview-members">
      {data.members.filter(member => member.lifecycle === 'active').map(member => {
        const report = member.run?.status === 'running' ? undefined : data.reports.findLast(item => item.memberId === member.id && item.runId === member.run?.id);
        return <div className={`team-preview-branch ${member.run?.status === 'running' ? 'is-active' : ''}`} key={member.id}>
          <button className="team-summary-member" onClick={() => open(member.id)}>
            <span><strong>{member.name}</strong><small>{w[memberStatus(member, data.reports)]}</small></span>
            <p>{member.run?.task || member.mission}</p>
            {report && <div className="team-preview-report"><small>{report.review ? w.review : report.acknowledged ? w.unreviewed : w.pending}</small><p>{report.review?.reason || report.content}</p></div>}
          </button>
        </div>;
      })}
    </div>
  </div>;
}
