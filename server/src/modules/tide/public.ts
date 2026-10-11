export {
  createTideFeature,
  createTideFeatureModule,
  type TideFeature,
  type TideFeatureOptions,
} from './api/factory.js';
export { TIDE_META } from './domain/meta.js';

export async function recoverTideRunStates(dataDir: string): Promise<number> {
  const { FileTideRunStateRepository } = await import('./infrastructure/run-state-repository.js');
  return new FileTideRunStateRepository(dataDir).recoverCrashed();
}
