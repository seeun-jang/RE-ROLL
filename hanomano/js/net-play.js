// =====================================================
// 차례대로 플레이 + 관전 (RE:ROLL 연결 서버 클라이언트, 모든 미니게임 공통)
//  - 연결 서버(server/)에서 연 게임이면 자동으로 접속. 그냥 파일로 열거나 ?net=0 이면 아무것도 안 함
//  - 대기실: 같은 게임에 들어온 사람 목록 · 방장이 Enter(또는 버튼)로 시작
//  - 내 차례: 평소처럼 플레이 → 내 게임 화면을 다른 사람에게 보냄 → 결과 화면이 나오면 점수 전송
//  - 남의 차례: 그 사람 화면을 크게 보여줌 (내 게임 키 입력은 막음)
//  - 다 끝나면 순위표 · 방장이 다시 하기
//  - 점수는 게임이 내보내는 결과(re-minigame:finish)의 내 줄(cpu 아님) score 를 씀
//  - 이 파일은 input.js 보다 먼저 불러야 함 (관전 중 키 막기)
// =====================================================
const NetPlay = (() => {
  const CFG = {
    FPS: 12,              // 화면 보내는 횟수 (초당)
    MAX_W: 640,           // 이보다 큰 화면은 줄여서 보냄
    QUALITY: 0.85,        // webp 화질
    BUSY_BYTES: 256 * 1024, // 보내는 줄이 이만큼 밀리면 그 프레임은 건너뜀
    RETRY_MS: 2000,
    CONNECT_TIMEOUT_MS: 2500,
  };
  const q = new URLSearchParams(location.search);
  const enabled = /^https?:$/.test(location.protocol) && q.get('net') !== '0' && window.parent === window; // 보드게임 안(iframe)에서는 끔
  const game = (location.pathname.split('/').filter(Boolean)[0] || 'game').toLowerCase();

  let ws = null, myId = null, room = null, everConnected = false;
  let canvas = null, sendTimer = null, sending = false;
  let ui = null, frameUrl = null, lastFrameAt = 0, lastTurn = null, sentName = '';
  const token = (() => {
    const k = `reroll.net.${game}`;
    try {
      let t = sessionStorage.getItem(k);
      if (!t) sessionStorage.setItem(k, (t = Math.random().toString(36).slice(2) + Date.now().toString(36)));
      return t;
    } catch (e) {
      return Math.random().toString(36).slice(2);
    }
  })();

  const myName = () => (window.PlayerName && PlayerName.get()) || '';
  const isMyTurn = () => !!room && room.state === 'playing' && room.turn === myId;
  const isHost = () => !!room && room.host === myId;
  // 서버에 연결돼 있고 내 차례가 아니면 게임 조작을 막음
  const blocking = () => !!room && !!ws && ws.readyState === 1 && !isMyTurn();
  const nameOf = (id) => room?.players.find((p) => p.id === id)?.name || '?';

  // ---------------- 연결 ----------------
  function connect() {
    if (!myName()) return setTimeout(connect, 400); // 이름부터 정해야 들어감
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/_net`;
    let s;
    try { s = new WebSocket(url); } catch (e) { return; }
    s.binaryType = 'blob';
    ws = s;
    const timeout = setTimeout(() => { if (s.readyState !== 1) s.close(); }, CFG.CONNECT_TIMEOUT_MS);
    s.onopen = () => {
      clearTimeout(timeout);
      everConnected = true;
      sentName = myName();
      s.send(JSON.stringify({ t: 'hello', game, name: sentName, token }));
    };
    s.onmessage = (e) => {
      if (typeof e.data !== 'string') return onFrame(e.data);
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.t === 'welcome') myId = msg.id;
      else if (msg.t === 'room') onRoom(msg);
    };
    s.onclose = () => {
      clearTimeout(timeout);
      if (ws !== s) return;
      ws = null;
      room = null;
      stopSending();
      render();
      // 연결 서버가 아닌 곳(그냥 정적 서버)이면 다시 시도하지 않음
      if (everConnected) setTimeout(connect, CFG.RETRY_MS);
    };
  }

  function sendMsg(msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  function onRoom(msg) {
    room = msg;
    if (isMyTurn()) {
      startSending();
      if (lastTurn !== myId) toast('내 차례! 게임을 시작하세요');
    } else {
      stopSending();
    }
    if (room.turn !== lastTurn) clearFrame();
    lastTurn = room.turn;
    render();
  }

  // ---------------- 내 화면 보내기 ----------------
  function findCanvas() {
    if (canvas && canvas.isConnected) return canvas;
    const all = [...document.querySelectorAll('canvas')].filter((c) => !ui || !ui.root.contains(c));
    canvas = all.sort((a, b) => b.width * b.height - a.width * a.height)[0] || null;
    return canvas;
  }

  const shot = document.createElement('canvas');
  function startSending() {
    if (sendTimer) return;
    sendTimer = setInterval(sendFrame, 1000 / CFG.FPS);
  }
  function stopSending() {
    clearInterval(sendTimer);
    sendTimer = null;
  }
  function sendFrame() {
    const c = findCanvas();
    if (!c || !c.width || sending || !ws || ws.readyState !== 1 || ws.bufferedAmount > CFG.BUSY_BYTES) return;
    const s = Math.min(1, CFG.MAX_W / c.width);
    const w = Math.round(c.width * s), h = Math.round(c.height * s);
    if (shot.width !== w || shot.height !== h) { shot.width = w; shot.height = h; }
    const g = shot.getContext('2d');
    g.imageSmoothingEnabled = s < 1;
    g.drawImage(c, 0, 0, w, h);
    sending = true;
    shot.toBlob((blob) => {
      sending = false;
      if (blob && ws && ws.readyState === 1 && isMyTurn()) ws.send(blob);
    }, 'image/webp', CFG.QUALITY);
  }

  // ---------------- 남의 화면 보기 ----------------
  function onFrame(blob) {
    if (!ui || isMyTurn()) return;
    lastFrameAt = performance.now();
    const url = URL.createObjectURL(blob);
    const img = ui.view;
    img.onload = () => { if (frameUrl && frameUrl !== url) URL.revokeObjectURL(frameUrl); frameUrl = url; };
    img.src = url;
    img.style.visibility = 'visible';
    ui.wait.style.display = 'none';
  }
  function clearFrame() {
    if (!ui) return;
    ui.view.style.visibility = 'hidden';
    ui.wait.style.display = 'block';
    lastFrameAt = 0;
  }

  // ---------------- 내 점수 ----------------
  window.addEventListener('re-minigame:finish', (e) => {
    if (!isMyTurn()) return;
    const ranking = e.detail?.ranking || [];
    const mine = ranking.find((r) => !r.cpu) || ranking[0];
    if (!mine) return;
    sendMsg({ t: 'score', score: +mine.score || 0, rank: mine.rank });
    stopSending();
    toast(`점수 ${+mine.score || 0} 보냈어요`);
  });

  // ---------------- 관전 중 키 막기 ----------------
  const NAV = new Set(['Enter', 'NumpadEnter']);
  for (const type of ['keydown', 'keyup', 'keypress']) {
    window.addEventListener(type, (e) => {
      if (!blocking()) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return; // 이름 입력창은 그대로
      if (type === 'keydown' && NAV.has(e.code) && !e.repeat) hostAction();
      e.stopImmediatePropagation();
      e.preventDefault();
    }, true);
  }
  // 관전 중 마우스 클릭도 게임으로 안 가게 (화면 위에 덮개가 있어서 대부분 막히지만 혹시 몰라서)

  function hostAction() {
    if (!room || !isHost()) return;
    if (room.state === 'lobby' || room.state === 'finished') sendMsg({ t: 'start' });
  }

  // ---------------- 화면 ----------------
  const C = { bg: '#0a0814', panel: '#1a1c2c', line: '#566c86', text: '#f4f4f4', sub: '#94b0c2', gold: '#ffcd75', me: '#a7f070', hot: '#ef7d57' };
  function build() {
    const root = document.createElement('div');
    root.style.cssText = `position:fixed;inset:0;z-index:9500;display:none;font-family:Galmuri11,monospace;color:${C.text};background:${C.bg}`;
    root.innerHTML = `
      <div data-k="top" style="position:absolute;left:0;right:0;top:0;padding:10px 14px;display:flex;gap:12px;align-items:center;justify-content:space-between;font-size:16px"></div>
      <div style="position:absolute;left:12px;right:236px;top:48px;bottom:12px;display:flex;align-items:center;justify-content:center">
        <img data-k="view" style="max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain;image-rendering:pixelated;visibility:hidden">
        <div data-k="wait" style="position:absolute;color:${C.sub};font-size:15px;text-align:center"></div>
        <div data-k="center" style="position:absolute;inset:0;display:none;align-items:center;justify-content:center"></div>
      </div>
      <div data-k="side" style="position:absolute;right:12px;top:48px;width:212px;bottom:12px;overflow:auto;background:${C.panel};border:2px solid ${C.line};border-radius:6px;padding:10px;box-sizing:border-box;font-size:14px"></div>`;
    const chip = document.createElement('div');
    chip.style.cssText = `position:fixed;right:8px;top:8px;z-index:9400;display:none;pointer-events:none;font-family:Galmuri11,monospace;font-size:13px;padding:5px 10px;border:2px solid ${C.me};border-radius:4px;background:${C.panel};color:${C.me};opacity:.9`;
    const toastEl = document.createElement('div');
    toastEl.style.cssText = `position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:9600;display:none;pointer-events:none;font-family:Galmuri11,monospace;font-size:22px;padding:10px 18px;border:3px solid ${C.gold};border-radius:6px;background:${C.panel};color:${C.gold};box-shadow:0 8px 30px rgba(0,0,0,.6)`;
    document.body.append(root, chip, toastEl);
    const $ = (k) => root.querySelector(`[data-k="${k}"]`);
    root.addEventListener('mousedown', (e) => e.stopPropagation());
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      e.stopPropagation();
      b.blur();
      const act = b.dataset.act;
      if (act === 'start') sendMsg({ t: 'start' });
      if (act === 'skip') sendMsg({ t: 'skip' });
      if (act === 'lobby') sendMsg({ t: 'lobby' });
    });
    ui = { root, top: $('top'), view: $('view'), wait: $('wait'), center: $('center'), side: $('side'), chip, toast: toastEl };
  }

  let toastTimer = null;
  function toast(text) {
    if (!ui) return;
    ui.toast.textContent = text;
    ui.toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (ui.toast.style.display = 'none'), 2200);
  }

  const btn = (act, label, color = C.gold) =>
    `<button data-act="${act}" style="font:inherit;font-size:15px;padding:6px 14px;margin:4px;border:2px solid ${color};border-radius:4px;background:${C.panel};color:${color};cursor:pointer">${label}</button>`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function render() {
    if (!ui) return;
    if (!room) {
      ui.root.style.display = 'none';
      ui.chip.style.display = 'none';
      return;
    }
    const mine = isMyTurn();
    ui.root.style.display = mine ? 'none' : 'block';
    if (window.PlayerName) {
      // 관전 화면 위로 '이름 바꾸기' 버튼이 비치지 않게
      if (!mine && PlayerName._badge) PlayerName._badge.style.visibility = 'hidden';
      else if (PlayerName._badge) PlayerName._badge.style.visibility = '';
    }

    // 오른쪽: 사람 목록 (순서 · 점수)
    const order = room.state === 'lobby' ? room.players.map((p) => p.id) : [...room.order, ...room.players.map((p) => p.id).filter((id) => !room.order.includes(id))];
    ui.side.innerHTML = `<div style="color:${C.gold};margin-bottom:8px">${esc(room.gameName)} · ${room.players.filter((p) => p.online).length}명</div>` +
      order.map((id, i) => {
        const p = room.players.find((x) => x.id === id);
        if (!p) return '';
        const now = room.turn === id;
        const color = id === myId ? C.me : now ? C.gold : p.online ? C.text : C.sub;
        const tag = [id === room.host ? '방장' : '', id === myId ? '나' : '', p.online ? '' : '나감'].filter(Boolean).join('·');
        const right = p.done ? `<b>${p.score}</b>` : now ? '▶' : '';
        return `<div style="display:flex;justify-content:space-between;padding:4px 2px;border-bottom:1px solid #333c57;color:${color}">
          <span>${room.state === 'lobby' ? '' : `${i + 1}. `}${esc(p.name)} <small style="color:${C.sub}">${tag}</small></span><span>${right}</span></div>`;
      }).join('');

    // 위: 지금 상황
    const host = isHost();
    if (room.state === 'lobby') {
      ui.top.innerHTML = `<span style="color:${C.gold}">대기실</span><span style="color:${C.sub};font-size:14px">${host ? '다 모이면 Enter 로 시작' : `방장(${esc(nameOf(room.host))})이 시작하면 차례대로 플레이`}</span>`;
    } else if (room.state === 'playing') {
      const at = room.order.indexOf(room.turn) + 1;
      const next = room.order.slice(at).map((id) => room.players.find((p) => p.id === id)).find((p) => p && p.online && !p.done);
      ui.top.innerHTML = `<span>👀 <b style="color:${C.gold}">${esc(nameOf(room.turn))}</b> 플레이 중 <small style="color:${C.sub}">(${at}/${room.order.length})</small></span>
        <span style="font-size:14px;color:${C.sub}">${next ? (next.id === myId ? `<b style="color:${C.me}">다음이 내 차례</b>` : `다음: ${esc(next.name)}`) : '마지막 차례'}${host ? ' ' + btn('skip', '건너뛰기', C.sub) : ''}</span>`;
    } else {
      ui.top.innerHTML = `<span style="color:${C.gold}">🏆 라운드 ${room.round} 결과</span><span style="color:${C.sub};font-size:14px">${host ? 'Enter 로 다시 하기' : '방장이 다시 시작할 수 있어요'}</span>`;
    }

    // 가운데: 대기실 · 순위표 (관전 중에는 화면)
    if (room.state === 'playing') {
      ui.center.style.display = 'none';
      ui.wait.innerHTML = `${esc(nameOf(room.turn))} 님 화면을 기다리는 중…`;
      if (!lastFrameAt) { ui.view.style.visibility = 'hidden'; ui.wait.style.display = 'block'; }
    } else {
      ui.view.style.visibility = 'hidden';
      ui.wait.style.display = 'none';
      ui.center.style.display = 'flex';
      const box = (inner) => `<div style="background:${C.panel};border:3px solid ${C.gold};border-radius:6px;padding:18px 26px;text-align:center;min-width:280px">${inner}</div>`;
      if (room.state === 'lobby') {
        ui.center.innerHTML = box(`<div style="font-size:22px;color:${C.gold};margin-bottom:10px">${esc(room.gameName)}</div>
          <div style="color:${C.sub};margin-bottom:14px">한 명씩 차례대로 플레이하고, 내 차례가 아닐 땐 다른 사람 화면을 봐요</div>
          ${host ? btn('start', `시작 (Enter) · ${room.players.filter((p) => p.online).length}명`) : `<div style="color:${C.text}">방장을 기다리는 중…</div>`}`);
      } else {
        const rows = (room.ranking || []).map((r) => `<div style="display:flex;justify-content:space-between;gap:24px;font-size:18px;padding:4px 0;color:${r.id === myId ? C.me : r.rank === 1 ? C.gold : C.text}">
          <span>${r.rank}위 ${esc(r.name)}</span><b>${r.score}</b></div>`).join('') || `<div style="color:${C.sub}">점수가 없어요</div>`;
        ui.center.innerHTML = box(`<div style="font-size:22px;color:${C.gold};margin-bottom:12px">🏆 순위</div>${rows}
          <div style="margin-top:14px">${host ? btn('start', '다시 하기 (Enter)') + btn('lobby', '대기실로', C.sub) : ''}</div>`);
      }
    }

    // 내 차례일 때 오른쪽 위 작은 표시
    if (mine) {
      const at = room.order.indexOf(myId) + 1;
      ui.chip.textContent = `🎮 내 차례 · ${at}/${room.order.length} · 다른 사람이 보는 중`;
      ui.chip.style.display = 'block';
    } else {
      ui.chip.style.display = 'none';
    }
  }

  // 이름을 바꾸면 서버에도 알려줌
  setInterval(() => {
    const n = myName();
    if (n && n !== sentName && ws && ws.readyState === 1) {
      sentName = n;
      sendMsg({ t: 'name', name: n });
    }
    // 화면이 한동안 안 오면 기다리는 중 표시
    if (ui && room?.state === 'playing' && !isMyTurn() && lastFrameAt && performance.now() - lastFrameAt > 3000) {
      ui.wait.style.display = 'block';
      ui.wait.innerHTML = '화면이 끊겼어요… 다시 오는 중';
    }
  }, 500);

  if (enabled) {
    const boot = () => { build(); connect(); };
    if (document.body) boot();
    else document.addEventListener('DOMContentLoaded', boot);
  }

  return {
    get connected() { return !!room; },
    get myTurn() { return isMyTurn(); },
    get room() { return room; },
  };
})();

if (typeof window !== 'undefined') window.NetPlay = NetPlay;
