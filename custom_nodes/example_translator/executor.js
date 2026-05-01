export default async function execute(envelope, config, ctx) {
  const { target_language = 'en', tone = '正式' } = config || {};
  const input = envelope.input || '';

  ctx.log(`翻译节点收到输入 (${input.length} 字符)，目标语言: ${target_language}, 语气: ${tone}`);

  let result;
  if (ctx.callAI) {
    const prompt = `请将以下内容翻译为${target_language}，语气：${tone}。只返回翻译结果，不要附加说明。`;
    result = await ctx.callAI(prompt + '\n\n' + input);
  } else {
    // Fallback: passthrough with prefix
    result = `[翻译到 ${target_language}] ${input}`;
  }

  return {
    ...envelope,
    input: result,
    context: input,
    meta: { ...envelope.meta, nodeId: envelope.meta.nodeId },
  };
}
