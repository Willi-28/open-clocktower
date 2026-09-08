import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import ts from 'typescript';

/**
 * i18n.ts pulls in React for its context hook, which does not exist in this
 * sandbox, so React is stubbed. Only the pure translation path is under test.
 */
function compile(relativePath, resolve) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: true },
  }).outputText;
  const module = { exports: {} };
  new Script(compiled, { filename: relativePath }).runInNewContext({ exports: module.exports, module, require: resolve });
  return module.exports;
}

function loadI18n() {
  // index.ts pulls in React for its context hook, which does not exist in this
  // sandbox, so React is stubbed. Only the pure translation path is tested.
  const resolve = (id) => {
    if (id === 'react') {
      return { createContext: () => ({}), useContext: () => 'en', useMemo: (factory) => factory() };
    }
    if (id === './de') {
      return compile('../src/i18n/de.ts', resolve);
    }
    throw new Error(`unexpected import: ${id}`);
  };
  return compile('../src/i18n/index.ts', resolve);
}

const { translateUiText, uiLanguages } = loadI18n();
const { de: germanUiText } = compile('../src/i18n/de.ts', () => {
  throw new Error('de.ts should not import anything');
});


assert.equal(translateUiText('en', 'Start Game'), 'Start Game');
assert.equal(translateUiText('de', 'Start Game'), 'Spiel starten');

// An untranslated string has to stay readable rather than showing a key.
assert.equal(translateUiText('de', 'Some brand new label'), 'Some brand new label');

// Placeholders survive translation so a translator can reorder them.
assert.equal(
  translateUiText('de', 'Preparing {pack}...', { pack: 'HBLX' }),
  translateUiText('de', 'Preparing {pack}...').replace('{pack}', 'HBLX'),
);
assert.equal(translateUiText('en', 'Hello {name}', { name: 'willi' }), 'Hello willi');
// An unknown placeholder is left visible instead of becoming "undefined".
assert.equal(translateUiText('en', 'Hello {name}', {}), 'Hello {name}');

assert.equal(
  translateUiText('de', 'Share roles and storyteller reminder tokens with {player}? This exposes hidden information during the game.', { player: 'Willi' }),
  'Rollen und Erinnerungsmarken der Spielleitung mit Willi teilen? Dadurch werden während der Partie verborgene Informationen offengelegt.',
);

// Hooks sometimes deliver an already-interpolated English message. The
// translator recovers values from known placeholder keys at display time.
assert.equal(translateUiText('de', 'Calling Willi...'), 'Willi wird angerufen ...');
assert.equal(translateUiText('de', 'Private Call: Willi + Anna'), 'Privates Gespräch: Willi + Anna');

// Joined rather than deep-compared: the module runs in a VM realm, so its
// arrays do not share this realm's Array prototype.
assert.equal(uiLanguages.map((language) => language.code).join(), 'en,de');

// Every entry must be a real, non-empty translation.
const entries = Object.entries(germanUiText);
assert.ok(entries.length > 150, `expected a populated dictionary, got ${entries.length}`);
for (const [english, german] of entries) {
  assert.ok(english.trim().length > 0, 'empty key');
  assert.ok(typeof german === 'string' && german.trim().length > 0, `empty translation for ${english}`);
  const sourcePlaceholders = [...english.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  const translatedPlaceholders = [...german.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  assert.deepEqual(translatedPlaceholders, sourcePlaceholders, `placeholder mismatch for ${english}`);
}

/** Return every TypeScript source file under a directory. */
function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

// Every literal t('...') call must have a German entry. This turns accidental
// English fallback into a test failure instead of something found in the UI.
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
const untranslatedKeys = [];
const hardCodedText = [];
const allowedProperNames = new Set(['Open Clocktower']);
for (const path of sourceFiles(sourceRoot)) {
  const source = readFileSync(path, 'utf8');
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 't' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      !(node.arguments[0].text in germanUiText)
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      untranslatedKeys.push(`${relative(sourceRoot, path)}:${line + 1} ${JSON.stringify(node.arguments[0].text)}`);
    }
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      if (/[A-Za-zÄÖÜäöüß]/.test(text) && !allowedProperNames.has(text)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        hardCodedText.push(`${relative(sourceRoot, path)}:${line + 1} ${JSON.stringify(text)}`);
      }
    }
    if (
      ts.isJsxAttribute(node) &&
      ['aria-label', 'placeholder', 'title'].includes(node.name.text) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      /[A-Za-zÄÖÜäöüß]/.test(node.initializer.text) &&
      !node.initializer.text.startsWith('https://')
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      hardCodedText.push(`${relative(sourceRoot, path)}:${line + 1} ${node.name.text}=${JSON.stringify(node.initializer.text)}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

assert.deepEqual(untranslatedKeys, [], `missing German UI entries:\n${untranslatedKeys.join('\n')}`);
assert.deepEqual(hardCodedText, [], `hard-coded visible text:\n${hardCodedText.join('\n')}`);

console.log(`uiLanguage.test.mjs passed (${entries.length} German entries)`);
