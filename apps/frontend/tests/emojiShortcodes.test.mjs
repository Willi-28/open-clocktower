import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';

function loadEmojis() {
  const source = readFileSync(new URL('../src/game-ui/emojis.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const module = { exports: {} };
  new Script(compiled, { filename: 'emojis.ts' }).runInNewContext({ exports: module.exports, module });
  return module.exports;
}

const { emojiCodepoints, emojiDefinitions, emojiForShortcode, insertEmoji, isEmojiOnlyMessage, searchEmojis, tokenizeEmojiShortcodes } = loadEmojis();

assert.equal(emojiForShortcode('smirk').emoji, '😏');
assert.equal(emojiForShortcode('SMIRK').emoji, '😏');
assert.equal(emojiForShortcode('+1').emoji, '👍');
assert.equal(emojiForShortcode('hankey').emoji, '💩');
assert.equal(emojiForShortcode('satisfied').emoji, '😆');
assert.equal(emojiForShortcode('does_not_exist'), undefined);

assert.equal(JSON.stringify(tokenizeEmojiShortcodes('hi :smirk: ok').map((segment) => segment.type === 'emoji' ? segment.emoji : segment.value)), JSON.stringify([
  'hi ',
  '😏',
  ' ok',
]));

assert.equal(JSON.stringify(tokenizeEmojiShortcodes(':unknown: :heart:').map((segment) => segment.type === 'emoji' ? segment.emoji : segment.value)), JSON.stringify([
  ':unknown: ',
  '❤️',
]));

// Literal emoji characters (as inserted by the picker) tokenize like shortcodes.
assert.equal(JSON.stringify(tokenizeEmojiShortcodes('hi 😭 ok').map((segment) => segment.type === 'emoji' ? segment.emoji : segment.value)), JSON.stringify([
  'hi ',
  '😭',
  ' ok',
]));
assert.equal(tokenizeEmojiShortcodes('☠️')[0].shortcode, 'skull_crossbones');
assert.equal(isEmojiOnlyMessage('😭 ❤️'), true);

assert.equal(searchEmojis('smirk')[0].shortcode, 'smirk');
assert.ok(searchEmojis('love').some((emoji) => emoji.shortcode === 'heart'));
assert.equal(searchEmojis('hankey')[0].shortcode, 'poop');
assert.equal(isEmojiOnlyMessage(':smirk: :heart:'), true);
assert.equal(isEmojiOnlyMessage(':smirk: hello'), false);
assert.equal(isEmojiOnlyMessage(':unknown:'), false);
assert.equal(emojiCodepoints('😏'), '1f60f');
assert.equal(emojiCodepoints('❤️'), '2764');
assert.equal(emojiCodepoints('☠️'), '2620');

// Every emoji in the bounded list must ship as a bundled local SVG, so chat
// rendering never depends on an external CDN.
for (const definition of emojiDefinitions) {
  const asset = new URL(`../src/assets/twemoji/${emojiCodepoints(definition.emoji)}.svg`, import.meta.url);
  assert.ok(existsSync(asset), `missing bundled twemoji asset for :${definition.shortcode}:`);
}

assert.equal(JSON.stringify(insertEmoji('hello', 'joy', 5, 5)), JSON.stringify({
  nextDraft: 'hello😂',
  nextCursor: 7,
}));

assert.equal(JSON.stringify(insertEmoji('hello world', 'smirk', 6, 11)), JSON.stringify({
  nextDraft: 'hello 😏',
  nextCursor: 8,
}));
