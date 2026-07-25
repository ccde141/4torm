import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'ConvectionPage.tsx'), 'utf8');

assert.doesNotMatch(source, /<(?:action|answer|think|result)\b/i);
assert.doesNotMatch(source, /parseStructuredOutput/);

console.log('convection text protocol UI ok');
