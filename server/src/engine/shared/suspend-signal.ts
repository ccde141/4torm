export class SuspendSignal extends Error {
  readonly question: string;
  readonly options?: string[];

  constructor(question: string, options?: string[]) {
    super('__suspend__');
    this.name = 'SuspendSignal';
    this.question = question;
    this.options = options;
  }
}
