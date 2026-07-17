export function scheduleAutoSave(
  save: () => Promise<void>,
  onSaved: () => void,
  onError: (error: unknown) => void,
  intervalMs = 5 * 60 * 1000,
): () => void {
  const timer = setInterval(() => {
    save().then(onSaved).catch(onError);
  }, intervalMs);
  return () => clearInterval(timer);
}
