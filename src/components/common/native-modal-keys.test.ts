import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmationCapturesKey } from './native-modal-keys';

class ElementFixture extends EventTarget {
  modal = false;
  closest(selector: string) { assert.equal(selector, 'dialog:modal'); return this.modal ? this : null; }
}

test('a native modal above confirmation owns Escape, Tab and Enter, and confirmation resumes after it closes', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Element');
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: ElementFixture });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'Element', previous);
    else Reflect.deleteProperty(globalThis, 'Element'); });
  const target = new ElementFixture();
  target.modal = true;
  for (const key of ['Escape', 'Tab', 'Enter']) assert.equal(confirmationCapturesKey({ key, target }), false);
  target.modal = false;
  for (const key of ['Escape', 'Tab', 'Enter']) assert.equal(confirmationCapturesKey({ key, target }), true);
  assert.equal(confirmationCapturesKey({ key: 'ArrowLeft', target }), false);
});

test('ordinary and untargeted confirmation keys retain their existing route', () => {
  assert.equal(confirmationCapturesKey({ key: 'Escape', target: null }), true);
  assert.equal(confirmationCapturesKey({ key: 'Enter', target: new EventTarget() }), true);
  assert.equal(confirmationCapturesKey({ key: 'a', target: null }), false);
});
