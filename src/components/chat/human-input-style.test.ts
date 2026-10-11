import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('human steering reuses user message structure with a pale blue identity ring', () => {
  const component = fs.readFileSync('src/components/chat/HumanInputList.tsx', 'utf8');
  const styles = fs.readFileSync('src/styles/components/chat.css', 'utf8');
  assert.match(component, /chat__message chat__message--user chat__message--steering/);
  assert.match(component, /chat__avatar/);
  assert.match(component, /chat__bubble/);
  assert.match(styles, /\.chat__message--steering \.chat__bubble/);
  assert.match(styles, /rgba\(125,\s*211,\s*252/);
  assert.doesNotMatch(styles, /\.chat__human-inputs\s*\{[^}]*background:/s);
});

test('human steering is a separate timeline entry instead of an attachment to the preceding message', () => {
  const page = fs.readFileSync('src/components/chat/MonsoonConversation.tsx', 'utf8');
  const styles = fs.readFileSync('src/styles/components/chat.css', 'utf8');
  const inputListStyles = styles.match(/\.chat__human-inputs\s*\{([^}]*)\}/)?.[1] ?? '';

  assert.match(page, /<Fragment key=\{message\.id\}>[\s\S]*?<MessageItem[\s\S]*?<HumanInputList message=\{message\} \/>[\s\S]*?<\/Fragment>/);
  assert.doesNotMatch(page, /<div key=\{message\.id\}>[\s\S]*?<HumanInputList message=\{message\} \/>[\s\S]*?<\/div>/);
  assert.doesNotMatch(inputListStyles, /margin-top:\s*calc\([^;]*-1/);
});

test('skipped steering work is summarized inside the human message bubble', () => {
  const component = fs.readFileSync('src/components/chat/HumanInputList.tsx', 'utf8');

  assert.match(component, /<div className="chat__bubble">[\s\S]*?skippedNotice[\s\S]*?<\/div>/);
  assert.match(component, /<strong className="chat__human-input-skipped-names">\{notice\.names\}<\/strong>/);
  assert.doesNotMatch(component, /inputSkipped\.join/);
});
