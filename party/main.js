// =====================================================
// RE:ROLL 파티 — 화면 (메인 · 방 · 대기실 · 보드 · 미니게임)
//  - 판정은 전부 서버(server/party.js). 여기는 보여주고, 내가 고른 것만 보냄
//  - 조작: ← → (↑ ↓) 고르기 · Space / Enter 확인
//  - 미니게임은 화면 전체 iframe 으로 열고, 결과(RE_MINIGAME_RESULT)를 받으면 서버로 점수 전송
// =====================================================
import { DICE, SPACES, CHARACTERS, TURN_CHOICES, MAX_PLAYERS } from './shared/rules.js';
import { BoardView, spriteUrl } from './board-view.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NAME_KEY = 'reroll.playerName'; // 미니게임들과 같은 이름 저장소

// ---------------- 화면 크기 ----------------
const stage = $('stage');
const board = new BoardView($('board'), $('minimap'));
$('btn-map').onclick = (e) => { e.currentTarget.blur(); board.toggleOverview(); };
function fit() {
  const s = Math.min(innerWidth / 960, innerHeight / 600);
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  board.setScale(s);
}
addEventListener('resize', fit);
fit();

// ---------------- 열쇠 그림 배경 (픽셀로) ----------------
// 낮은 해상도 캔버스에 그린 뒤 확대 → 도트 느낌. 왼쪽 위 로고가 잘리지 않게 왼쪽 기준으로 자름
const keyart = $('keyart');
{
  const img = new Image();
  img.onload = () => {
    const w = 400, h = 250;
    keyart.width = w; keyart.height = h;
    const g = keyart.getContext('2d');
    const s = Math.max(w / img.width, h / img.height);
    g.imageSmoothingEnabled = true;
    g.drawImage(img, 0, 0, img.width * s, img.height * s);
    // 색 단계를 줄여서 더 도트 그림처럼
    const d = g.getImageData(0, 0, w, h);
    for (let i = 0; i < d.data.length; i += 4) for (let k = 0; k < 3; k++) d.data[i + k] = Math.round(d.data[i + k] / 24) * 24;
    g.putImageData(d, 0, 0);
  };
  img.src = 'assets/keyart.webp';
}

// ---------------- 연결 ----------------
const token = (() => {
  try {
    let t = sessionStorage.getItem('reroll.party.token');
    if (!t) sessionStorage.setItem('reroll.party.token', (t = Math.random().toString(36).slice(2) + Date.now().toString(36)));
    return t;
  } catch (e) { return Math.random().toString(36).slice(2); }
})();
let ws = null, myId = null, room = null;

function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/_party`);
  ws.onopen = () => {
    $('conn').textContent = '서버 연결됨';
    sendMsg({ t: 'hello', token, name: getName() });
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.t === 'welcome') { myId = msg.id; board.myId = myId; if (!myId) show('title'); }
    else if (msg.t === 'room') onRoom(msg);
    else if (msg.t === 'fx') onFx(msg);
    else if (msg.t === 'error') titleMsg(msg.text);
    else if (msg.t === 'left') { room = null; myId = null; closeMinigame(); show('title'); }
  };
  ws.onclose = () => {
    $('conn').textContent = '서버와 연결이 끊김… 다시 연결 중';
    setTimeout(connect, 1500);
  };
}
const sendMsg = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };

// ---------------- 메인 화면 ----------------
// 이 탭에서 정한 이름이 먼저 (한 컴퓨터에서 탭 여러 개로 시험할 때 섞이지 않게)
const getName = () => { try { return (sessionStorage.getItem(NAME_KEY) || localStorage.getItem(NAME_KEY) || '').trim().slice(0, 8); } catch (e) { return ''; } };
const setName = (n) => { try { sessionStorage.setItem(NAME_KEY, n); localStorage.setItem(NAME_KEY, n); } catch (e) { /* 저장 안 됨 */ } };
$('in-name').value = getName();
function titleMsg(t) { $('title-msg').textContent = t; }
function needName() {
  const n = $('in-name').value.trim().slice(0, 8);
  if (!n) { titleMsg('이름을 먼저 정해 주세요'); $('in-name').focus(); return null; }
  setName(n);
  return n;
}
$('btn-create').onclick = () => { const name = needName(); if (name) sendMsg({ t: 'create', name }); };
$('btn-join').onclick = () => {
  const name = needName();
  if (!name) return;
  const code = $('in-code').value.trim();
  if (!/^\d{4}$/.test(code)) { titleMsg('방 번호 4자리를 입력해 주세요'); $('in-code').focus(); return; }
  sendMsg({ t: 'join', name, code });
};
$('in-name').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) $('btn-create').click(); });
$('in-code').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) $('btn-join').click(); });
$('btn-leave').onclick = () => sendMsg({ t: 'leave' });

function show(name) {
  for (const s of ['title', 'lobby', 'game']) $(`scr-${s}`).classList.toggle('hidden', s !== name);
  keyart.classList.toggle('hidden', name === 'game');
  keyart.classList.toggle('dim', name === 'lobby');
  if (name === 'title') setTimeout(() => (getName() ? $('in-code') : $('in-name')).focus(), 0);
}

// ---------------- 상태 받기 ----------------
const me = () => room?.players.find((p) => p.id === myId);
const nameOf = (id) => room?.players.find((p) => p.id === id)?.name || '?';

function onRoom(r) {
  room = r;
  board.state = r;
  board.rolls = r.rolls;
  if (r.phase === 'lobby') { show('lobby'); renderLobby(); closeMinigame(); return; }
  show('game');
  renderHud();
  renderCards();
  renderLog();
  renderMinigame();
  renderPrompt();
  renderMgResult();
  renderEnd();
}

// 친구에게 알려줄 접속 주소 (npm run share 로 열었으면 인터넷 주소)
let shareUrl = '';
fetch('/_party/info').then((r) => r.json()).then((d) => {
  shareUrl = d.publicUrl || (/^(localhost|127\.)/.test(location.hostname) ? '' : location.origin);
  if (shareUrl) $('conn').textContent = `친구 접속 주소: ${shareUrl}`;
  if (room?.phase === 'lobby') renderLobby();
}).catch(() => {});

// ---------------- 대기실 ----------------
function renderLobby() {
  $('lobby-code').textContent = room.code;
  $('lobby-url').innerHTML = shareUrl ? `🌍 친구 접속 주소 <b>${esc(shareUrl)}</b> → 방 번호 입력` : '';
  const seats = [];
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const p = room.players.find((x) => x.seat === s);
    const tag = p ? [p.id === room.host ? '👑 방장' : '', p.id === myId ? '나' : '', p.online ? '' : '연결 끊김'].filter(Boolean).join(' · ') : '빈 자리 → CPU';
    seats.push(`<div class="seat ${p ? '' : 'empty'} ${p && p.id === myId ? 'me' : ''}">
      <img src="${spriteUrl(s)}"><div class="nm">${p ? esc(p.name) : `CPU ${s + 1}`}</div><div class="tag">${tag}</div></div>`);
  }
  $('seats').innerHTML = seats.join('');
  const host = room.host === myId;
  $('turn-pick').innerHTML = `턴 수 ${TURN_CHOICES.map((n) => `<button class="btn ${room.maxTurns === n ? 'sel' : ''}" data-n="${n}" ${host ? '' : 'disabled'}>${n}턴</button>`).join('')}`;
  $('turn-pick').querySelectorAll('button').forEach((b) => (b.onclick = () => sendMsg({ t: 'turns', n: +b.dataset.n })));
  $('lobby-action').innerHTML = host
    ? `<button id="btn-start" class="btn gold">게임 시작 (Enter) · ${room.players.length}명 + CPU ${MAX_PLAYERS - room.players.length}</button>`
    : `<div class="hint">방장(${esc(nameOf(room.host))})이 시작하기를 기다리는 중…</div>`;
  if (host) $('btn-start').onclick = () => sendMsg({ t: 'start' });
}

// ---------------- 보드 HUD ----------------
const STEP_TEXT = { choose: '주사위 고르는 중', reveal: '주사위 결과!', move: '이동 중', space: '칸 효과', minigame: '미니게임 중', mgResult: '미니게임 결과' };
function renderHud() {
  const m = me();
  $('hud-top').innerHTML = `<span class="chip">방 <b>${room.code}</b></span>
    <span class="chip round">${room.phase === 'end' ? 'FINISH' : `ROUND ${room.turn}/${room.maxTurns}`}<small>${STEP_TEXT[room.step] || (room.phase === 'end' ? '게임 끝' : '')}</small></span>
    <span class="chip">${m ? `🏁 결승까지 <b>${m.dist}</b>칸` : '관전 중'}</span>`;
}

function renderCards() {
  const promptsBy = new Map(room.prompts.map((p) => [p.pid, p]));
  $('cards').innerHTML = [...room.players].sort((a, b) => a.seat - b.seat).map((p) => {
    const bag = p.bag.map((id) => `<span class="${DICE[id].kind}" title="${esc(DICE[id].name)} · ${esc(DICE[id].desc)}">${DICE[id].icon}</span>`).join('');
    const f = p.flags || {};
    const flags = [f.skip ? '😵 쉼' : '', f.mirror ? '🪞 거울' : '', f.rest ? '☕ 보상2배' : '', f.shield ? '🔰' : ''].filter(Boolean).join(' ');
    const r = room.step === 'reveal' && room.rolls[p.id];
    const roll = r ? `<div class="roll ${r.skip ? 'skip' : ''}">${esc(r.text)}</div>` : '';
    const doing = promptsBy.has(p.id) ? '<div class="doing">고르는 중…</div>' : room.mg && room.step === 'minigame' ? `<div class="doing">${room.mg.done.includes(p.id) || p.cpu ? '✅' : '🎮'}</div>` : '';
    return `<div class="card ${p.id === myId ? 'me' : ''} ${p.online ? '' : 'off'}">
      ${roll}${doing}
      <div class="head" style="background:${CHARACTERS[p.seat].color}">${esc(p.name)}${p.id === myId ? ' · 나' : ''}</div>
      <img class="face" src="${spriteUrl(p.seat)}">
      <div class="info">${p.dist === 0 ? '🏆 도착!' : `결승까지 ${p.dist}칸`}${p.cpu ? ' · CPU' : p.online ? '' : ' · 끊김'}</div>
      <div class="bag">${bag || '<small style="color:var(--sub)">주사위 없음</small>'}</div>
      <div class="flags">${flags}</div></div>`;
  }).join('');
}

function renderLog() {
  $('log').innerHTML = room.log.map((l) => `<div>${esc(l)}</div>`).join('');
}

// 칸에 마우스를 올리면 설명
board.onHover = (h) => {
  const tip = $('tip');
  if (!h) return tip.classList.add('hidden');
  const sp = SPACES[h.node.type];
  const sb = stage.getBoundingClientRect();
  const s = sb.width / 960;
  tip.innerHTML = `<b>${sp.icon} ${esc(sp.name)}</b><br>${esc(sp.desc)}`;
  tip.style.left = `${(h.px - sb.left) / s + 24}px`;
  tip.style.top = `${(h.py - sb.top) / s - 20}px`;
  tip.classList.remove('hidden');
};

// ---------------- 알림 ----------------
let bigTimer = null;
function onFx(fx) {
  if (fx.kind !== 'announce') return;
  board.spotlight(fx.pid); // 효과 받는 사람을 카메라가 비춤
  if (fx.big) {
    const el = $('big');
    el.innerHTML = `${fx.icon ? `<span class="ic">${fx.icon}</span>` : ''}${esc(fx.text)}`;
    el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(bigTimer);
    bigTimer = setTimeout(() => el.classList.add('hidden'), 1700);
  } else {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = `${fx.icon ? fx.icon + ' ' : ''}${fx.text}`;
    $('toasts').append(t);
    setTimeout(() => t.remove(), 2600);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  }
}

// ---------------- 내가 고를 것 ----------------
let cur = null; // { id, kind, options, sel, deadline }
let timingVal = 1, timingTimer = null;

function renderPrompt() {
  const pr = room.prompts.find((p) => p.pid === myId);
  const el = $('prompt');
  board.branch = null;
  board.targets = null;
  if (!pr || mgOpen()) {
    cur = null;
    el.classList.add('hidden');
    stopTiming();
    return;
  }
  if (!cur || cur.id !== pr.id) {
    cur = { ...pr, sel: 0 };
    if (pr.kind === 'timing') startTiming();
    else stopTiming();
  }
  el.classList.remove('hidden');
  drawPrompt();
}

function drawPrompt() {
  const el = $('prompt');
  const pr = cur;
  if (pr.kind === 'branch') board.branch = { options: pr.options.map((o) => o.value), sel: pr.sel };
  if (pr.kind === 'target') board.targets = { ids: pr.options.map((o) => o.value), sel: pr.sel };
  let body;
  if (pr.kind === 'timing') {
    body = `<div class="timing" id="timing-num">${timingVal}</div><div class="keys">Space 로 멈춰요</div>`;
  } else {
    body = `<div class="opts">${pr.options.map((o, i) => {
      const icon = o.icon || (pr.kind === 'target' ? `<img src="${spriteUrl(o.seat ?? 0)}" style="width:32px;image-rendering:pixelated">` : pr.kind === 'branch' ? (i === 0 ? '⬆️' : '⬇️') : '');
      return `<div class="opt ${i === pr.sel ? 'sel' : ''}" data-i="${i}"><span class="ic">${icon}</span><span class="lb">${esc(o.label)}</span>${o.desc ? `<span class="ds">${esc(o.desc)}</span>` : ''}</div>`;
    }).join('')}</div><div class="keys">← → 고르기 · Space 확인</div>`;
  }
  el.innerHTML = `<div class="ttl">${esc(pr.title)}</div>${body}<div class="bar" id="prompt-bar"></div>`;
  el.querySelectorAll('.opt').forEach((o) => (o.onclick = () => { cur.sel = +o.dataset.i; confirmPrompt(); }));
}

function confirmPrompt() {
  if (!cur) return;
  const value = cur.kind === 'timing' ? timingVal : cur.options[cur.sel]?.value;
  sendMsg({ t: 'answer', id: cur.id, value });
  stopTiming();
  $('prompt').classList.add('hidden');
  board.branch = null;
  board.targets = null;
  cur = { ...cur, sent: true };
}

function startTiming() {
  stopTiming();
  timingVal = 1;
  timingTimer = setInterval(() => {
    timingVal = (timingVal % 10) + 1;
    const n = $('timing-num');
    if (n) n.textContent = timingVal;
  }, 70);
}
function stopTiming() { clearInterval(timingTimer); timingTimer = null; }

// 남은 시간 막대
setInterval(() => {
  if (!cur || cur.sent) return;
  const bar = $('prompt-bar');
  if (!bar) return;
  const total = Math.max(1, cur.deadline - (cur.shownAt ||= Date.now()));
  bar.style.width = `${Math.max(0, Math.min(100, ((cur.deadline - Date.now()) / total) * 100))}%`;
}, 200);

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (room?.phase === 'lobby' && (e.code === 'Enter' || e.code === 'Space') && room.host === myId) { e.preventDefault(); sendMsg({ t: 'start' }); return; }
  if (room?.phase === 'end' && e.code === 'Enter' && room.host === myId) { sendMsg({ t: 'lobby' }); return; }
  if (room?.phase === 'play' && (e.code === 'KeyZ' || e.code === 'KeyM') && !mgOpen()) { board.toggleOverview(); return; }
  if (!cur || cur.sent || mgOpen()) return;
  const n = cur.options?.length || 0;
  if (cur.kind === 'parity' && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) { cur.sel = e.code === 'ArrowUp' ? 0 : 1; confirmPrompt(); return; }
  if (['ArrowLeft', 'ArrowUp'].includes(e.code) && n) { cur.sel = (cur.sel - 1 + n) % n; drawPrompt(); e.preventDefault(); }
  else if (['ArrowRight', 'ArrowDown'].includes(e.code) && n) { cur.sel = (cur.sel + 1) % n; drawPrompt(); e.preventDefault(); }
  else if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (!e.repeat) confirmPrompt(); }
});

// ---------------- 미니게임 ----------------
let mgSeed = null, mgSent = false, mgIntroTimer = null;
const mgOpen = () => !$('mg').classList.contains('hidden');

function renderMinigame() {
  const mg = room.mg;
  if (!mg || room.step !== 'minigame') { closeMinigame(); return; }
  const m = me();
  if (!m) return;
  $('mg').classList.remove('hidden');
  if (mgSeed !== mg.seed) {
    // 새 미니게임 → 소개 화면 → 시작 시각에 열기
    mgSeed = mg.seed;
    mgSent = mg.done.includes(myId);
    const frame = $('mg-frame');
    frame.classList.add('hidden');
    frame.src = 'about:blank';
    $('mg-wait').classList.add('hidden');
    const intro = $('mg-intro');
    intro.classList.remove('hidden');
    clearInterval(mgIntroTimer);
    const tick = () => {
      const left = Math.ceil((mg.startAt - Date.now()) / 1000);
      intro.innerHTML = `<div class="sub">다 같이 미니게임!</div><div class="nm">${esc(mg.name)}</div>
        <div class="cd">${left > 0 ? left : 'GO!'}</div><div class="sub" style="color:var(--sub)">순위대로 특수 주사위를 받아요 · 1위는 골라서!</div>`;
      if (left <= 0) {
        clearInterval(mgIntroTimer);
        if (!mgSent) openFrame(mg, m);
      }
    };
    tick();
    mgIntroTimer = setInterval(tick, 250);
  }
  if (mgSent) showMgWait();
}

function openFrame(mg, m) {
  const q = new URLSearchParams({ mode: 'personal', autostart: '1', embed: '1', char: String(m.seat + 1), name: m.name, seed: String(mg.seed), net: '0' });
  const frame = $('mg-frame');
  frame.src = `/${mg.id}/?${q}`;
  frame.classList.remove('hidden');
  $('mg-intro').classList.add('hidden');
  // 미니게임이 열리면 키보드를 미니게임으로 (빈 페이지로 바꿀 때는 가져가지 않게)
  frame.onload = () => { if (frame.src.includes('mode=') && !frame.classList.contains('hidden')) frame.contentWindow?.focus(); };
  setTimeout(() => { if (!frame.classList.contains('hidden')) frame.contentWindow?.focus(); }, 300);
}

function showMgWait() {
  const el = $('mg-wait');
  const left = room.players.filter((p) => !p.cpu && p.online && !room.mg.done.includes(p.id));
  el.innerHTML = `<div>✅ 결과 보냄! 다른 사람 기다리는 중…</div>
    <div class="who">${left.length ? `아직 하는 중: ${left.map((p) => esc(p.name)).join(', ')}` : '곧 결과가 나와요'}</div>
    ${room.host === myId && left.length ? '<button class="btn dim" id="btn-skipmg">기다리지 않고 진행 (방장)</button>' : ''}`;
  el.classList.remove('hidden');
  const b = $('btn-skipmg');
  if (b) b.onclick = () => sendMsg({ t: 'skipGame' });
}

// 미니게임 창에 있던 키보드 입력을 보드로 되돌림 (안 하면 방향키 · Space 가 빈 iframe 으로 감)
stage.tabIndex = -1;
function focusBoard() {
  $('mg-frame').blur();
  window.focus();
  stage.focus({ preventScroll: true });
}

function closeMinigame() {
  clearInterval(mgIntroTimer);
  if (!mgOpen()) return;
  $('mg').classList.add('hidden');
  $('mg-frame').src = 'about:blank';
  mgSeed = null;
  focusBoard();
}

// 미니게임이 끝나면 결과가 옴 → 내 점수 보내기 (결과 화면은 잠깐 보여줌)
addEventListener('message', (e) => {
  if (e.data?.type !== 'RE_MINIGAME_RESULT' || !room?.mg || mgSent) return;
  if (e.source !== $('mg-frame').contentWindow) return;
  const rows = e.data.result?.ranking || [];
  const mine = rows.find((r) => r.cpu === false) || rows[0];
  mgSent = true;
  sendMsg({ t: 'result', score: +mine?.score || 0 });
  setTimeout(() => {
    if (!room?.mg) return;
    $('mg-frame').classList.add('hidden');
    $('mg-frame').src = 'about:blank';
    focusBoard();
    showMgWait();
  }, 3000);
});

// ---------------- 미니게임 결과 · 게임 끝 ----------------
function renderMgResult() {
  const el = $('mgresult');
  const r = room.mgResult;
  if (!r || room.step !== 'mgResult') return el.classList.add('hidden');
  el.innerHTML = `<div class="panel"><h2>🎮 ${esc(r.name)} 결과</h2>${r.rows.map((x) => {
    const p = room.players.find((pp) => pp.id === x.id);
    return `<div class="rank-row ${x.id === myId ? 'me' : ''}"><span class="rk">${x.rank}위</span><img src="${spriteUrl(p?.seat ?? 0)}">
      <span class="nm">${esc(x.name)}</span><span class="sc">${x.score}</span><span class="rw">${x.reward.map((d) => DICE[d].icon).join(' ') || '·'}</span></div>`;
  }).join('')}<div class="hint" style="margin-top:10px">1위: 재밌는 주사위 골라서 · 2위: 재밌는 주사위 · 3위: 보통 주사위</div></div>`;
  el.classList.remove('hidden');
}

function renderEnd() {
  const el = $('end');
  if (room.phase !== 'end' || !room.ranking) return el.classList.add('hidden');
  const host = room.host === myId;
  el.innerHTML = `<div class="panel"><h2>🏆 ${esc(room.ranking[0].name)} 우승!</h2>${room.ranking.map((x) => `
    <div class="rank-row ${x.id === myId ? 'me' : ''}"><span class="rk">${x.rank}위</span><img src="${spriteUrl(x.seat)}">
    <span class="nm">${esc(x.name)}${x.cpu ? ' <small style="color:var(--sub)">CPU</small>' : ''}</span><span class="sc">${x.dist === 0 ? '도착!' : `${x.dist}칸 남음`}</span></div>`).join('')}
    <div style="margin-top:16px">${host ? '<button class="btn gold" id="btn-again">대기실로 (Enter)</button>' : '<span class="hint">방장이 대기실로 돌아갈 수 있어요</span>'}
    <button class="btn dim" id="btn-quit">나가기</button></div></div>`;
  el.classList.remove('hidden');
  if (host) $('btn-again').onclick = () => sendMsg({ t: 'lobby' });
  $('btn-quit').onclick = () => sendMsg({ t: 'leave' });
}

show('title');
connect();
