
/** An observation, not a question: this card never suspends an Agent. */
export function CompactionNotice({ message }: { message: string }) {
  if (!message) return null;
  return <div className="compaction-notice" role="status">{message}</div>;
}
