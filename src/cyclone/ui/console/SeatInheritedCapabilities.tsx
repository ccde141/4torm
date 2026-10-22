import type { ConsoleSeat } from './workshop-console-model';
import { ConsoleIcon } from './ConsoleIcon';
import { useConsoleText } from './console-text';

export function SeatInheritedCapabilities({ seat }: { seat: ConsoleSeat }) {
  const text = useConsoleText();
  const inherited = seat.capabilities;
  return <div><div className="cy-seat-intro"><h3>{text('绑定 Agent 的模型与能力', 'Bound Agent model and capabilities')}</h3></div>
    <div className="cy-seat-capability-source"><ConsoleIcon name="inherited" /><div><strong>{inherited.agentName || seat.agentId}</strong>
      <small>{inherited.model || text('未配置模型', 'No model configured')}</small></div></div>
    {!inherited.available && <p role="alert" className="cy-console-error">{text('绑定 Agent 不可用，请检查工位配置。', 'The bound Agent is unavailable. Check the seat configuration.')}</p>}
    <CapabilityList title={text('继承工具', 'Inherited tools')} empty={text('没有可用的继承工具', 'No inherited tools available')}
      entries={inherited.tools} />
    <CapabilityList title={text('继承技能', 'Inherited skills')} empty={text('没有启用的技能', 'No enabled skills')}
      entries={inherited.skills} />
  </div>;
}

function CapabilityList({ title, entries, empty }: { title: string; empty: string; entries: Array<{ name: string; description: string }> }) {
  return <section className="cy-seat-section"><h4>{title}<span className="cy-console-muted">{entries.length}</span></h4>
    <div className="cy-seat-capabilities">{entries.map((entry, index) => <div key={`${entry.name}:${index}`}><ConsoleIcon name="config" />
      <div><strong>{entry.name}</strong><p>{entry.description}</p></div></div>)}</div>
    {!entries.length && <p className="cy-console-muted">{empty}</p>}
  </section>;
}
