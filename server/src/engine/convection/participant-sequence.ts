interface ParticipantSequenceOptions<T> {
  participantIds: readonly string[];
  signal?: AbortSignal;
  execute(id: string): Promise<T>;
  commit(id: string, result: T): Promise<void>;
  reportFailure(id: string, error: unknown): Promise<void>;
}

export async function runParticipantSequence<T>(
  options: ParticipantSequenceOptions<T>,
): Promise<void> {
  for (const id of options.participantIds) {
    if (options.signal?.aborted) break;
    let result: T;
    try {
      result = await options.execute(id);
    } catch (error) {
      if (options.signal?.aborted) break;
      await options.reportFailure(id, error);
      continue;
    }
    await options.commit(id, result);
  }
}
