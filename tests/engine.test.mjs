import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, outcome, recommend, createGame, playRound, submitDecision, inferRoles, publicHistory, chooseBotAction, chooseBotGuess, settleAccusations, validSavedGame } from '../src/engine.js';

test('all nine rock-paper-scissors outcomes are consistent', () => {
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
    assert.equal(outcome(a, b), a === b ? 0 : (b + 1) % 3 === a ? 1 : -1);
    assert.equal(outcome(a, b) + outcome(b, a), 0);
  }
});
test('five recommendations use actual public moves, with correct perspectives', () => {
  const h = [{ player: 0, bot: 2 }, { player: 1, bot: 0 }];
  assert.deepEqual(ROLES.map(r => recommend(r.id, h)), [0, 2, 0, 1, 1]);
  assert.deepEqual(ROLES.map(r => recommend(r.id, h, 'bot')), [2, 1, 1, 2, 1]);
  for (const role of ROLES) assert.equal(recommend(role.id, []), null);
});
test('a committed bot move survives different legal player choices and refreshes', () => {
  const game = createGame(317);
  assert(validSavedGame(JSON.parse(JSON.stringify(game))));
  for (let move = 0; move < 3; move++) {
    const next = playRound(game, move);
    assert.equal(next.history[0].bot, game.pending.move);
    assert.equal(next.playerTokens, 3);
  }
  assert.equal(game.history.length, 0);
});
test('disguise is charged before a win can recharge it; zero balance cannot borrow', () => {
  let game = createGame(10);
  game.playerRole = 'orbit';
  game.pending = { move: 0, normal: null, disguised: false };
  game = playRound(game, 1);
  game = submitDecision(game);
  game.pending = { move: 0, normal: 0, disguised: false };
  game = playRound(game, 1);
  assert.equal(game.history[1].playerDisguised, true);
  assert.equal(game.playerTokens, 3);
  assert.equal(game.history[1].playerRecharge, true);
  game = submitDecision(game);
  game.playerTokens = 0;
  const expected = recommend(game.playerRole, game.history);
  assert.throws(() => playRound(game, (expected + 1) % 3), /No disguise/);
  assert.equal(playRound(game, expected).history.length, 3);
});
test('duplicate actions and premature accusations are rejected', () => {
  const game = playRound(createGame(25), 0);
  assert.throws(() => playRound(game, 0), /already locked/);
  assert.throws(() => submitDecision(game, 'echo'), /Too early/);
  assert.throws(() => submitDecision(game, 'made-up'), /Unknown/);
  assert.throws(() => submitDecision(createGame(25)), /Not in/);
});
test('inference boundary strips identities, resource balances, and disguise records', () => {
  const history = [{ player: 0, bot: 1, playerRole: 'echo', playerTokens: 0, botDisguised: true }];
  assert.deepEqual(publicHistory(history), [{ player: 0, bot: 1 }]);
  const obs = { history: publicHistory(history), role: 'orbit', tokens: 2, difficulty: 'standard' };
  assert.deepEqual(chooseBotAction(obs, () => 0.2), chooseBotAction(structuredClone(obs), () => 0.2));
  assert.deepEqual(chooseBotGuess(publicHistory(history), 'standard', false, () => 0.3), chooseBotGuess(publicHistory(history), 'standard', false, () => 0.3));
});
test('changing the private player identity cannot change the bot action or accusation', () => {
  let base = playRound(createGame(384), 0);
  base = submitDecision(base);
  const outcomes = ROLES.map(role => {
    const variant = structuredClone(base);
    variant.playerRole = role.id;
    variant.playerTokens = 3;
    const played = playRound(variant, 0);
    const resumed = submitDecision(played);
    return { guess: played.pendingGuess, read: played.reads.at(-1), action: resumed.pending, rng: resumed.rngState };
  });
  for (const result of outcomes) assert.deepEqual(result, outcomes[0]);
});
test('all simultaneous accusation combinations follow the published rules', () => {
  const mine = 'orbit', theirs = 'echo', options = [null, 'orbit', 'echo', 'anchor'];
  for (const p of options) for (const b of options) {
    const result = settleAccusations(p, b, mine, theirs, 3, 2);
    const pc = p === theirs, bc = b === mine;
    const expected = pc && bc ? 'player' : pc ? 'player' : bc ? 'bot' : p && b ? 'draw' : p ? 'bot' : b ? 'player' : null;
    assert.equal(result?.winner ?? null, expected, `${p}/${b}`);
  }
  assert.equal(settleAccusations('echo', 'orbit', mine, theirs, 2, 2).winner, 'draw');
  assert.equal(settleAccusations('echo', 'orbit', mine, theirs, 1, 2).winner, 'bot');
});
test('round 12 requires a player guess and forces a bot guess', () => {
  let game = createGame(31);
  while (true) {
    game = playRound(game, recommend(game.playerRole, game.history) ?? 0);
    if (game.round === 12) break;
    game.pendingGuess = null; // Exercise the deadline even when the bot could finish early.
    game = submitDecision(game);
  }
  assert(game.pendingGuess);
  assert.throws(() => submitDecision(game), /Final accusation/);
  const ended = submitDecision(game, 'anchor');
  assert.equal(ended.phase, 'ended');
  assert.equal(ended.history.length, 12);
  assert(validSavedGame(ended));
});
test('500 seeded matches preserve true candidates, budgets, phase and round invariants', () => {
  for (let seed = 1; seed <= 500; seed++) {
    let game = createGame(seed, ['rookie', 'standard', 'expert'][seed % 3]);
    let steps = 0;
    while (game.phase !== 'ended') {
      assert(validSavedGame(game));
      const normal = recommend(game.playerRole, game.history);
      const move = game.playerTokens || normal === null ? (seed + game.round * 7) % 3 : normal;
      const before = structuredClone(game);
      game = playRound(game, move);
      assert.deepEqual(game.history.slice(0, -1), before.history);
      for (const side of ['player', 'bot']) {
        const trueCandidate = inferRoles(publicHistory(game.history), side).find(c => c.role === game[`${side}Role`]);
        assert(trueCandidate.feasible, `seed ${seed}, round ${game.round}, ${side}`);
        assert.equal(trueCandidate.tokens, game[`${side}Tokens`]);
      }
      assert(validSavedGame(game));
      const botGuess = game.pendingGuess;
      const wrongOrCorrect = ROLES[(seed + game.round) % 5].id;
      game = submitDecision(game, game.round === 12 ? wrongOrCorrect : null);
      if (game.phase === 'ended') assert.equal(game.result.botGuess, botGuess);
      assert(++steps <= 12);
    }
    assert(validSavedGame(game));
  }
});
test('inference rejects an impossible budget and handles ambiguous evidence', () => {
  const impossible = Array.from({ length: 6 }, (_, i) => ({ player: i === 0 ? 0 : 1, bot: 2 }));
  assert.equal(inferRoles(impossible).find(c => c.role === 'anchor').feasible, false);
  const empty = inferRoles([]);
  assert(empty.every(c => c.feasible && c.weight === 0.2));
  assert(Math.abs(empty.reduce((sum, c) => sum + c.weight, 0) - 1) < 1e-10);
});
test('corrupt or incompatible saved games are rejected', () => {
  for (const state of [null, {}, { version: 0 }, { ...createGame(1), playerTokens: -1 }, { ...createGame(1), playerRole: '<script>' }, { ...createGame(1), pending: { move: 7 } }]) assert.equal(validSavedGame(state), false);
});
