import { CompactionHistory } from '../../components/common/CompactionHistory';

export function CompactedHistory({ content, handoff = false }: { content: string; handoff?: boolean }) {
  return <CompactionHistory content={content} handoff={handoff} />;
}
