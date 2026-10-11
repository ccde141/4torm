import {
  generateSessionTitle, type TitleInput,
} from '../../../engine/conversation/session-title.js';

export type MonsoonTitleGenerator = (input: TitleInput) => Promise<string>;

export function createMonsoonTitleGenerator(dataDir: string): MonsoonTitleGenerator {
  return input => generateSessionTitle(dataDir, input);
}
