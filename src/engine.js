export const VERSION = 1;
export const MAX_ROUNDS = 12;
export const MAX_TOKENS = 3;
export const FIRST_ACCUSATION = 4;
export const MOVES = ['石头', '布', '剪刀'];
export const ROLES = Object.freeze([
  { id: 'anchor', name: '固守型', english: 'ANCHOR', code: '01', description: '始终重复自己第一回合的出招。', hint: '第一手，就是你的锚点。' },
  { id: 'orbit', name: '轮转型', english: 'ORBIT', code: '02', description: '出能克制自己上一手的招。', hint: '石头 → 布 → 剪刀 → 石头。' },
  { id: 'echo', name: '模仿型', english: 'ECHO', code: '03', description: '重复对方上一回合的出招。', hint: '对方的过去，是你的下一手。' },
  { id: 'counter', name: '反制型', english: 'COUNTER', code: '04', description: '出能克制对方上一手的招。', hint: '永远比对方的上一手领先一步。' },
  { id: 'keeper', name: '守胜型', english: 'KEEPER', code: '05', description: '赢了重复上一手；输或平局就轮转一招。', hint: '留住胜利，打破僵局。' },
]);
export const DIFFICULTIES = Object.freeze({
  rookie: { name: '见习', cover: 0.15, threshold: 1, minRound: 7 },
  standard: { name: '特工', cover: 0.25, threshold: 0.975, minRound: 5 },
  expert: { name: '幽灵', cover: 0.33, threshold: 0.94, minRound: 4 },
});

export const counter = move => (move + 1) % 3;
export function outcome(player, bot) {
  return player === bot ? 0 : counter(bot) === player ? 1 : -1;
}

// Every recommendation uses ACTUAL public moves, including disguised moves.
export function recommend(role, history, side = 'player') {
  if (!history.length) return null;
  const opponent = side === 'player' ? 'bot' : 'player';
  const last = history.at(-1);
  switch (role) {
    case 'anchor': return history[0][side];
    case 'orbit': return counter(last[side]);
    case 'echo': return last[opponent];
    case 'counter': return counter(last[opponent]);
    case 'keeper': return outcome(last[side], last[opponent]) === 1 ? last[side] : counter(last[side]);
    default: throw new Error('Unknown strategy');
  }
}

function random(state) {
  let value = state.rngState += 0x6D2B79F5;
  value = Math.imul(value ^ value >>> 15, value | 1);
  value ^= value + Math.imul(value ^ value >>> 7, value | 61);
  state.rngState >>>= 0;
  return ((value ^ value >>> 14) >>> 0) / 4294967296;
}

// This is the complete information boundary for bot inference. No roles,
// private balances, notes, pending player action, or game object cross it.
export function publicHistory(history) {
  return history.map(({ player, bot }) => ({ player, bot }));
}

// Replay each possible identity's budget. An impossible budget eliminates it;
// a behavioral likelihood ranks the identities that remain possible.
export function inferRoles(history, side = 'player') {
  const opponent = side === 'player' ? 'bot' : 'player';
  const candidates = ROLES.map(role => {
    let tokens = MAX_TOKENS, wins = 0, matches = 0, deviations = 0, logWeight = 0, feasible = true;
    for (let i = 0; i < history.length; i++) {
      if (i > 0) {
        const normal = recommend(role.id, history.slice(0, i), side);
        const deviated = history[i][side] !== normal;
        if (deviated) {
          deviations++;
          if (tokens === 0) { feasible = false; break; }
          tokens--;
          logWeight += Math.log(0.13);
        } else {
          matches++;
          logWeight += Math.log(tokens === 0 ? 1 : 0.74);
        }
      }
      if (outcome(history[i][side], history[i][opponent]) === 1) {
        wins++;
        if (wins % 2 === 0) tokens = Math.min(MAX_TOKENS, tokens + 1);
      }
    }
    return { role: role.id, tokens, matches, deviations, feasible, logWeight: feasible ? logWeight : -Infinity, weight: 0 };
  });
  const best = Math.max(...candidates.map(c => c.logWeight));
  const total = candidates.reduce((sum, c) => sum + (c.feasible ? Math.exp(c.logWeight - best) : 0), 0);
  for (const candidate of candidates) candidate.weight = candidate.feasible && total ? Math.exp(candidate.logWeight - best) / total : 0;
  return candidates;
}

// The bot may know its own identity and balance, but never its opponent's.
export function chooseBotAction({ history, role, tokens, difficulty }, nextRandom) {
  if (!history.length) return { move: Math.floor(nextRandom() * 3), normal: null, disguised: false };
  const normal = recommend(role, history, 'bot');
  const settings = DIFFICULTIES[difficulty];
  const ownCandidates = inferRoles(history, 'bot').filter(c => c.feasible);
  const normalSupport = ownCandidates.filter(c => recommend(c.role, history, 'bot') === normal).length;
  const exposure = normalSupport <= 1 ? 0.1 : 0;
  if (!tokens || nextRandom() > settings.cover + exposure) return { move: normal, normal, disguised: false };

  const beliefs = inferRoles(history, 'player');
  const alternatives = [0, 1, 2].filter(move => move !== normal);
  const ratings = alternatives.map(move => {
    const camouflage = ownCandidates.filter(c => recommend(c.role, history, 'bot') === move).length * 0.16;
    const combat = beliefs.reduce((score, c) => score + c.weight * outcome(move, recommend(c.role, history, 'player')), 0);
    return { move, rating: camouflage + combat * 0.4 + nextRandom() * 0.35 };
  });
  ratings.sort((a, b) => b.rating - a.rating);
  return { move: ratings[0].move, normal, disguised: true };
}

export function chooseBotGuess(history, difficulty, forced, nextRandom) {
  const candidates = inferRoles(history, 'player');
  const possible = candidates.filter(c => c.feasible);
  const bestWeight = Math.max(...candidates.map(c => c.weight));
  const leaders = candidates.filter(c => Math.abs(c.weight - bestWeight) < 1e-10);
  const selected = leaders[Math.floor(nextRandom() * leaders.length)];
  const settings = DIFFICULTIES[difficulty];
  const allowed = history.length >= settings.minRound && (possible.length === 1 || (difficulty !== 'rookie' && bestWeight >= settings.threshold));
  return { guess: forced || allowed ? selected.role : null, candidates };
}

function prepareRound(state) {
  const action = chooseBotAction({
    history: publicHistory(state.history), role: state.botRole,
    tokens: state.botTokens, difficulty: state.difficulty,
  }, () => random(state));
  state.pending = action;
  state.pendingGuess = null;
  state.phase = 'choose';
}

export function createGame(seed, difficulty = 'standard') {
  if (!DIFFICULTIES[difficulty]) throw new Error('Unknown difficulty');
  const state = {
    version: VERSION, seed: seed >>> 0, rngState: seed >>> 0,
    id: `${seed >>> 0}-${Date.now()}`, difficulty,
    playerRole: null, botRole: null, phase: 'choose', round: 1,
    playerTokens: MAX_TOKENS, botTokens: MAX_TOKENS, playerWins: 0, botWins: 0,
    history: [], pending: null, pendingGuess: null, reads: [], result: null,
  };
  state.playerRole = ROLES[Math.floor(random(state) * ROLES.length)].id;
  state.botRole = ROLES[Math.floor(random(state) * ROLES.length)].id;
  prepareRound(state);
  return state;
}

export function playRound(previous, move) {
  if (previous.phase !== 'choose') throw new Error('Round is already locked');
  if (!Number.isInteger(move) || move < 0 || move > 2) throw new Error('Invalid move');
  const state = structuredClone(previous);
  const normal = recommend(state.playerRole, state.history);
  const disguised = normal !== null && normal !== move;
  if (disguised && state.playerTokens === 0) throw new Error('No disguise tokens left');
  const playerBefore = state.playerTokens, botBefore = state.botTokens;
  const botAction = state.pending;
  if (disguised) state.playerTokens--;
  if (botAction.disguised) state.botTokens--;
  const result = outcome(move, botAction.move);
  if (result === 1) state.playerWins++;
  if (result === -1) state.botWins++;
  const playerRecharge = result === 1 && state.playerWins % 2 === 0;
  const botRecharge = result === -1 && state.botWins % 2 === 0;
  if (playerRecharge) state.playerTokens = Math.min(MAX_TOKENS, state.playerTokens + 1);
  if (botRecharge) state.botTokens = Math.min(MAX_TOKENS, state.botTokens + 1);
  state.history.push({
    round: state.round, player: move, bot: botAction.move, outcome: result,
    playerNormal: normal, botNormal: botAction.normal,
    playerDisguised: disguised, botDisguised: botAction.disguised,
    playerBefore, botBefore, playerAfter: state.playerTokens, botAfter: state.botTokens,
    playerRecharge, botRecharge,
  });
  // Commit its accusation BEFORE the player's decision is known.
  const read = chooseBotGuess(publicHistory(state.history), state.difficulty, state.round === MAX_ROUNDS, () => random(state));
  state.pendingGuess = state.round >= FIRST_ACCUSATION ? read.guess : null;
  state.reads.push(read);
  state.pending = null;
  state.phase = 'decision';
  return state;
}

export function settleAccusations(playerGuess, botGuess, playerRole, botRole, playerWins, botWins) {
  const playerCorrect = playerGuess === botRole;
  const botCorrect = botGuess === playerRole;
  let winner, reason;
  if (playerCorrect && botCorrect) {
    winner = playerWins === botWins ? 'draw' : playerWins > botWins ? 'player' : 'bot';
    reason = 'both-correct';
  } else if (playerCorrect) { winner = 'player'; reason = 'player-read'; }
  else if (botCorrect) { winner = 'bot'; reason = 'bot-read'; }
  else if (playerGuess !== null && botGuess !== null) { winner = 'draw'; reason = 'both-wrong'; }
  else if (playerGuess !== null) { winner = 'bot'; reason = 'player-wrong'; }
  else if (botGuess !== null) { winner = 'player'; reason = 'bot-wrong'; }
  else return null;
  return { winner, reason, playerGuess, botGuess, playerCorrect, botCorrect };
}

export function submitDecision(previous, playerGuess = null) {
  if (previous.phase !== 'decision') throw new Error('Not in the deduction phase');
  if (playerGuess !== null && !ROLES.some(r => r.id === playerGuess)) throw new Error('Unknown accusation');
  if (playerGuess !== null && previous.round < FIRST_ACCUSATION) throw new Error('Too early to accuse');
  if (previous.round === MAX_ROUNDS && playerGuess === null) throw new Error('Final accusation required');
  const state = structuredClone(previous);
  state.result = settleAccusations(playerGuess, state.pendingGuess, state.playerRole, state.botRole, state.playerWins, state.botWins);
  if (state.result) {
    state.phase = 'ended';
    state.pendingGuess = null;
  } else {
    state.round++;
    prepareRound(state);
  }
  return state;
}

export function validSavedGame(state) {
  if (!state || state.version !== VERSION || !DIFFICULTIES[state.difficulty]) return false;
  const isMove = value => Number.isInteger(value) && value >= 0 && value < 3;
  const isRole = value => ROLES.some(role => role.id === value);
  const isGuess = value => value === null || isRole(value);
  const isBalance = value => Number.isInteger(value) && value >= 0 && value <= MAX_TOKENS;
  if (typeof state.id !== 'string' || ![state.seed, state.rngState].every(value => Number.isInteger(value) && value >= 0 && value <= 0xFFFFFFFF)) return false;
  if (!['choose', 'decision', 'ended'].includes(state.phase)) return false;
  if (!ROLES.some(r => r.id === state.playerRole) || !ROLES.some(r => r.id === state.botRole)) return false;
  if (!Number.isInteger(state.round) || state.round < 1 || state.round > MAX_ROUNDS) return false;
  if (!Array.isArray(state.history) || state.history.length !== state.round - (state.phase === 'choose' ? 1 : 0)) return false;
  if (!Array.isArray(state.reads) || state.reads.length !== state.history.length) return false;
  if (![state.playerTokens, state.botTokens].every(x => Number.isInteger(x) && x >= 0 && x <= MAX_TOKENS)) return false;
  if (!isGuess(state.pendingGuess)) return false;
  if (!state.history.every((h, i) => h && h.round === i + 1 && [h.player, h.bot].every(isMove)
    && h.outcome === outcome(h.player, h.bot)
    && [h.playerNormal, h.botNormal].every(value => value === null || isMove(value))
    && [h.playerBefore, h.botBefore, h.playerAfter, h.botAfter].every(isBalance)
    && [h.playerDisguised, h.botDisguised, h.playerRecharge, h.botRecharge].every(value => typeof value === 'boolean'))) return false;
  if (state.playerWins !== state.history.filter(h => h.outcome === 1).length || state.botWins !== state.history.filter(h => h.outcome === -1).length) return false;
  if (!state.reads.every(read => read && isGuess(read.guess) && Array.isArray(read.candidates) && read.candidates.length === ROLES.length
    && read.candidates.every(c => c && isRole(c.role) && typeof c.feasible === 'boolean' && Number.isFinite(c.weight) && c.weight >= 0 && c.weight <= 1))) return false;
  if (state.phase === 'choose' && (!state.pending || !Number.isInteger(state.pending.move) || state.pending.move < 0 || state.pending.move > 2)) return false;
  if (state.phase === 'ended' && (!state.result || !['player', 'bot', 'draw'].includes(state.result.winner)
    || !isGuess(state.result.playerGuess) || !isGuess(state.result.botGuess)
    || !['both-correct', 'both-wrong', 'player-read', 'bot-read', 'player-wrong', 'bot-wrong'].includes(state.result.reason))) return false;
  return true;
}
