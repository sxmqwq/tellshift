import { ROLES, MOVES, MAX_ROUNDS, DIFFICULTIES, FIRST_ACCUSATION, createGame, playRound, submitDecision, recommend, validSavedGame } from './engine.js';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'tellshift.match.v1';
const STATS_KEY = 'tellshift.stats.v1';
const roleById = id => ROLES.find(role => role.id === id);
let game = null, selection = null, suspect = null, excluded = [], identityHidden = false;
let confirmation = null, toastTimer, storageWarned = false;
let stats = { wins: 0, losses: 0, draws: 0, best: null, counted: [] };

const HAND_PATHS = [
  '<path d="M14 39 9 30c-2-4 3-7 5-4l3 4V15c0-4 6-4 6 0v10-13c0-4 6-4 6 0v13-11c0-4 6-4 6 0v12-8c0-4 6-4 6 0v16c0 7-4 12-7 15H21c-2-4-4-7-7-10Z"/><path d="M17 30h12c4 0 4 6 0 6h-7M21 49v4h13v-4"/>',
  '<path d="M14 37 6 25c-2-4 3-7 5-4l6 7V10c0-4 6-4 6 0v16V6c0-4 6-4 6 0v20V9c0-4 6-4 6 0v18V15c0-4 6-4 6 0v19c0 8-5 13-7 16H23c-2-5-6-8-9-13Z"/><path d="M23 50v4h11v-4"/>',
  '<path d="m19 30-7-16c-2-4 3-7 5-3l9 16 3-19c1-4 7-3 6 1l-2 21c1-4 7-4 7 0v5c0 8-4 12-7 16H22c-1-5-6-7-8-13l-4-8c-2-4 3-7 6-4l6 7h7c4 0 4 6 0 6h-6"/><path d="M22 51v3h11v-3"/>',
];
function hand(move, extra = '') {
  return `<svg viewBox="0 0 52 60" aria-hidden="true" class="${extra}">${HAND_PATHS[move]}</svg>`;
}
function escapeText(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3400);
}
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ game, suspect, excluded, identityHidden }));
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    if (!storageWarned) { toast('当前浏览器无法保存进度，本局仍可正常游玩。'); storageWarned = true; }
  }
}
function restore() {
  try {
    const savedStats = JSON.parse(localStorage.getItem(STATS_KEY));
    if (savedStats && ['wins', 'losses', 'draws'].every(key => Number.isInteger(savedStats[key]) && savedStats[key] >= 0)) {
      stats = { ...stats, ...savedStats, best: Number.isInteger(savedStats.best) && savedStats.best >= 4 && savedStats.best <= 12 ? savedStats.best : null, counted: Array.isArray(savedStats.counted) ? savedStats.counted.filter(id => typeof id === 'string').slice(-100) : [] };
    }
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && validSavedGame(saved.game)) {
      game = saved.game;
      suspect = roleById(saved.suspect) ? saved.suspect : null;
      excluded = Array.isArray(saved.excluded) ? saved.excluded.filter(id => roleById(id)) : [];
      identityHidden = saved.identityHidden === true;
      $('difficulty').value = game.difficulty;
    }
  } catch { /* Missing, disabled, or corrupt storage starts a clean session. */ }
}

function startGame() {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  game = createGame(seed, $('difficulty').value);
  selection = null; suspect = null; excluded = []; identityHidden = false;
  save(); render();
  toast(`身份已分配：${roleById(game.playerRole).name}。第一手自由选择。`);
}
function askNewGame() {
  if (!game || game.phase === 'ended') return startGame();
  showConfirmation('放弃当前任务？', '本局尚未结束。开始新任务会覆盖当前进度，不计入胜负战绩。', '开始新任务 →', startGame, 'RESET MISSION');
}
function showConfirmation(title, description, actionText, action, eyebrow = 'MAKE YOUR CALL') {
  $('confirm-title').textContent = title;
  $('confirm-description').textContent = description;
  $('confirm-action').textContent = actionText;
  $('confirm-eyebrow').textContent = eyebrow;
  confirmation = action;
  $('confirm-dialog').showModal();
}
function lockMove() {
  if (!game || game.phase !== 'choose' || selection === null) return;
  try {
    game = playRound(game, selection);
    selection = null;
    save(); render();
  } catch (error) { toast(error.message === 'No disguise tokens left' ? '伪装点不足，请按正常招式出招。' : '本轮未能提交，请重新选择。'); }
}
function finishDecision(guess = null) {
  if (!game || game.phase !== 'decision') return;
  try {
    game = submitDecision(game, guess);
    selection = null;
    if (game.phase === 'ended') recordResult();
    save(); render();
  } catch { toast('最终回合必须选择一种身份并提交指认。'); }
}
function recordResult() {
  if (!game?.result || stats.counted.includes(game.id)) return;
  const key = { player: 'wins', bot: 'losses', draw: 'draws' }[game.result.winner];
  stats[key]++;
  if (game.result.winner === 'player' && game.result.playerCorrect) stats.best = stats.best === null ? game.round : Math.min(stats.best, game.round);
  stats.counted = [...stats.counted, game.id].slice(-100);
}
function askAccusation() {
  if (!game || game.phase !== 'decision' || game.round < FIRST_ACCUSATION || !suspect) return;
  const role = roleById(suspect);
  showConfirmation(`指认 bot 为「${role.name}」？`, '提交后将与 bot 已锁定的判断同时结算。只有你指认且判断错误，会立即输掉本局。', '确认指认 →', () => finishDecision(role.id));
}

function renderSuspects() {
  const focused = document.activeElement?.closest('#suspects button');
  const focusSelector = focused?.dataset.suspect ? `[data-suspect="${focused.dataset.suspect}"]` : focused?.dataset.exclude ? `[data-exclude="${focused.dataset.exclude}"]` : null;
  $('suspects').innerHTML = ROLES.map(role => {
    const isSelected = suspect === role.id;
    const isExcluded = excluded.includes(role.id);
    const revealed = game?.phase === 'ended' && game.botRole === role.id;
    return `<div class="suspect-row${isSelected ? ' selected' : ''}${isExcluded ? ' excluded' : ''}">
      <button class="suspect-select" data-suspect="${role.id}" aria-pressed="${isSelected}" aria-label="${isSelected ? '取消怀疑' : '怀疑'}${role.name}">
      <span class="suspect-index">${role.code}</span><span class="suspect-name">${role.name}${revealed ? '<span>真身</span>' : isSelected ? '<span>嫌疑</span>' : ''}<small>${role.english}</small></span><span class="suspect-brief">${role.description}</span></button>
      <button class="exclude-button" data-exclude="${role.id}" aria-pressed="${isExcluded}" aria-label="${isExcluded ? '恢复' : '划除'}${role.name}" title="${isExcluded ? '恢复候选' : '手动划除'}">${isExcluded ? '↶' : '×'}</button></div>`;
  }).join('');
  if (focusSelector) $('suspects').querySelector(focusSelector)?.focus({ preventScroll: true });
}
function renderStatus() {
  const ended = game?.phase === 'ended';
  $('mission-id').textContent = game ? `TS–${game.seed.toString(16).toUpperCase().padStart(8, '0').slice(0, 6)}` : '等待接入';
  $('round-label').textContent = game ? `${ended ? '任务结束' : 'ROUND'} ${String(game.round).padStart(2, '0')} / 12` : '等待开始 / 12';
  $('round-dots').innerHTML = Array.from({ length: MAX_ROUNDS }, (_, i) => `<i class="${game && i < game.history.length ? 'done' : game && i === game.round - 1 ? 'current' : ''}"></i>`).join('');
  $('player-score').textContent = game?.playerWins ?? 0;
  $('bot-score').textContent = game?.botWins ?? 0;
  $('mode-label').textContent = game ? `${DIFFICULTIES[game.difficulty].name} / ${game.difficulty.toUpperCase()}` : 'STANDARD PROTOCOL';
  $('phase-label').textContent = !game ? 'FIELD / 等待行动' : ended ? 'MISSION / 已解除保密' : game.phase === 'choose' ? 'FIELD / 行动阶段' : 'ANALYSIS / 研判阶段';
  $('bot-lock').textContent = !game ? '● 信道待接入' : ended ? '● 身份已揭晓' : game.phase === 'choose' ? '● BOT 出招已锁定' : '● BOT 判断已锁定';
  $('bot-lock').classList.toggle('locked', !!game);
  $('bot-name').textContent = ended ? roleById(game.botRole).name : '身份未知';
  $('bot-badge').textContent = ended ? roleById(game.botRole).english : '5 个可能 · 1 个真相';
  $('player-name').textContent = !game ? '等待身份' : identityHidden && !ended ? '身份已隐藏' : roleById(game.playerRole).name;
  $('player-badge').textContent = ended ? roleById(game.playerRole).english : '仅你可见';
  $('restart-game').disabled = !game;
}
function renderIdentity() {
  $('hide-identity').disabled = !game || game.phase === 'ended';
  if (!game) return;
  const role = roleById(game.playerRole);
  const hidden = identityHidden && game.phase !== 'ended';
  $('hide-identity').textContent = hidden ? '◎' : '◉';
  $('hide-identity').setAttribute('aria-label', hidden ? '显示身份' : '隐藏身份');
  $('hide-identity').title = hidden ? '显示身份' : '隐藏身份';
  $('identity-details').classList.toggle('private', hidden);
  $('identity-details').innerHTML = hidden
    ? '<div class="role-watermark">×</div><span class="role-code">CLASSIFIED</span><h3>身份已隐藏</h3><p>点击右上角，重新查看你的秘密身份。</p>'
    : `<div class="role-watermark">${role.code}</div><span class="role-code">${role.code} / ${role.english}</span><h3>${role.name}</h3><p>${role.description}<br>${role.hint}</p>`;
  const normal = game.phase === 'choose' ? recommend(game.playerRole, game.history) : game.history.at(-1)?.playerNormal;
  $('normal-move').innerHTML = `<span>本轮正常招式</span><strong>${hidden ? '•••' : normal === null || normal === undefined ? '自由出招' : MOVES[normal]}</strong>`;
  $('token-count').textContent = `${game.playerTokens} / 3`;
  $('token-slots').innerHTML = Array.from({ length: 3 }, (_, i) => `<span class="${i < game.playerTokens ? 'filled' : ''}"></span>`).join('');
  $('token-slots').setAttribute('aria-label', `剩余 ${game.playerTokens} 点伪装额度`);
  const progress = game.playerWins % 2;
  $('recharge-track').innerHTML = `<span>补充进度</span><i class="${progress ? 'active' : ''}"></i><i></i><small>${progress} / 2</small>`;
}
function renderMoves() {
  const focusedMove = document.activeElement?.closest('[data-move]')?.dataset.move;
  const normal = recommend(game.playerRole, game.history);
  $('moves').innerHTML = MOVES.map((name, move) => {
    const free = normal === null || move === normal;
    const disabled = !free && game.playerTokens === 0;
    return `<button class="move-button${selection === move ? ' selected' : ''}${free ? ' normal-move-option' : ''}" data-move="${move}" aria-label="${name}，${free ? normal === null ? '首轮免费' : '正常出招' : '消耗1点伪装'}" aria-pressed="${selection === move}"${disabled ? ' disabled' : ''}><span class="key-hint">${move + 1}</span>${hand(move)}<strong>${name}</strong><small>${free ? normal === null ? '首轮自由' : '正常 · 免费' : disabled ? '伪装不足' : '伪装 −1'}</small></button>`;
  }).join('');
  if (focusedMove !== undefined) $('moves').querySelector(`[data-move="${focusedMove}"]`)?.focus({ preventScroll: true });
  $('round-message').innerHTML = normal === null ? '第一手自由选择。<strong>从第二手起，你的策略将开始留下痕迹。</strong>' : game.playerTokens === 0 ? '你的伪装额度已用尽。<strong>本轮必须按照身份出招。</strong>' : `你的正常招式是 <strong>${MOVES[normal]}</strong>。也可以消耗 1 点伪装，换成另外一招。`;
  const disguised = selection !== null && normal !== null && selection !== normal;
  $('move-hint').classList.toggle('warning', disguised);
  $('move-hint').textContent = selection === null ? normal === null ? '第一回合自由出招，不消耗伪装点。' : 'bot 已锁定这一手。选择行动，再同时揭晓。' : disguised ? `你将花费 1 点伪装，出${MOVES[selection]}。余额 ${game.playerTokens} → ${game.playerTokens - 1}。` : `你将出${MOVES[selection]}，不消耗伪装点。`;
  $('lock-move').disabled = selection === null;
  $('lock-move').innerHTML = selection === null ? '选择一手后锁定 <span>→</span>' : `锁定${MOVES[selection]}${disguised ? ' · 伪装 −1' : ''} <span>→</span>`;
}
function renderDecision() {
  const last = game.history.at(-1);
  const final = game.round === MAX_ROUNDS;
  const accusationAllowed = game.round >= FIRST_ACCUSATION;
  const resultClass = last.outcome === 1 ? 'win' : last.outcome === -1 ? 'loss' : 'draw';
  const resultName = last.outcome === 1 ? '你赢了' : last.outcome === -1 ? 'BOT 赢了' : '平局';
  $('round-message').innerHTML = `<strong>第 ${game.round} 回合已公开。</strong>${last.playerDisguised ? '你使用了 1 点伪装。' : '你没有使用伪装。'}${last.playerRecharge ? '累计赢两手，已补充伪装额度。' : ''}`;
  $('round-reveal').innerHTML = `<div class="reveal-hand">${hand(last.player)}<span>YOU</span><strong>${MOVES[last.player]}</strong></div><div class="reveal-result ${resultClass}"><strong>${resultName}</strong><small>ROUND ${String(game.round).padStart(2, '0')}</small></div><div class="reveal-hand">${hand(last.bot)}<span>BOT</span><strong>${MOVES[last.bot]}</strong></div>`;
  $('decision-copy').innerHTML = !accusationAllowed ? `还有 <strong>${FIRST_ACCUSATION - game.round} 轮</strong>开放指认。现在可以在嫌疑档案中整理线索。` : final ? '<strong>最终研判。</strong>双方都必须提交指认。选中嫌疑身份后，做出你的判断。' : '证据足够了吗？选择嫌疑身份并指认，或继续观察一轮。<strong>bot 也可能在此刻指认你。</strong>';
  $('continue-game').hidden = final;
  $('continue-game').innerHTML = accusationAllowed ? '继续观察 <span>→</span>' : '下一回合 <span>→</span>';
  $('accuse-button').hidden = !accusationAllowed;
  $('accusation-picker').hidden = !accusationAllowed;
  $('accusation-target').innerHTML = `<option value="">选择嫌疑身份</option>${ROLES.map(role => `<option value="${role.id}"${suspect === role.id ? ' selected' : ''}>${role.name} / ${role.english}</option>`).join('')}`;
  $('accuse-button').disabled = !suspect;
  $('accuse-button').innerHTML = suspect ? `指认${roleById(suspect).name} <span>↗</span>` : '选择嫌疑后指认 <span>↗</span>';
  $('decision-warning').textContent = accusationAllowed ? '双方秘密提交，同时结算。指认一旦提交，无法撤回。' : '提示：伪装余额保密，公开出招不一定符合真实身份。';
}
function resultDescription(result) {
  const details = {
    'player-read': '你成功识破了对手，并且保住了自己的身份。',
    'bot-read': 'bot 先一步认出了你的身份。你的行动留下了线索。',
    'player-wrong': '这次指认偏离了真相。对手的伪装奏效了。',
    'bot-wrong': 'bot 做出了错误指认。你成功逃过了它的判断。',
    'both-wrong': '双方都做出了错误指认。这一局，假象压过了证据。',
    'both-correct': game.playerWins === game.botWins ? '双方同时猜中，猜拳胜场也相同。本局平局。' : `双方同时猜中，按猜拳胜场 ${game.playerWins} : ${game.botWins} 决胜。`,
  };
  return details[result.reason];
}
function renderEnded() {
  const result = game.result;
  const type = result.winner === 'player' ? 'win' : result.winner === 'bot' ? 'loss' : 'draw';
  const label = { win: '潜伏成功', loss: '任务失利', draw: '势均力敌' }[type];
  const myGuess = result.playerGuess ? roleById(result.playerGuess).name : '继续观察';
  const botGuess = result.botGuess ? roleById(result.botGuess).name : '继续观察';
  const read = game.reads.at(-1);
  const remaining = read.candidates.filter(c => c.feasible).length;
  $('ended-area').innerHTML = `<div class="end-card ${type}"><span class="outcome-label">MISSION ${type === 'win' ? 'ACCOMPLISHED' : type === 'loss' ? 'COMPROMISED' : 'CLOSED'}</span><h2>${label}</h2><p>${resultDescription(result)}</p><div class="end-identities"><div><small>YOUR IDENTITY</small><strong>${roleById(game.playerRole).name}</strong><span>你指认：${myGuess}${result.playerGuess ? result.playerCorrect ? ' ✓' : ' ×' : ''}</span></div><div><small>BOT IDENTITY</small><strong>${roleById(game.botRole).name}</strong><span>它指认：${botGuess}${result.botGuess ? result.botCorrect ? ' ✓' : ' ×' : ''}</span></div></div><div class="end-detail">第 ${game.round} 回合结案 · 你伪装了 ${game.history.filter(h => h.playerDisguised).length} 次，bot 伪装了 ${game.history.filter(h => h.botDisguised).length} 次。<br>bot 最后还保留 ${remaining} 种可行身份。${remaining > 1 && result.botGuess ? '它在多个候选中选择了判断。' : '下方记录已解除保密，可逐轮复盘。'}</div><div class="difficulty-control end-difficulty"><label for="next-difficulty">下局对手</label><select id="next-difficulty">${Object.entries(DIFFICULTIES).map(([id, value]) => `<option value="${id}"${id === $('difficulty').value ? ' selected' : ''}>${value.name}</option>`).join('')}</select></div><div class="end-actions"><button class="secondary-button" id="view-replay">查看复盘 <span>↓</span></button><button class="primary-button" id="play-again">再次潜伏 <span>↗</span></button></div></div>`;
}
function renderHistory() {
  const history = game?.history ?? [];
  const ended = game?.phase === 'ended';
  $('history-count').textContent = String(history.length).padStart(2, '0');
  $('history-empty').hidden = history.length > 0;
  $('history-table-wrap').hidden = history.length === 0;
  $('history-detail-head').textContent = ended ? '双方伪装' : '你的伪装';
  $('history-hint').textContent = ended ? '保密解除 · 正常招式与伪装已公开' : '公开出招是你唯一的证据';
  $('history-body').innerHTML = [...history].reverse().map(row => {
    const status = row.outcome === 1 ? 'win' : row.outcome === -1 ? 'loss' : 'draw';
    const myNormal = row.playerNormal === null ? '首轮自由' : `正常：${MOVES[row.playerNormal]}`;
    const botNormal = row.botNormal === null ? '首轮自由' : `正常：${MOVES[row.botNormal]}`;
    const note = ended ? `你 ${row.playerBefore} → ${row.playerAfter} · BOT ${row.botBefore} → ${row.botAfter}${row.playerRecharge || row.botRecharge ? ' · 有补充' : ''}` : row.playerRecharge ? '赢满两手 · 伪装补充 +1' : row.round < FIRST_ACCUSATION ? '收集证据' : '可秘密指认';
    return `<tr><td>${String(row.round).padStart(2, '0')}</td><td>${MOVES[row.player]}${ended ? `<br><small>${myNormal}</small>` : ''}</td><td>${MOVES[row.bot]}${ended ? `<br><small>${botNormal}</small>` : ''}</td><td><span class="result-chip ${status}">${row.outcome === 1 ? '你赢' : row.outcome === -1 ? 'BOT 赢' : '平局'}</span></td><td>${ended ? `<span class="${row.playerDisguised ? 'record-camo' : ''}">你 ${row.playerDisguised ? '−1' : '—'}</span> <small>/</small> <span class="${row.botDisguised ? 'record-camo' : ''}">BOT ${row.botDisguised ? '−1' : '—'}</span>` : row.playerDisguised ? '<span class="token-cost">−1 / 已伪装</span>' : '<small>— / 正常</small>'}</td><td><small>${note}</small></td></tr>`;
  }).join('');
}
function render() {
  renderStatus(); renderSuspects(); renderIdentity(); renderHistory();
  $('welcome').hidden = !!game;
  $('active-game').hidden = !game;
  if (game) {
    $('move-area').hidden = game.phase !== 'choose';
    $('decision-area').hidden = game.phase !== 'decision';
    $('ended-area').hidden = game.phase !== 'ended';
    $('round-message').hidden = game.phase === 'ended';
    if (game.phase === 'choose') renderMoves();
    if (game.phase === 'decision') renderDecision();
    if (game.phase === 'ended') renderEnded();
  }
  const total = stats.wins + stats.losses + stats.draws;
  $('local-stats').textContent = total ? `${stats.wins} 胜 / ${stats.losses} 负 / ${stats.draws} 平${stats.best ? ` · 最快成功指认：第 ${stats.best} 回合` : ''}` : '你的第一份行动档案，即将建立。';
}

$('start-game').addEventListener('click', startGame);
$('restart-game').addEventListener('click', askNewGame);
$('lock-move').addEventListener('click', lockMove);
$('continue-game').addEventListener('click', () => finishDecision());
$('accuse-button').addEventListener('click', askAccusation);
$('accusation-target').addEventListener('change', event => {
  suspect = roleById(event.target.value) ? event.target.value : null;
  excluded = excluded.filter(id => id !== suspect);
  save(); renderSuspects(); renderDecision();
});
$('hide-identity').addEventListener('click', () => { identityHidden = !identityHidden; save(); render(); });
$('moves').addEventListener('click', event => {
  const button = event.target.closest('[data-move]');
  if (!button || button.disabled || game?.phase !== 'choose') return;
  selection = Number(button.dataset.move); renderMoves();
});
$('suspects').addEventListener('click', event => {
  const choose = event.target.closest('[data-suspect]');
  const exclude = event.target.closest('[data-exclude]');
  if (choose) {
    const id = choose.dataset.suspect;
    suspect = suspect === id ? null : id;
    excluded = excluded.filter(role => role !== id);
  } else if (exclude) {
    const id = exclude.dataset.exclude;
    excluded = excluded.includes(id) ? excluded.filter(role => role !== id) : [...excluded, id];
    if (suspect === id) suspect = null;
  } else return;
  save(); renderSuspects();
  if (game?.phase === 'decision') renderDecision();
});
$('ended-area').addEventListener('change', event => { if (event.target.id === 'next-difficulty') $('difficulty').value = event.target.value; });
$('ended-area').addEventListener('click', event => {
  if (event.target.closest('#play-again')) startGame();
  if (event.target.closest('#view-replay')) $('history-title').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
});
$('rules-open').addEventListener('click', () => $('rules-dialog').showModal());
document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$('confirm-action').addEventListener('click', () => { const action = confirmation; confirmation = null; $('confirm-dialog').close(); action?.(); });
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
});
document.addEventListener('keydown', event => {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || document.querySelector('dialog[open]') || !game || game.phase !== 'choose') return;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
  if (['1', '2', '3'].includes(event.key)) {
    const move = Number(event.key) - 1;
    const normal = recommend(game.playerRole, game.history);
    if (game.playerTokens === 0 && normal !== null && move !== normal) return;
    event.preventDefault(); selection = move; renderMoves();
  }
  if (event.key === 'Enter' && selection !== null && !(event.target instanceof HTMLButtonElement && !event.target.closest('#move-area'))) { event.preventDefault(); lockMove(); }
});
$('rules-role-list').innerHTML = ROLES.map(role => `<div><b>${role.name}</b><span>${escapeText(role.description)}</span></div>`).join('');
restore();
if (game?.phase === 'ended') recordResult();
render();
