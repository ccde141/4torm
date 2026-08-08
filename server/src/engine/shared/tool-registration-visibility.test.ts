import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVirtualToolDefs as buildTradewindTools } from '../tradewind/execution/virtual-tools.js';
import { FRAMEWORK_TOOLS } from '../../tools/framework/catalog.js';

test('register_tool is not global and Tradewind never exposes it', () => {
  const tradewind = buildTradewindTools({ allowDelegate: true, contactTargets: ['reviewer'] });
  assert.equal(FRAMEWORK_TOOLS.some(tool => tool.name === 'register_tool'), false);
  assert.equal(tradewind.some(tool => tool.name === 'register_tool'), false);
});
