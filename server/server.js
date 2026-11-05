// =====================================================
// RE:ROLL 연결 서버 — 같은 와이파이의 컴퓨터 여러 대가 한 게임을 차례대로 플레이
//  - 게임 파일도 이 서버가 그대로 내보냄 (re-roll 폴더 전체)
//  - 게임마다 방이 하나: 같은 게임 주소에 들어온 사람끼리 한 방
//  - 방장(먼저 들어온 사람)이 시작 → 들어온 순서대로 한 명씩 플레이, 나머지는 그 화면을 관전
//  - 플레이가 끝나면(게임 결과 화면) 점수가 모이고 다음 사람 차례 → 다 끝나면 순위
//  - 주고받는 메시지는 README.md 참고
//
//  실행: npm start  (HTTPS 8443 · HTTP 8080)
//  카메라 · 마이크 · WebGPU 는 HTTPS 에서만 되므로 다른 컴퓨터는 https://<이 컴퓨터 IP>:8443 으로 접속
// =====================================================
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { onPartyConnection, partyStatus } from './party.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
// 클라우드(Render · Railway · Fly 등)는 PORT 를 주고 HTTPS 를 대신 해줌 → 그 포트에 HTTP 하나만
const CLOUD_PORT = +process.env.PORT || 0;
const HTTP_PORT = CLOUD_PORT || +process.env.HTTP_PORT || 8080;
const HTTPS_PORT = +process.env.HTTPS_PORT || 8443;
const CFG = {
  NAME_MAX: 8,
  TURN_GRACE_MS: 8000,     // 차례인 사람이 끊기면 이만큼 기다렸다가 다음 사람으로
  FRAME_MAX_BYTES: 512 * 1024,
  SLOW_CLIENT_BYTES: 1024 * 1024, // 관전자에게 이만큼 밀려 있으면 그 화면은 건너뜀
};

// RE:ROLL 미니게임 목록 (안내 페이지용)
const GAMES = {
  'jackpot-bowling': '잭팟 볼링',
  'claw-jackpot': '잭팟 인형뽑기',
  'fight-night': '매직 파이트 나이트',
  hanomano: '하노마노',
  'jackpot-groove': '잭팟 그루브',
  'jackpot-homerun': '잭팟 홈런 더비',
  'live-fire': '실거리 사격',
  'magic-sigil': '마법진 그리기',
  'pingpong-jackpot': '잭팟 탁구왕',
  'sneaky-dance': '교수님 몰래 댄스!',
};

// ---------------- 방 ----------------
const rooms = new Map(); // game → Room
let nextId = 1;

function getRoom(game) {
  if (!rooms.has(game)) {
    rooms.set(game, { game, state: 'lobby', players: [], order: [], turn: null, round: 0, graceTimer: null });
  }
  return rooms.get(game);
}

const online = (p) => !!p.ws;
const hostOf = (room) => room.players.find(online) || null;

function snapshot(room) {
  const host = hostOf(room);
  const players = room.players.map((p) => ({ id: p.id, name: p.name, online: online(p), score: p.score, done: p.done }));
  const ranking = room.state === 'finished'
    ? room.players
      .filter((p) => p.done)
      .sort((a, b) => b.score - a.score)
      .map((p, i, arr) => ({ id: p.id, name: p.name, score: p.score, rank: i && arr[i - 1].score === p.score ? null : i + 1 }))
    : null;
  if (ranking) ranking.forEach((r, i) => { if (r.rank === null) r.rank = ranking[i - 1].rank; });
  return {
    t: 'room',
    game: room.game,
    gameName: GAMES[room.game] || room.game,
    state: room.state, // lobby | playing | finished
    round: room.round,
    host: host ? host.id : null,
    turn: room.turn,
    order: room.order,
    players,
    ranking,
  };
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room) {
  const snap = snapshot(room);
  for (const p of room.players) send(p.ws, snap);
}

function startRound(room) {
  room.round++;
  room.order = room.players.filter(online).map((p) => p.id);
  for (const p of room.players) { p.score = null; p.done = false; }
  room.state = room.order.length ? 'playing' : 'lobby';
  room.turn = room.order[0] ?? null;
  log(room, `시작 — 순서: ${room.order.map((id) => nameOf(room, id)).join(' → ')}`);
}

// 지금 차례 다음으로, 접속해 있고 아직 안 한 사람
function advance(room) {
  clearTimeout(room.graceTimer);
  room.graceTimer = null;
  const at = room.order.indexOf(room.turn);
  const rest = [...room.order.slice(at + 1), ...room.order.slice(0, Math.max(0, at))];
  const next = rest.map((id) => byId(room, id)).find((p) => p && online(p) && !p.done);
  if (next) {
    room.turn = next.id;
    log(room, `${next.name} 차례`);
  } else {
    room.turn = null;
    room.state = 'finished';
    log(room, '라운드 끝');
  }
}

const byId = (room, id) => room.players.find((p) => p.id === id);
const nameOf = (room, id) => byId(room, id)?.name || '?';
const cleanName = (s) => String(s || '').trim().slice(0, CFG.NAME_MAX) || '이름없음';

function log(room, msg) {
  console.log(`[${room.game}] ${msg}`);
}

// ---------------- 연결 하나 ----------------
function onConnection(ws) {
  let room = null;
  let me = null;

  ws.on('message', (data, isBinary) => {
    // 화면 프레임: 지금 차례인 사람 것만 나머지 사람에게 그대로 전달
    if (isBinary) {
      if (!room || !me || room.turn !== me.id || data.length > CFG.FRAME_MAX_BYTES) return;
      for (const p of room.players) {
        if (p === me || !p.ws || p.ws.readyState !== p.ws.OPEN) continue;
        if (p.ws.bufferedAmount > CFG.SLOW_CLIENT_BYTES) continue;
        p.ws.send(data, { binary: true });
      }
      return;
    }
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.t === 'hello') {
      if (room) return;
      const game = String(msg.game || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
      if (!game) return;
      room = getRoom(game);
      const token = String(msg.token || '').slice(0, 64);
      me = token && room.players.find((p) => p.token === token);
      if (me) {
        // 다시 접속 (새로고침 · 잠깐 끊김) — 점수와 순서는 그대로
        if (me.ws && me.ws !== ws) me.ws.close();
        me.ws = ws;
        me.name = cleanName(msg.name);
        if (room.turn === me.id) { clearTimeout(room.graceTimer); room.graceTimer = null; }
        log(room, `${me.name} 다시 들어옴`);
      } else {
        me = { id: nextId++, token, name: cleanName(msg.name), ws, score: null, done: false };
        room.players.push(me);
        // 이미 진행 중이면 순서 맨 뒤에 넣어서 이번 라운드에도 차례가 옴
        if (room.state === 'playing') room.order.push(me.id);
        log(room, `${me.name} 들어옴 (${room.players.filter(online).length}명)`);
      }
      send(ws, { t: 'welcome', id: me.id });
      broadcast(room);
      return;
    }
    if (!room || !me) return;
    const isHost = hostOf(room) === me;

    switch (msg.t) {
      case 'name':
        me.name = cleanName(msg.name);
        broadcast(room);
        break;
      case 'start': // 방장: 시작 · 다시 하기
        if (!isHost || room.state === 'playing') return;
        startRound(room);
        broadcast(room);
        break;
      case 'score': // 차례인 사람의 결과
        if (room.state !== 'playing' || room.turn !== me.id) return;
        me.score = Number.isFinite(+msg.score) ? +msg.score : 0;
        me.done = true;
        log(room, `${me.name} 점수 ${me.score}`);
        advance(room);
        broadcast(room);
        break;
      case 'skip': // 방장: 지금 차례 건너뛰기 (자리 비움 등)
        if (!isHost || room.state !== 'playing') return;
        log(room, `${nameOf(room, room.turn)} 건너뜀`);
        advance(room);
        broadcast(room);
        break;
      case 'lobby': // 방장: 대기실로 (점수 지움)
        if (!isHost) return;
        clearTimeout(room.graceTimer);
        room.state = 'lobby';
        room.turn = null;
        room.order = [];
        for (const p of room.players) { p.score = null; p.done = false; }
        broadcast(room);
        break;
    }
  });

  ws.on('close', () => {
    if (!room || !me || me.ws !== ws) return;
    me.ws = null;
    log(room, `${me.name} 나감`);
    if (room.state === 'lobby' || !room.order.includes(me.id)) {
      room.players = room.players.filter((p) => p !== me);
    } else if (room.turn === me.id) {
      // 새로고침일 수도 있으니 잠깐 기다림
      room.graceTimer = setTimeout(() => {
        if (online(me)) return;
        advance(room);
        broadcast(room);
      }, CFG.TURN_GRACE_MS);
    }
    if (!room.players.some(online)) {
      // 아무도 없으면 방 정리
      clearTimeout(room.graceTimer);
      rooms.delete(room.game);
      return;
    }
    broadcast(room);
  });
}

// ---------------- 파일 내보내기 ----------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.bin': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};
const HIDDEN = new Set(['server', 'node_modules', '.git', '.claude', 'render.yaml', '.gitignore']);

function serveFile(req, res) {
  const url = new URL(req.url, 'http://x');
  // 들어오면 바로 보드게임 메인 화면
  if (url.pathname === '/') { res.writeHead(302, { location: '/party/' + url.search }); return res.end(); }
  if (url.pathname === '/_net/games') return serveHome(req, res);
  if (url.pathname === '/_party/info') {
    // npm run share 로 열었을 때 바깥에서 들어오는 주소 (대기실에 보여줌)
    let publicUrl = process.env.PUBLIC_URL || '';
    try { publicUrl = publicUrl || fs.readFileSync(path.join(HERE, 'public-url.txt'), 'utf8').trim(); } catch { /* 없음 */ }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
    return res.end(JSON.stringify({ publicUrl }));
  }
  if (url.pathname === '/_party/status') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(partyStatus()));
  }
  if (url.pathname === '/_net/status') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify([...rooms.values()].map(snapshot)));
  }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  const file = path.resolve(ROOT, '.' + rel);
  const top = path.relative(ROOT, file).split(path.sep)[0];
  if (!file.startsWith(ROOT + path.sep) || HIDDEN.has(top)) { res.writeHead(404); return res.end('not found'); }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      if (!url.pathname.endsWith('/')) { res.writeHead(301, { location: url.pathname + '/' + url.search }); return res.end(); }
      return sendFile(path.join(file, 'index.html'), req, res);
    }
    sendFile(file, req, res);
  });
}

function sendFile(file, req, res) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'cache-control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function serveHome(req, res) {
  const host = req.headers.host || `localhost:${HTTPS_PORT}`;
  const status = new Map([...rooms.values()].map((r) => [r.game, r]));
  const rows = Object.entries(GAMES).map(([id, name]) => {
    const r = status.get(id);
    const who = r ? r.players.filter(online).map((p) => p.name).join(', ') : '';
    const state = r ? { lobby: '대기 중', playing: '플레이 중', finished: '라운드 끝' }[r.state] : '';
    return `<li><a href="/${id}/">${name}</a> <small>${state}${who ? ' · ' + esc(who) : ''}</small></li>`;
  }).join('');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RE:ROLL 연결 서버</title><meta http-equiv="refresh" content="5">
<style>body{font-family:system-ui,sans-serif;background:#1a1c2c;color:#f4f4f4;max-width:640px;margin:32px auto;padding:0 16px}
a{color:#ffcd75}li{margin:8px 0}small{color:#94b0c2}code{background:#333c57;padding:2px 6px;border-radius:4px}</style>
<h1>RE:ROLL 연결 서버</h1>
<p>다른 컴퓨터에서 접속: ${lanUrls().map((u) => `<code>${u}</code>`).join(' ')}</p>
<p><small>지금 주소: ${esc(host)} · 같은 게임에 들어온 사람끼리 한 방이에요. 먼저 들어온 사람이 방장.</small></p>
<ul>${rows}</ul>`);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function lanIps() {
  return Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
}
const lanUrls = () => lanIps().map((ip) => `https://${ip}:${HTTPS_PORT}`);

// ---------------- HTTPS 인증서 (자체 서명, 처음 실행할 때 만듦) ----------------
function ensureCert() {
  const dir = path.join(HERE, 'cert');
  const key = path.join(dir, 'key.pem'), crt = path.join(dir, 'cert.pem'), ipsFile = path.join(dir, 'ips.txt');
  const ips = ['127.0.0.1', ...lanIps()].sort().join(',');
  const fresh = fs.existsSync(key) && fs.existsSync(crt) && fs.existsSync(ipsFile) && fs.readFileSync(ipsFile, 'utf8') === ips;
  if (!fresh) {
    // IP 가 바뀌면(다른 와이파이) 다시 만듦
    fs.mkdirSync(dir, { recursive: true });
    const san = ['DNS:localhost', ...ips.split(',').map((ip) => `IP:${ip}`)].join(',');
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825', '-keyout', key, '-out', crt,
        '-subj', '/CN=RE-ROLL local', '-addext', `subjectAltName=${san}`], { stdio: 'ignore' });
      fs.writeFileSync(ipsFile, ips);
    } catch (e) {
      console.warn('HTTPS 인증서를 만들지 못했어요 (openssl 필요). HTTP 로만 열어요.', e.message);
      return null;
    }
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
}

// ---------------- 시작 ----------------
const wss = new WebSocketServer({ noServer: true, maxPayload: CFG.FRAME_MAX_BYTES });
wss.on('connection', onConnection);
const partyWss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
partyWss.on('connection', onPartyConnection);
function attach(server) {
  server.on('upgrade', (req, socket, head) => {
    const p = new URL(req.url, 'http://x').pathname;
    const target = p === '/_party' ? partyWss : p === '/_net' ? wss : null; // _party: 보드게임 · _net: 미니게임 하나만 차례대로
    if (!target) return socket.destroy();
    target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
  });
}

const plain = http.createServer(serveFile);
attach(plain);
// 포트가 이미 쓰이고 있으면 (서버가 이미 켜져 있음) 알아보기 쉽게 알려주고 끝냄
const portBusy = (port) => (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`\n⚠️  ${port}번 포트를 이미 다른 프로그램이 쓰고 있어요. 서버가 이미 켜져 있는지 확인하고, 켜져 있는 창을 Ctrl+C 로 끈 뒤 다시 실행하세요.\n`);
  process.exit(1);
};
plain.on('error', portBusy(HTTP_PORT));
plain.listen(HTTP_PORT, () => console.log(`HTTP  http://localhost:${HTTP_PORT}  (이 컴퓨터에서만 카메라·마이크 됨)`));

const cert = CLOUD_PORT || process.env.NO_HTTPS ? null : ensureCert();
if (cert) {
  const secure = https.createServer(cert, serveFile);
  attach(secure);
  secure.on('error', portBusy(HTTPS_PORT));
  secure.listen(HTTPS_PORT, () => {
    console.log(`HTTPS https://localhost:${HTTPS_PORT}`);
    for (const u of lanUrls()) console.log(`  다른 컴퓨터: ${u}   (처음 한 번 '안전하지 않음' 경고 → 고급 → 계속)`);
  });
}
