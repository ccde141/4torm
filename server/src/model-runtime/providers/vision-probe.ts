import { randomInt } from 'node:crypto';
import { isRecord } from '../config/provider-config-error.js';

const COLORS = [
  ['RED', 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAANklEQVRIie3WuQkAQAwDwem/aV0VhgsWnAuMnjVOTwJ6kVy0gqaqWG2qwVmTKaoQeAkdfU3XDzLD/C7nwdQVAAAAAElFTkSuQmCC'],
  ['GREEN', 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAANklEQVRIie3WuQkAQAwDwSldpV8VhgsWnAuMnmVuTwJ6kVy0gqaqWG2qwVmTKaoQeAkd/UzXD8IAAB+llsiaAAAAAElFTkSuQmCC'],
  ['BLUE', 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAANklEQVRIie3WuQkAQAwDwem/aV0VhgsWnAuMnsWOTwJ6kVy0gqaqWG2qwVmTKaoQeAkdfUzXDzpL/C66vH+aAAAAAElFTkSuQmCC'],
] as const;

export interface VisionProbe {
  image: string;
  expected: string;
  prompt: string;
}

/** The expected answer is carried only in the image, never in its name or the question. */
export function createVisionProbe(): VisionProbe {
  const [expected, image] = COLORS[randomInt(COLORS.length)];
  return { image, expected,
    prompt: 'Identify the dominant color in this image. Reply with exactly one word: RED, GREEN, or BLUE.' };
}

export function matchesVisionProbe(value: Record<string, unknown>, probe: VisionProbe): boolean {
  const choices = Array.isArray(value.choices) ? value.choices : [];
  const first = isRecord(choices[0]) ? choices[0] : undefined;
  const message = first && isRecord(first.message) ? first.message : undefined;
  const content = message?.content ?? value.content;
  const text = typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter(isRecord).filter(block => block.type === 'text')
      .map(block => typeof block.text === 'string' ? block.text : '').join('') : '';
  return text.trim().replace(/[.!。]$/, '').toUpperCase() === probe.expected;
}
