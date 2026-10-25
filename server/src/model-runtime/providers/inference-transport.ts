import { getGlobalDispatcher, type Dispatcher } from 'undici';

// The model-response wait owns inactivity. Undici's default header/body timers
// must not cut off long prefill or a model's silent reasoning first.
export const inferenceDispatcher: Pick<Dispatcher, 'dispatch'> = {
  dispatch(options, handler) {
    return getGlobalDispatcher().dispatch({ ...options, headersTimeout: 0, bodyTimeout: 0 }, handler);
  },
};
