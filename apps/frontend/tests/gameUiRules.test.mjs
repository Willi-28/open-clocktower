import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';

function loadModule(path, filename) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const module = { exports: {} };
  new Script(compiled, { filename }).runInNewContext({ exports: module.exports, module });
  return module.exports;
}

const {
  countedYesVotesThrough,
  orderedVotePlayers,
  requiredExecutionVotes,
  seatedClockwisePlayers,
  voteForPlayer,
  yesVoteCount,
} = loadModule('../src/game-ui/voting.ts', 'voting.ts');
const { buildReminderTokenOptions, renderReminders } = loadModule('../src/game-ui/reminderTokens.ts', 'reminderTokens.ts');

function player(id, seatIndex, status = 'alive', isStoryteller = false) {
  return {
    id,
    display_name: id,
    seat_index: seatIndex,
    status,
    has_dead_vote: true,
    is_connected: true,
    is_storyteller: isStoryteller,
    avatar_url: null,
  };
}

function room(players, votes = []) {
  return {
    id: 'room',
    name: 'Room',
    seat_count: 7,
    phase: 'day',
    day_count: 1,
    night_count: 0,
    players,
    active_nomination: null,
    nomination_requests: [],
    votes,
    created_at: '',
    updated_at: '',
  };
}

{
  const state = room([player('st', null, 'alive', true), player('b', 2), player('a', 1)]);
  assert.deepEqual(JSON.parse(JSON.stringify(seatedClockwisePlayers(state).map((item) => item.id))), ['a', 'b']);
}

{
  const players = [player('a', 0), player('b', 1), player('c', 2)];
  const voteOrder = orderedVotePlayers({ nominee_id: 'b' }, players);
  assert.deepEqual(JSON.parse(JSON.stringify(voteOrder.map((item) => item.id))), ['b', 'c', 'a']);
}

{
  const state = room([player('a', 0), player('b', 1), player('c', 2, 'dead')], [
    { player_id: 'a', value: true },
    { player_id: 'b', value: false },
    { player_id: 'c', value: true },
  ]);
  assert.equal(voteForPlayer(state, 'a'), true);
  assert.equal(yesVoteCount(state), 2);
  assert.equal(requiredExecutionVotes(state), 1);
  assert.equal(countedYesVotesThrough(state, [player('a', 0), player('b', 1), player('c', 2)], 2), 2);
}

{
  const options = buildReminderTokenOptions([
    { id: 'drunk', label: 'IS THE DRUNK', character: 'Washerwoman', icon: 'data:image/png;base64,x' },
    { id: 'missing', label: 'MISSING', character: null, icon: null },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(options)), [
    { id: 'drunk', label: 'IS THE DRUNK', title: 'Washerwoman: IS THE DRUNK', icon: 'data:image/png;base64,x' },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(renderReminders([{ id: 'r1', tokenId: 'drunk', label: 'Old', x: 1, y: 2 }], options))), [
    { id: 'r1', tokenId: 'drunk', label: 'IS THE DRUNK', icon: 'data:image/png;base64,x', x: 1, y: 2 },
  ]);
}
