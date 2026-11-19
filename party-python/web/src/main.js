// =============================================================
// 시험용 대기실 — 이름 입력 → 참가자 확인 → 게임 고르기 → 시작 → 결과
//
// 미니게임을 따로 만들고 확인하기 위한 최소한의 틀이다. 나중에 전체 판(보드)이 생기면
// 이 파일이 판으로 바뀌고, 세션(session/)과 미니게임(games/)은 그대로 쓴다.
//
// 세션 고르기
//   기본           RemoteSession — 실제 Python 서버와 통신
//   주소에 ?local  LocalSession  — 서버 없이 시험용 봇과 확인 (?local=5 처럼 전체 인원 지정, 2~5)
// =============================================================
import { GAMES } from './games/registry.js';
import { ANIMALS } from './shared/animals.js';
import { LocalSession } from './session/LocalSession.js';
import { RemoteSession } from './session/RemoteSession.js';

// 글꼴을 접속하자마자 미리 불러온다. 글꼴은 처음 쓰일 때에야 받기 시작하고 다 받을 때까지 글자가 안 보이는데,
// 그러면 게임이 시작된 뒤 한동안 참가자 이름이 비어 보인다(음성 퀴즈의 이름 칸 등).
if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
  for (const family of ['Galmuri7', 'Galmuri9', 'Galmuri11', 'Galmuri14']) {
    document.fonts.load(`12px ${family}`, '가A1').catch(() => {});
  }
}

const query = new URLSearchParams(location.search);
const IS_LOCAL = query.has('local');
const LOCAL_PLAYERS = Number(query.get('local')) || 3;
const NAME_KEY = 'party.name';

const app = document.getElementById('app');
app.innerHTML = `
  <div class="banner" id="banner-local" hidden>
    시험용 모드(LocalSession) — 서버 없이 봇과 확인하는 화면입니다. 실제 참가자·서버 판정이 아닙니다.
  </div>
  <div class="banner warn" id="banner-conn" hidden>서버와 연결이 끊겼습니다. 다시 연결하는 중…</div>

  <section class="view" id="view-join">
    <div class="card">
      <h1>미니게임 파티</h1>
      <p class="muted">이름을 정하고 입장하세요. (최대 8글자)</p>
      <form class="row" id="join-form">
        <input type="text" id="name" maxlength="8" placeholder="이름" autocomplete="off">
        <button type="submit" id="join-btn">입장</button>
      </form>
      <p class="error" id="join-error"></p>
    </div>
  </section>

  <section class="view" id="view-lobby" hidden>
    <div class="card">
      <h1>대기실</h1>
      <h2>참가자 <span id="count"></span></h2>
      <ul class="list" id="participants"></ul>
      <h2>내 캐릭터</h2>
      <div class="chars" id="characters"></div>
      <h2>게임</h2>
      <ul class="list" id="games"></ul>
      <p class="muted" id="howto"></p>
      <div class="row">
        <button id="start-btn">게임 시작</button>
        <span class="muted" id="start-hint"></span>
      </div>
      <p class="error" id="lobby-error"></p>
      <div id="results-box" hidden>
        <h2 id="results-title">지난 게임 결과</h2>
        <table class="results" id="results"></table>
      </div>
    </div>
  </section>

  <section class="view" id="view-game" hidden>
    <div id="game-root"></div>
    <div class="game-bar">
      <span id="game-help"></span>
      <button class="small" id="abort-btn" hidden>게임 중단</button>
    </div>
  </section>
`;

const $ = (id) => document.getElementById(id);
const views = { join: $('view-join'), lobby: $('view-lobby'), game: $('view-game') };

let session = null;
let handle = null;       // 지금 떠 있는 미니게임 { destroy() }
let activeRun = 0;       // 지금 떠 있는(또는 띄우는 중인) 미니게임 실행 번호
let lastEnd = null;      // 마지막 game.end 내용

function show(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
}

/** 캐릭터 그림을 작은 캔버스에 그린다 (대기실 표시용) */
function headCanvas(id, scale) {
  const animal = ANIMALS[id];
  const cv = document.createElement('canvas');
  cv.className = 'head';
  if (!animal) return cv;
  const rows = animal.sprite;
  cv.width = rows.reduce((m, r) => Math.max(m, r.length), 0) * scale;
  cv.height = rows.length * scale;
  const g = cv.getContext('2d');
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = animal.palette[row[x]];
      if (!color) continue;
      g.fillStyle = color;
      g.fillRect(x * scale, y * scale, scale, scale);
    }
  });
  return cv;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------
// 입장
// ---------------------------------------------------------------
$('banner-local').hidden = !IS_LOCAL;
try { $('name').value = localStorage.getItem(NAME_KEY) || ''; } catch (e) { /* 무시 */ }

$('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (session) return;
  const name = $('name').value.trim();
  $('join-error').textContent = '';
  $('join-btn').disabled = true;
  const s = IS_LOCAL ? new LocalSession({ players: LOCAL_PLAYERS }) : new RemoteSession();
  bind(s);
  try {
    await s.connect(name);
    session = s;
    try { localStorage.setItem(NAME_KEY, name); } catch (err) { /* 무시 */ }
    if (views.game.hidden) show('lobby');
    if (s.room) renderLobby(s.room);
  } catch (err) {
    s.close();
    $('join-error').textContent = err && err.message ? err.message : '입장하지 못했습니다.';
  } finally {
    $('join-btn').disabled = false;
  }
});

function bind(s) {
  s.on('room', (room) => renderLobby(room));
  s.on('game.start', (d) => startGame(s, d));
  s.on('game.end', (d) => endGame(d));
  s.on('status', (st) => { $('banner-conn').hidden = !!st.connected; });
  s.on('error', (err) => {
    const text = err && err.message ? err.message : '오류가 발생했습니다.';
    $('lobby-error').textContent = text;
    if (err && err.code === 'replaced') $('banner-conn').textContent = '다른 창에서 다시 접속해 이 창의 연결이 끊겼습니다.';
    if (err && err.code === 'replaced') $('banner-conn').hidden = false;
  });
}

// ---------------------------------------------------------------
// 대기실
// ---------------------------------------------------------------
function renderLobby(room) {
  if (!room) return;
  const meId = session ? session.me.id : null;
  const isHost = room.hostId === meId;
  const people = room.participants || [];

  $('count').textContent = `${people.length} / ${room.maxPlayers}`;
  const rows = people.map((p) => {
    const tags = [p.isHost ? '방장' : '', p.id === meId ? '나' : '', p.bot ? '시험용 봇' : '', p.connected ? '' : '연결 끊김']
      .filter(Boolean).join(' · ');
    return `<li class="${p.id === meId ? 'me' : ''}"><span class="who" data-head="${escapeHtml(p.character || '')}">`
      + `${escapeHtml(p.name)}</span><span class="tag">${tags}</span></li>`;
  });
  for (let i = people.length; i < room.maxPlayers; i++) rows.push('<li class="empty"><span>빈 자리</span></li>');
  $('participants').innerHTML = rows.join('');
  for (const el of $('participants').querySelectorAll('[data-head]')) {
    if (ANIMALS[el.dataset.head]) el.prepend(headCanvas(el.dataset.head, 1));
  }

  // 캐릭터 고르기: 다른 사람이 고른 캐릭터는 누를 수 없다
  const box = $('characters');
  box.innerHTML = '';
  const mine = (people.find((p) => p.id === meId) || {}).character;
  for (const id of room.characters || []) {
    const animal = ANIMALS[id];
    if (!animal) continue;
    const owner = people.find((p) => p.character === id && p.id !== meId);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `char${id === mine ? ' mine' : ''}`;
    // 시험용 봇이 쓰는 캐릭터는 고를 수 있다(봇이 양보한다)
    btn.disabled = (!!owner && !owner.bot) || room.phase !== 'lobby';
    btn.dataset.character = id;
    btn.appendChild(headCanvas(id, 2));
    const label = document.createElement('span');
    label.textContent = owner ? owner.name : animal.name;
    btn.appendChild(label);
    box.appendChild(btn);
  }

  // 서버가 아는 게임 중 화면이 준비된 것만 보여준다
  const games = (room.games || []).filter((g) => GAMES[g.id]);
  $('games').innerHTML = games.map((g) => {
    const selected = g.id === room.gameId;
    return `<li class="${selected ? 'selected' : ''} ${isHost ? 'pick' : ''}" data-game="${escapeHtml(g.id)}">`
      + `<span>${escapeHtml(g.title)}</span><span class="tag">${g.minPlayers}~${g.maxPlayers}명</span></li>`;
  }).join('');
  const def = GAMES[room.gameId];
  $('howto').textContent = def ? `조작: ${def.howTo}` : '';
  if (def) def.load().catch(() => {}); // 시작할 때 바로 뜨도록 미리 불러 둔다

  const game = games.find((g) => g.id === room.gameId);
  const enough = game && people.filter((p) => p.connected).length >= game.minPlayers;
  $('start-btn').hidden = !isHost;
  $('start-btn').disabled = !enough || room.phase !== 'lobby';
  $('start-hint').textContent = !isHost
    ? '방장이 시작하기를 기다리는 중…'
    : (enough ? '' : `${game ? game.minPlayers : 2}명 이상 모이면 시작할 수 있습니다.`);
  $('abort-btn').hidden = !isHost;
}

$('games').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-game]');
  if (li && session) session.selectGame(li.dataset.game);
});
$('characters').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-character]');
  if (!btn || btn.disabled || !session) return;
  $('lobby-error').textContent = '';
  session.selectCharacter(btn.dataset.character);
});
$('start-btn').addEventListener('click', () => {
  $('lobby-error').textContent = '';
  if (session) session.startGame();
});
$('abort-btn').addEventListener('click', () => {
  if (session) session.abortGame();
});

function renderResults(end) {
  const box = $('results-box');
  if (!end || end.aborted || !Array.isArray(end.results) || end.results.length === 0) {
    box.hidden = !(end && end.aborted);
    $('results-title').textContent = end && end.aborted ? '게임이 중단되었습니다' : '지난 게임 결과';
    $('results').innerHTML = '';
    return;
  }
  box.hidden = false;
  const title = GAMES[end.gameId] ? GAMES[end.gameId].title : end.gameId;
  $('results-title').textContent = `지난 게임 결과 — ${title}${end.local ? ' (시험용)' : ''}`;
  $('results').innerHTML = '<tr><th>순위</th><th>이름</th><th>점수</th></tr>' + end.results.map((r) => (
    `<tr class="${r.isWinner ? 'win' : ''}"><td>${r.rank}위</td><td>${escapeHtml(r.name)}</td><td class="num">${r.score}</td></tr>`
  )).join('');
}

// ---------------------------------------------------------------
// 미니게임 띄우기 / 정리
// ---------------------------------------------------------------
async function startGame(s, d) {
  const def = GAMES[d.gameId];
  if (!def) {
    $('lobby-error').textContent = `이 화면에는 '${d.gameId}' 게임이 없습니다.`;
    return;
  }
  if (handle && activeRun === d.run) return; // 재접속으로 같은 판의 시작 알림이 다시 온 경우
  activeRun = d.run;
  let mod;
  try {
    mod = await def.load();
  } catch (err) {
    console.error(err);
    $('lobby-error').textContent = '게임 화면을 불러오지 못했습니다.';
    return;
  }
  if (activeRun !== d.run) return; // 불러오는 사이에 판이 끝났거나 바뀌었다
  destroyGame();
  show('game');
  $('game-help').textContent = `${def.title} — ${def.howTo}`;
  // 버튼에 남은 포커스가 게임 키 입력을 가로채지 않게 한다
  if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
  handle = mod.mount($('game-root'), {
    session: s, run: d.run, players: d.players, me: s.me, options: d.options || {},
  });
}

function destroyGame() {
  if (!handle) return;
  try { handle.destroy(); } catch (err) { console.error(err); }
  handle = null;
  $('game-root').innerHTML = '';
}

function endGame(d) {
  if (d.run !== activeRun) return; // 지난 판의 늦은 종료 알림
  activeRun = 0;
  lastEnd = d;
  destroyGame();
  renderResults(lastEnd);
  show('lobby');
  if (session && session.room) renderLobby(session.room);
}

show('join');
$('name').focus();
