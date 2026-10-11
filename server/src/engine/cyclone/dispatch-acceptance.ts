/** 派发创建时只确认已落盘；目标工位是否接收、执行或完成由派发状态另行报告。 */
export function dispatchAcceptance(
  targetSeatTitle: string,
  dispatchId: string,
  place: 'room' | 'seat',
): string {
  const next = place === 'room' ? '讨论' : '工作';
  return `异步任务已登记，目标工位「${targetSeatTitle}」，任务 ID：${dispatchId}。无需等待，请继续当前${next}。`;
}
