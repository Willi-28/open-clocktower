import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';

function loadChatRules() {
  const source = readFileSync(new URL('../src/game-ui/chatRules.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const module = { exports: {} };
  new Script(compiled, { filename: 'chatRules.ts' }).runInNewContext({ exports: module.exports, module });
  return module.exports;
}

function player(id, seatIndex, isStoryteller = false) {
  return {
    id,
    display_name: id,
    seat_index: seatIndex,
    status: 'alive',
    has_dead_vote: true,
    is_connected: true,
    is_storyteller: isStoryteller,
    avatar_url: null,
  };
}

function room(players, seatCount = 7) {
  return {
    id: 'room',
    name: 'Room',
    seat_count: seatCount,
    phase: 'day',
    day_count: 1,
    night_count: 0,
    players,
    active_nomination: null,
    nomination_requests: [],
    votes: [],
    created_at: '',
    updated_at: '',
  };
}

const { privateChatTargets } = loadChatRules();

function targetIds(state, currentPlayer, storyteller) {
  return JSON.parse(JSON.stringify(privateChatTargets(state, currentPlayer, storyteller).map((target) => target.id)));
}

{
  const storyteller = player('st', null, true);
  const current = player('p1', 2);
  const players = [storyteller, player('left', 1), current, player('right', 3), player('far', 4)];
  assert.deepEqual(targetIds(room(players), current, storyteller), ['st', 'left', 'right']);
}

{
  const storyteller = player('st', null, true);
  const current = player('p1', 2);
  const players = [storyteller, player('gap-left', 0), current, player('gap-right', 4)];
  assert.deepEqual(targetIds(room(players), current, storyteller), ['st']);
}

{
  const storyteller = player('st', null, true);
  const players = [storyteller, player('p1', 0), player('p2', 1)];
  assert.deepEqual(targetIds(room(players), storyteller, storyteller), ['p1', 'p2']);
}
