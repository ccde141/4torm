type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
}

/** Move the former exclusive video background into the independent texture layer. */
export function migrateSkinVideoConfig(value: unknown): unknown {
  const config = record(value);
  if (!config) return value;
  const background = record(config.background);
  if (!background || !('video' in background) && background.type !== 'video') return value;
  const texture = record(config.texture) ?? {};
  const layers = Array.isArray(texture.layers) ? [...texture.layers] : [];
  if (background.type === 'video' && !layers.includes('video')) layers.push('video');
  const { video, ...nextBackground } = background;
  if (nextBackground.type === 'video') nextBackground.type = 'none';
  return { ...config, texture: { ...texture, layers, video: texture.video ?? video }, background: nextBackground };
}
