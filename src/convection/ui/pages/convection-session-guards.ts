export function shouldLoadConvectionSession(
  sessionId: string,
  activeId: string | null,
  loadingId: string | null,
): boolean {
  return Boolean(sessionId) && sessionId !== activeId && sessionId !== loadingId;
}
