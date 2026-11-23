// =====================================================
// RE:ROLL 파티 — 화면 (메인 · 방 · 대기실 · 보드 · 미니게임)
//  - 판정은 전부 서버(server/party.js). 여기는 보여주고, 내가 고른 것만 보냄
//  - 조작: ← → (↑ ↓) 고르기 · Space / Enter 확인
//  - 미니게임은 화면 전체 iframe 으로 열고, 결과(RE_MINIGAME_RESULT)를 받으면 서버로 점수 전송
// =====================================================
import { DICE, SPACES, CHARACTERS, TURN_CHOICES, MAX_PLAYERS } from './shared/rules.js';
import { BoardView, spriteUrl } from './board-view.js';
import { playIntro, playEndingFilm, animate, drawGoodEnding, drawBadEnding } from './story.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NAME_KEY = 'reroll.playerName'; // 미니게임들과 같은 이름 저장소

// ---------------- 화면 크기 ----------------
const stage = $('stage');
const board = new BoardView($('board'), $('minimap'));
$('btn-map').onclick = (e) => { e.currentTarget.blur(); board.toggleOverview(); };
// ---------------- 열쇠 그림 배경 (원본 화질 그대로) ----------------
// 화면에 실제로 보이는 크기(픽셀)만큼의 캔버스에 그린다 → 확대해서 뭉개지는 일이 없다.
// 왼쪽 위 로고가 잘리지 않게 왼쪽 위 기준으로 자른다.
const keyart = $('keyart');
const keyartImg = new Image();
function drawKeyart(scale) {
  if (!keyartImg.naturalWidth) return;
  const ratio = scale * (window.devicePixelRatio || 1);
  // 원본보다 크게 그려 봐야 더 선명해지지 않으므로 원본 크기까지만
  const cover = Math.max(960 / keyartImg.naturalWidth, 600 / keyartImg.naturalHeight);
  const r = Math.min(ratio, 1 / cover);
  const w = Math.max(1, Math.round(960 * r)), h = Math.max(1, Math.round(600 * r));
  if (keyart.width !== w || keyart.height !== h) { keyart.width = w; keyart.height = h; }
  const g = keyart.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(keyartImg, 0, 0, keyartImg.naturalWidth * cover * r, keyartImg.naturalHeight * cover * r);
}

function fit() {
  const s = Math.min(innerWidth / 960, innerHeight / 600);
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  board.setScale(s);
  drawKeyart(s);
}
addEventListener('resize', fit);
fit();
keyartImg.onload = fit;
keyartImg.src = 'assets/keyart.webp';

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
// demoSend 가 있으면(?demo=boss-play 시연) 서버 대신 그 함수가 메시지를 받는다
let demoSend = null;
const sendMsg = (m) => { if (demoSend) return demoSend(m); if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };

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
  if (!/^\d{6}$/.test(code)) { titleMsg('팀 코드 6자리를 입력해 주세요'); $('in-code').focus(); return; }
  sendMsg({ t: 'join', name, code });
};
$('in-name').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) $('btn-create').click(); });
$('in-code').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) $('btn-join').click(); });
$('btn-leave').onclick = () => sendMsg({ t: 'leave' });

// 스토리보드 1 → 2 → 3: "시작하려면 터치하세요" → 인트로(SKIP 가능) → 팀 코드 입력
// 인트로는 이 탭에서 한 번만 본다 (대기실에서 나왔을 때 또 나오지 않게)
const INTRO_KEY = 'reroll.party.introSeen';
let introSeen = (() => { try { return sessionStorage.getItem(INTRO_KEY) === '1'; } catch (e) { return false; } })();
let stopIntro = null;
function startIntro() {
  if (introSeen || stopIntro) return;
  show('intro');
  stopIntro = playIntro({
    root: $('scr-intro'), canvas: $('intro-cv'),
    film: $('film'), video: $('intro-video'), filmSkip: $('btn-skip-film'), loading: $('film-loading'),
    title: $('intro-ttl'), text: $('intro-txt'), dots: $('intro-dots'), skip: $('btn-skip'),
  }, () => {
    stopIntro = null;
    introSeen = true;
    try { sessionStorage.setItem(INTRO_KEY, '1'); } catch (e) { /* 저장 안 됨 */ }
    show('title');
  });
}
$('scr-title').addEventListener('click', () => { if (!introSeen) startIntro(); });

let screenName = '';
function show(name) {
  if (name !== 'intro' && stopIntro) { stopIntro(); stopIntro = null; }   // 인트로 중에 방에 다시 들어가졌으면 멈춤
  screenName = name;
  for (const s of ['title', 'intro', 'lobby', 'game']) $(`scr-${s}`).classList.toggle('hidden', s !== name);
  keyart.classList.toggle('hidden', name === 'game' || name === 'intro');
  keyart.classList.toggle('dim', name === 'lobby');
  if (name === 'title') {
    $('touch').classList.toggle('hidden', introSeen);
    $('entry').classList.toggle('hidden', !introSeen);
    $('scr-title').classList.toggle('wait', !introSeen);
    if (introSeen) setTimeout(() => (getName() ? $('in-code') : $('in-name')).focus(), 0);
  }
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
  renderRank();
  renderBoss();
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
  $('lobby-ttl').textContent = `팀 대기실 (${room.players.length}/${MAX_PLAYERS})`;
  $('lobby-url').innerHTML = shareUrl ? `🌍 친구 접속 주소 <b>${esc(shareUrl)}</b> → 팀 코드 입력` : '';
  const seats = [];
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const p = room.players.find((x) => x.seat === s);
    const tag = p ? [p.id === room.host ? '👑 방장' : '', p.id === myId ? '나' : '', p.online ? '' : '연결 끊김'].filter(Boolean).join(' · ') : '눌러서 고르기';
    seats.push(`<div class="seat ${p ? '' : 'empty'} ${p && p.id === myId ? 'me' : ''}" data-seat="${s}" ${p ? '' : 'tabindex="0" role="button"'}>
      <img src="${spriteUrl(s)}"><div class="nm">${p ? esc(p.name) : `CPU ${s + 1}`}</div>
      ${p ? `<div class="rd ${p.ready ? 'ok' : ''}">${p.ready ? '✔ 준비 완료' : '준비 중…'}</div>` : ''}<div class="tag">${tag}</div></div>`);
  }
  $('seats').innerHTML = seats.join('');
  // 캐릭터 고르기: 아무도 안 고른 캐릭터를 누르면 내 캐릭터가 그걸로 바뀐다
  $('seats').querySelectorAll('.seat.empty').forEach((el) => {
    el.onclick = () => sendMsg({ t: 'seat', seat: +el.dataset.seat });
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); el.onclick(); } };
  });
  const host = room.host === myId;
  // 턴 수: 6 · 10 · 15턴 또는 무제한(0 = 누군가 결승에 도착할 때까지)
  $('turn-pick').innerHTML = `턴 수 ${[...TURN_CHOICES, 0].map((n) => `<button class="btn ${room.maxTurns === n ? 'sel' : ''}" data-n="${n}" ${host ? '' : 'disabled'}>${n ? `${n}턴` : '무제한'}</button>`).join('')}`;
  $('turn-pick').querySelectorAll('button').forEach((b) => (b.onclick = () => sendMsg({ t: 'turns', n: +b.dataset.n })));
  // 스토리보드 3: 전원 준비 완료 시 시작. 방장은 늘 준비된 것으로 보고, 남는 자리는 CPU 가 채운다.
  const waiting = room.players.filter((p) => !p.ready).length;
  const cpus = MAX_PLAYERS - room.players.length;
  const mine = me();
  $('lobby-action').innerHTML = host
    ? `<button id="btn-start" class="btn gold" ${waiting ? 'disabled' : ''}>${waiting
      ? `준비를 기다리는 중… (${room.players.length - waiting}/${room.players.length})`
      : `▶ 전원 준비 완료! 게임 시작! (Enter)${cpus ? ` · CPU ${cpus}` : ''}`}</button>`
    : `<button id="btn-ready" class="btn ${mine?.ready ? 'dim' : 'gold'}">${mine?.ready ? '준비 취소 (Space)' : '✔ 준비 완료 (Space)'}</button>
       <div class="hint">${waiting ? '모두 준비하면 방장이 시작해요' : `방장(${esc(nameOf(room.host))})이 시작하기를 기다리는 중…`}</div>`;
  if (host) $('btn-start').onclick = () => sendMsg({ t: 'start' });
  else $('btn-ready').onclick = toggleReady;
}
function toggleReady() { sendMsg({ t: 'ready', on: !me()?.ready }); }

// ---------------- 보드 HUD ----------------
const STEP_TEXT = { choose: '주사위 고르는 중', reveal: '주사위 결과!', move: '이동 중', space: '칸 효과', minigame: '미니게임 중', mgResult: '미니게임 결과', final: '최종 결과 집계', boss: '보스전!' };
const pts = (n) => Number(n || 0).toLocaleString('en-US');   // 1250 → 1,250
function renderHud() {
  const m = me();
  $('hud-top').innerHTML = `<span class="chip">방 <b>${room.code}</b></span>
    <span class="chip round">${room.phase === 'end' ? 'FINISH' : `ROUND ${room.turn}${room.maxTurns ? `/${room.maxTurns}` : ''}`}<small>${STEP_TEXT[room.step] || (room.phase === 'end' ? '게임 끝' : '')}</small></span>
    <span class="chip">${m ? `⭐ <b>${pts(m.score)}</b>점 · 🏁 ${m.dist}칸` : '관전 중'}</span>`;
}

// 스토리보드 4: 현재 순위 (누적 점수 = 미니게임 순위 점수 + 전진한 칸 × 10)
function renderRank() {
  const rows = [...room.players].sort((a, b) => b.score - a.score || a.dist - b.dist);
  $('rankbox').innerHTML = `<div class="ttl">👑 현재 순위 (누적 점수)</div>${rows.map((p, i) => `
    <div class="rr ${i === 0 ? 'top' : ''} ${p.id === myId ? 'me' : ''}"><span class="no">${i + 1}</span><img src="${spriteUrl(p.seat)}">
    <span class="nm">${esc(p.name)}</span><span class="sc">${pts(p.score)}점</span></div>`).join('')}`;
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
      <div class="info"><b>${pts(p.score)}점</b> · ${p.dist === 0 ? '🏆 도착!' : `🏁 ${p.dist}칸`}${p.cpu ? ' · CPU' : p.online ? '' : ' · 끊김'}</div>
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
  el.classList.toggle('low', room.step === 'boss');   // 보스전에서는 대결 화면을 가리지 않게 아래로
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
  if (screenName === 'title' && !introSeen && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); startIntro(); return; }
  if (room?.phase === 'lobby' && (e.code === 'Enter' || e.code === 'Space')) {
    e.preventDefault();
    if (e.repeat) return;
    if (room.host === myId) sendMsg({ t: 'start' }); else toggleReady();
    return;
  }
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
let mgMode = null;   // 지금 열어 둔 미니게임 창의 방식: 허브 이름(서버 판정) 또는 'solo'(혼자 · 시험용 봇)
const mgModeOf = (mg) => mg.hub || (mg.solo ? 'solo' : '');
const mgOpen = () => !$('mg').classList.contains('hidden');

function renderMinigame() {
  const mg = room.mg;
  if (!mg || room.step !== 'minigame') { closeMinigame(); return; }
  const m = me();
  if (!m) return;
  $('mg').classList.remove('hidden');
  board.paused = true;    // 미니게임이 화면을 다 가리는 동안 보드는 그리지 않는다 (미니게임이 끊기지 않게)
  if (mgSeed !== mg.seed) {
    // 새 미니게임 → 소개 화면 → 시작 시각에 열기
    mgSeed = mg.seed;
    mgMode = null;
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
        // 서버가 방식(허브 이름 또는 혼자 하는 판)을 알려 줄 때까지는 기다린다
        const now = room && room.mg && room.mg.seed === mg.seed ? room.mg : mg;
        if (!mgSent && !mgModeOf(now)) return;
        clearInterval(mgIntroTimer);
        if (!mgSent) openFrame(now, m);
      }
    };
    tick();
    mgIntroTimer = setInterval(tick, 250);
  }
  // 서버가 방식을 바꿨으면(사람이 모자라 혼자 하는 판으로 전환 등) 창을 다시 연다
  if (!mgSent && mgMode !== null && mgModeOf(mg) && mgModeOf(mg) !== mgMode) openFrame(mg, m);
  if (mgSent) showMgWait();
}

function openFrame(mg, m) {
  // 미니게임은 같은 서버의 미니게임 화면(/)을 내장 모드로 연다.
  //   mg.hub 가 있으면: 이 방 사람들만 모이는 허브에 접속 → 서버가 게임을 시작하고 순위를 판정한다
  //   없으면(혼자일 때): 시험용 봇과 한 판 하고 내 점수를 보낸다
  const character = CHARACTERS[m.seat].sprite || CHARACTERS[m.seat].id;
  const q = mg.hub
    ? new URLSearchParams({ embed: '1', room: mg.hub, name: m.name, tag: token, character })
    : new URLSearchParams({ embed: '1', local: '3', game: mg.id, name: m.name });
  mgMode = mgModeOf(mg);
  const frame = $('mg-frame');
  frame.src = `/?${q}`;
  frame.classList.remove('hidden');
  $('mg-intro').classList.add('hidden');
  // 미니게임이 열리면 키보드를 미니게임으로 (빈 페이지로 바꿀 때는 가져가지 않게)
  frame.onload = () => { if (frame.src.includes('embed=') && !frame.classList.contains('hidden')) frame.contentWindow?.focus(); };
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
  board.paused = false;
  clearInterval(mgIntroTimer);
  if (!mgOpen()) return;
  $('mg').classList.add('hidden');
  $('mg-frame').src = 'about:blank';
  mgSeed = null;
  mgMode = null;
  focusBoard();
}

// 서버 판정 미니게임이 끝났다(순위는 서버가 이미 보드로 넘겼다) → 창을 닫고 결과를 기다린다
addEventListener('message', (e) => {
  if (e.data?.type !== 'RE_PARTY_END' || !room?.mg || mgSent) return;
  if (e.source !== $('mg-frame').contentWindow || !room.mg.hub) return;
  mgSent = true;
  $('mg-frame').classList.add('hidden');
  $('mg-frame').src = 'about:blank';
  focusBoard();
  showMgWait();
});

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
      <span class="nm">${esc(x.name)}</span><span class="sc">${x.score}</span><span class="pt">+${pts(x.points)}점</span><span class="rw">${x.reward.map((d) => DICE[d].icon).join(' ') || '·'}</span></div>`;
  }).join('')}<div class="hint" style="margin-top:10px">순위 점수가 누적 점수에 더해져요 · 1~3위는 특수 주사위도!</div></div>`;
  el.classList.remove('hidden');
}

// 스토리보드 5: 최종 결과 집계 (누적 점수 순위) → "최종 1위! 보스전 진출!"
const rankRows = () => room.ranking.map((x) => `
  <div class="rank-row ${x.id === myId ? 'me' : ''}"><span class="rk">${x.rank}위</span><img src="${spriteUrl(x.seat)}">
  <span class="nm">${esc(x.name)}${x.cpu ? ' <small style="color:var(--sub)">CPU</small>' : ''}</span><span class="sc">${pts(x.score)}점</span></div>`).join('');

let stopEnding = null, endingShown = null;
// 엔딩 영상(해피 · 배드)은 한 판에 한 번만 튼다. 영상이 끝나면 그 뒤에 엔딩 화면(순위 · 버튼)이 보인다.
let endingFilmFor = null, stopEndingFilm = null;
function renderEnd() {
  const el = $('end'), ending = $('ending');
  const host = room.host === myId;
  const buttons = `${host ? '<button class="btn gold" id="btn-again">대기실로 (Enter)</button>' : '<span class="hint">방장이 대기실로 돌아갈 수 있어요</span>'}
    <button class="btn dim" id="btn-quit">나가기</button>`;
  const wire = () => {
    if (host) $('btn-again').onclick = () => sendMsg({ t: 'lobby' });
    $('btn-quit').onclick = () => sendMsg({ t: 'leave' });
  };
  // 엔딩 그림은 한 번만 켠다 (상태가 올 때마다 다시 그리면 깜빡임)
  const showEnding = room.phase === 'end' && room.ranking && (room.ending === 'good' || room.ending === 'bad');
  if (!showEnding && stopEnding) { stopEnding(); stopEnding = null; endingShown = null; }
  if (!showEnding) {
    if (stopEndingFilm) { stopEndingFilm(); stopEndingFilm = null; }
    endingFilmFor = null;
  } else if (endingFilmFor !== room.ending) {
    endingFilmFor = room.ending;
    if (stopEndingFilm) stopEndingFilm();
    stopEndingFilm = playEndingFilm(
      { film: $('film'), video: $('intro-video'), filmSkip: $('btn-skip-film'), loading: $('film-loading') },
      room.ending, () => { stopEndingFilm = null; });
  }
  ending.classList.toggle('hidden', !showEnding);

  if (room.phase === 'play' && room.step === 'final' && room.ranking) {
    el.innerHTML = `<div class="panel"><h2>🏆 최종 랭킹</h2>${rankRows()}
      <div class="banner">최종 1위 ${esc(room.ranking[0].name)}! 보스전 진출!</div></div>`;
    return el.classList.remove('hidden');
  }
  if (room.phase !== 'end' || !room.ranking) return el.classList.add('hidden');
  if (!showEnding) {   // 엔딩 없이 끝난 경우(오류로 중단): 순위만
    el.innerHTML = `<div class="panel"><h2>🏆 ${esc(room.ranking[0].name)} 최종 1위!</h2>${rankRows()}<div style="margin-top:16px">${buttons}</div></div>`;
    el.classList.remove('hidden');
    return wire();
  }
  // 스토리보드 6 · 7: 보스전에서 이기면 굿엔딩, 지면 배드엔딩
  el.classList.add('hidden');
  const good = room.ending === 'good';
  const hero = room.ranking[0];
  if (endingShown !== room.ending) {
    if (stopEnding) stopEnding();
    stopEnding = animate($('ending-cv'), good ? drawGoodEnding : drawBadEnding);
    endingShown = room.ending;
  }
  const line = room.boss?.line ? `<div class="bubble">🧙 ${esc(room.boss.line)}${room.boss.lineSource === 'gemini' ? '<small>AI</small>' : ''}</div>` : '';
  $('ending-body').innerHTML = `
    <div class="ending-ttl"><small>${good ? 'GOOD ENDING' : 'BAD ENDING'}</small>${good ? '저주가 풀렸어요!' : '마법사의 승리…'}</div>
    <div class="ending-txt">${good
      ? `${esc(hero.name)}의 활약으로 마을 사람들이 다시 사람으로 돌아왔어요!`
      : '마법사는 다음 판을 준비하며 새로운 수호자들을 기다립니다.'}</div>
    ${line}
    <div class="ending-mid">${good ? '' : '<div class="wizard-pic"></div>'}<div class="panel ending-rank">${rankRows()}</div></div>
    <div class="ending-btns">${buttons}</div>`;
  wire();
}

// 보스전: 최종 1위 vs 마법사 주사위 대결 (서버 story.py 가 판정, 여기서는 보여 주기만)
function renderBoss() {
  const el = $('boss'), b = room.boss;
  if (!b || room.step !== 'boss' || room.phase !== 'play') return el.classList.add('hidden');
  const hero = room.players.find((p) => p.id === b.hero);
  const last = b.last;
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(Math.max(0, b.need - n));
  const msg = b.stage === 'intro' ? '주사위 대결! 먼저 2판을 이기면 승리'
    : b.stage === 'roll' ? (b.hero === myId ? 'Space 로 주사위를 멈춰요!' : `${esc(hero?.name || '?')}에게 응원을 보내요! (Space)`)
    : !last ? ''
    : last.winner === 'hero' ? `${esc(hero?.name || '?')} 승리!` : last.winner === 'wizard' ? '마법사 승리…' : '비겼다! RE:ROLL!';
  el.innerHTML = `<div class="boss-box">
    <div class="boss-ttl">🧙 보스전 · 마법사의 성</div>
    <div class="boss-sub">수호자: 타이밍 주사위(1~10) + 응원 1명당 +1 · 마법사: 주사위(1~10) + 저주의 힘 ${b.bonus}</div>
    <div class="boss-row">
      <div class="boss-side ${last?.winner === 'hero' ? 'win' : ''}"><div class="pic"><img src="${spriteUrl(hero?.seat ?? 0)}"></div>
        <div class="nm">${esc(hero?.name || '?')}${b.hero === myId ? ' · 나' : ''}</div><div class="wins">${stars(b.heroWins)}</div>
        <div class="die">${last ? last.heroTotal : '?'}</div><div class="plus">${last ? `주사위 ${last.heroDie} + 응원 ${last.cheers}` : ''}</div></div>
      <div class="boss-vs">VS<small>${b.round ? `${b.round}판` : '준비'}</small></div>
      <div class="boss-side wiz ${last?.winner === 'wizard' ? 'win' : ''}"><div class="pic"><div class="wizard-pic"></div></div>
        <div class="nm">마법사</div><div class="wins">${stars(b.wizWins)}</div>
        <div class="die">${last ? last.wizardTotal : '?'}</div><div class="plus">${last ? `주사위 ${last.wizardDie} + 저주 ${b.bonus}` : ''}</div></div>
    </div>
    ${b.line ? `<div class="bubble">🧙 ${esc(b.line)}${b.lineSource === 'gemini' ? '<small>AI</small>' : ''}</div>` : ''}
    <div class="boss-msg">${msg}</div></div>`;
  el.classList.remove('hidden');
}

// ---------------- 화면 미리 보기 (발표 · 확인용) ----------------
// 주소 끝에 ?demo=… 를 붙이면 서버 없이 그 화면만 바로 보여 준다.
//   good · bad            굿엔딩 · 배드엔딩 (영상 → 엔딩 화면)
//   final                 최종 랭킹 ("보스전 진출!")
//   boss-intro            보스전 시작
//   boss-roll             내가 주사위를 멈추는 순간
//   boss-cheer            동료가 응원하는 순간
//   boss (= boss-win)     한 판을 이겼을 때
//   boss-tie · boss-lose  비겼을 때(RE:ROLL) · 졌을 때
//   boss-play             보스전을 처음부터 끝까지 직접 해 보기 (시연 · 녹화용, 서버 판정을 흉내 냄)
//   예) http://localhost:8000/party/?demo=boss-roll
const DEMOS = ['good', 'bad', 'final', 'boss', 'boss-intro', 'boss-roll', 'boss-cheer', 'boss-win', 'boss-tie', 'boss-lose'];
function demoRoom(kind) {
  const names = ['지호', '성원', '민지', '태윤', '하린'], scores = [2330, 1890, 1770, 1380, 1060];
  const players = names.map((name, i) => ({ id: i + 1, name, cpu: false, online: true, seat: i, node: 30 - i * 4, dist: 20 + i * 5,
    bag: [], flags: { skip: 0, mirror: false, shield: false, rest: false }, score: scores[i], ready: true }));
  const ranking = players.map((p, i) => ({ id: p.id, name: p.name, cpu: false, seat: p.seat, dist: p.dist, score: p.score, over: -1, rank: i + 1 }));
  const end = kind === 'good' || kind === 'bad';
  const base = { t: 'room', code: '123456', phase: end ? 'end' : 'play', step: end ? null : kind === 'final' ? 'final' : 'boss', turn: 10, maxTurns: 10, host: 1,
    players, prompts: [], rolls: {}, mg: null, mgResult: null, log: [], ranking, boss: null, ending: end ? kind : null };
  if (kind === 'final') return base;
  const boss = { hero: 1, round: 1, heroWins: 0, wizWins: 0, stage: 'reveal', need: 2, bonus: 2, lineSource: 'gemini', last: null, line: '' };
  const round = (heroDie, cheers, wizardDie) => {
    const heroTotal = heroDie + cheers, wizardTotal = wizardDie + 2;
    return { round: boss.round, heroDie, cheers, heroTotal, wizardDie, wizardTotal, winner: heroTotal > wizardTotal ? 'hero' : heroTotal < wizardTotal ? 'wizard' : 'tie' };
  };
  const deadline = Date.now() + 6000;
  if (kind === 'good') Object.assign(boss, { round: 3, heroWins: 2, wizWins: 1, stage: 'done', line: '크윽… 저주가… 풀리고 있어…!' });
  else if (kind === 'bad') Object.assign(boss, { round: 2, wizWins: 2, stage: 'done', line: '…좋아. 다음 판도 준비해 두지.' });
  else if (kind === 'boss-intro') Object.assign(boss, { round: 0, stage: 'intro', line: '지호, 여기까지 오다니 제법이군요.' });
  else if (kind === 'boss-roll') {
    Object.assign(boss, { stage: 'roll', line: '어서 굴려 보시죠. 결과는 정해져 있지만.' });
    base.prompts = [{ id: 1, pid: 1, kind: 'timing', title: '주사위를 멈춰라! (1~10)', options: [], deadline, meta: { boss: true } }];
  } else if (kind === 'boss-cheer') {
    myId = 2; board.myId = 2;   // 동료(성원)의 화면
    Object.assign(boss, { stage: 'roll', line: '어서 굴려 보시죠. 결과는 정해져 있지만.' });
    base.prompts = [{ id: 2, pid: 2, kind: 'cheer', title: '지호 응원하기! (+1)', options: [{ value: 1, label: '힘내라!', icon: '📣' }], deadline, meta: { boss: true } }];
  } else if (kind === 'boss-tie') Object.assign(boss, { round: 2, heroWins: 1, last: null, line: '비겼군요. RE:ROLL 입니다.' }, { last: { round: 2, heroDie: 5, cheers: 2, heroTotal: 7, wizardDie: 5, wizardTotal: 7, winner: 'tie' } });
  else if (kind === 'boss-lose') Object.assign(boss, { round: 2, heroWins: 1, wizWins: 1, line: '후후, 주사위는 정직하군요.', last: { round: 2, heroDie: 3, cheers: 1, heroTotal: 4, wizardDie: 9, wizardTotal: 11, winner: 'wizard' } });
  else { boss.round = 2; boss.heroWins = 2; boss.wizWins = 0; boss.line = '이, 이럴 리가 없는데…!'; boss.last = round(8, 3, 6); }   // boss · boss-win
  base.boss = boss;
  return base;
}
// 보스전 시연: 서버(story.py 의 boss_battle)가 하는 일을 화면에서 그대로 흉내 낸다.
// 내가 최종 1위 '지호'가 되어 Space 로 주사위를 멈추고, 동료 4명의 응원과 마법사 주사위는 랜덤.
async function demoBossPlay() {
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const rand = (n) => Math.floor(Math.random() * n);
  const pick = (arr) => arr[rand(arr.length)];
  const LINES = {
    intro: ['지호, 여기까지 오다니 제법이군요.', '어서 오시죠 지호. 주사위는 준비됐습니까?'],
    wizard: ['후후, 주사위는 정직하군요.', '이 정도입니까? 실망입니다.'],
    hero: ['이, 이럴 리가 없는데…!', '지호… 운이 좋았을 뿐입니다.'],
    tie: ['비겼군요. RE:ROLL 입니다.', '다시 굴리시죠. 결과는 같겠지만.'],
    good: ['크윽… 저주가… 풀리고 있어…!'], bad: ['…좋아. 다음 판도 준비해 두지.'],
  };
  const state = demoRoom('boss-intro');
  const b = state.boss;
  b.lineSource = 'canned';
  b.line = pick(LINES.intro);
  const push = () => onRoom(structuredClone(state));
  let waiting = null;   // { id, resolve } — 지금 기다리는 대답
  demoSend = (m) => {
    if (m.t === 'answer' && waiting && m.id === waiting.id) waiting.resolve(m.value);
    else if (m.t === 'lobby' || m.t === 'leave') location.reload();   // 끝난 뒤 버튼 → 처음부터 다시
  };
  push();
  onFx({ kind: 'announce', text: '보스전! 지호 vs 마법사', icon: '🧙', big: true, pid: null });
  await wait(4500);
  let promptId = 100;
  while (Math.max(b.heroWins, b.wizWins) < b.need && b.round < 7) {
    b.round += 1; b.stage = 'roll'; b.last = null;
    const id = ++promptId;
    state.prompts = [{ id, pid: 1, kind: 'timing', title: '주사위를 멈춰라! (1~10)', options: [], deadline: Date.now() + 8000, meta: { boss: true } }];
    push();
    const heroDie = await new Promise((resolve) => {
      waiting = { id, resolve };
      setTimeout(() => resolve(1 + rand(10)), 8000);   // 시간 안에 못 누르면 랜덤
    });
    waiting = null;
    state.prompts = [];
    const cheers = 1 + rand(4), wizardDie = 1 + rand(10);     // 동료 4명 중 1~4명이 응원
    const heroTotal = heroDie + cheers, wizardTotal = wizardDie + b.bonus;
    const winner = heroTotal > wizardTotal ? 'hero' : heroTotal < wizardTotal ? 'wizard' : 'tie';
    if (winner === 'hero') b.heroWins += 1; else if (winner === 'wizard') b.wizWins += 1;
    b.last = { round: b.round, heroDie, cheers, heroTotal, wizardDie, wizardTotal, winner };
    b.stage = 'reveal';
    b.line = pick(LINES[winner]);
    push();
    await wait(4000);
  }
  const ending = b.heroWins >= b.wizWins ? 'good' : 'bad';
  Object.assign(b, { stage: 'done', last: null, line: pick(LINES[ending]) });
  Object.assign(state, { phase: 'end', step: null, ending });
  push();
}

const demo = new URLSearchParams(location.search).get('demo');
if (demo === 'boss-play') {
  myId = 1; board.myId = 1;
  introSeen = true;
  demoBossPlay();
} else if (DEMOS.includes(demo)) {
  myId = 1; board.myId = 1;
  introSeen = true;
  onRoom(demoRoom(demo));
} else {
  show('title');
  connect();
}
