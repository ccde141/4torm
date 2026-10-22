import type { ReactNode } from 'react';
import MarkdownText from './text-display/MarkdownText';
import 'katex/dist/katex.min.css';

/** All feature islands keep their existing renderer API and share one display resource budget. */
export function renderTextWithCode(text: string, keyPrefix = 'md'): ReactNode[] {
  if (!text) return [];
  return [<MarkdownText key={keyPrefix} text={text} id={keyPrefix} />];
}
