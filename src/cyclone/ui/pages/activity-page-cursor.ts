/** Advance only through events actually returned by a bounded activity page. */
export function nextActivityCursor(page: {
  latestSeq: number;
  events: Array<{ seq: number }>;
}): number {
  return page.events.at(-1)?.seq ?? page.latestSeq;
}
