import { renderTextWithCode } from '../../engine/markdown';

/** Retain the Monsoon API; the shared renderer now owns full-source display paging. */
export default function BoundedMessageText({ text, id }: { text: string; id: string }) {
  return <>{renderTextWithCode(text, id)}</>;
}
