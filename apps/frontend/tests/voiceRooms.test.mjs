import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';

function loadVoiceRooms() {
  const source = readFileSync(new URL('../src/game-ui/voiceRooms.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const module = { exports: {} };
  new Script(compiled, { filename: 'voiceRooms.ts' }).runInNewContext({ exports: module.exports, module });
  return module.exports;
}

const {
  privateVoiceRoomFor,
  publicVoiceOccupantNames,
  storytellerVoiceLabel,
  voicePresenceRows,
  voiceRoomLabel,
} = loadVoiceRooms();

const names = new Map([
  ['alice', 'Alice'],
  ['bob', 'Bob'],
  ['cara', 'Cara'],
]);

const playerName = (playerId) => names.get(playerId) ?? 'Unknown';

assert.equal(privateVoiceRoomFor('bob', 'alice'), 'alice:private:bob');
assert.equal(privateVoiceRoomFor('alice', 'bob'), 'alice:private:bob');

assert.equal(voiceRoomLabel('Town Square', playerName), 'Town Square');
assert.equal(voiceRoomLabel('alice:private:bob', playerName), 'Private Call: Alice + Bob');

assert.equal(storytellerVoiceLabel(undefined), 'Watching the circle');
assert.equal(storytellerVoiceLabel('Town Square'), 'Town Square');
assert.equal(storytellerVoiceLabel('alice:private:bob'), 'In a private call');

{
  const participants = [
    { playerId: 'alice', voiceRoom: 'Town Square' },
    { playerId: 'bob', voiceRoom: 'The Inn' },
    { playerId: 'cara', voiceRoom: 'Town Square' },
  ];
  assert.deepEqual(publicVoiceOccupantNames(participants, 'Town Square', playerName), ['Alice', 'Cara']);
}

{
  const participants = [
    { playerId: 'alice', voiceRoom: 'Town Square' },
    { playerId: 'bob', voiceRoom: 'alice:private:bob' },
    { playerId: 'cara', voiceRoom: 'alice:private:bob' },
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(voicePresenceRows(participants, playerName))), [
    { id: 'Town Square', label: 'Town Square', players: 'Alice' },
    { id: 'alice:private:bob', label: 'Private Call: Alice + Bob', players: 'Bob + Cara' },
  ]);
}
