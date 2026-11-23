// =====================================================
// 플레이어 이름 — 시작할 때 정함 (RE:ROLL 공통, 컴퓨터 1대 = 플레이어 1명)
//  - 이 컴퓨터에 저장 (localStorage) · 주소에 ?name=민수 를 붙여도 됨
//  - 이름 입력은 화면 위에 뜨는 입력창 (한글 입력 가능, Enter 확인)
//  - 타이틀에서는 왼쪽 위에 '이름 · 바꾸기' 버튼이 보임
//  - applyTo(CHARACTERS, i): 내가 고른 캐릭터 이름을 내 이름으로 (CPU 는 원래 이름)
// =====================================================
const PlayerName = {
  KEY: 'reroll.playerName',
  MAX: 8,
  _orig: null,
  _overlay: null,
  _badge: null,

  get() {
    const q = new URLSearchParams(location.search).get('name');
    if (q && q.trim()) return q.trim().slice(0, this.MAX);
    try {
      return (localStorage.getItem(this.KEY) || '').trim().slice(0, this.MAX);
    } catch (e) {
      return this._mem || '';
    }
  },

  set(v) {
    const name = String(v || '').trim().slice(0, this.MAX);
    this._mem = name;
    try {
      localStorage.setItem(this.KEY, name);
    } catch (e) { /* 저장 안 되는 브라우저 — 이번 실행 동안만 기억 */ }
    return name;
  },

  get isOpen() {
    return !!this._overlay;
  },

  // 고른 캐릭터(idx)의 이름만 내 이름으로, 나머지는 원래 이름
  applyTo(chars, idx) {
    if (!this._orig) this._orig = chars.map((c) => c.name);
    chars.forEach((c, i) => (c.name = this._orig[i]));
    const name = this.get();
    if (name && chars[idx]) chars[idx].name = name;
  },

  // 이름 입력창 열기 → 확인하면 onDone(name)
  open(onDone) {
    if (this._overlay) return;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(10,8,20,.72);font-family:Galmuri11,monospace';
    const box = document.createElement('div');
    box.style.cssText = 'background:#1a1c2c;border:3px solid #ffcd75;border-radius:6px;padding:18px 22px;color:#f4f4f4;text-align:center;min-width:240px;box-shadow:0 8px 30px rgba(0,0,0,.6)';
    box.innerHTML = '<div style="font-size:18px;color:#ffcd75;margin-bottom:10px">내 이름</div>';
    const input = document.createElement('input');
    input.maxLength = this.MAX;
    input.value = this.get();
    input.placeholder = `최대 ${this.MAX}글자`;
    input.style.cssText = 'font:inherit;font-size:20px;width:200px;padding:6px 8px;border:2px solid #566c86;border-radius:4px;background:#f4f4f4;color:#1a1c2c;text-align:center;outline:none';
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:13px;color:#94b0c2;margin-top:10px';
    hint.textContent = 'Enter 로 확인';
    box.append(input, hint);
    wrap.append(box);
    document.body.append(wrap);
    this._overlay = wrap;
    let composing = false;
    input.addEventListener('compositionstart', () => (composing = true));
    input.addEventListener('compositionend', () => (composing = false));
    const done = () => {
      const name = input.value.trim();
      if (!name) {
        hint.textContent = '이름을 입력해 주세요';
        hint.style.color = '#ef7d57';
        return;
      }
      this.set(name);
      wrap.remove();
      this._overlay = null;
      if (onDone) onDone(this.get());
    };
    // 입력 중인 키가 게임으로 새지 않게 막음
    for (const type of ['keydown', 'keyup', 'keypress']) {
      input.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === 'keydown' && e.key === 'Enter' && !composing && !e.isComposing) {
          e.preventDefault();
          done();
        }
      });
    }
    setTimeout(() => input.focus(), 0);
  },

  // 타이틀 왼쪽 위 '이름 · 바꾸기' 버튼 (타이틀에서 매 프레임 showBadge, 게임 시작 때 hideBadge)
  showBadge(onChange) {
    if (!this._badge) {
      const b = document.createElement('button');
      b.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9000;font-family:Galmuri11,monospace;font-size:14px;padding:5px 10px;border:2px solid #ffcd75;border-radius:4px;background:#1a1c2c;color:#ffcd75;cursor:pointer';
      b.addEventListener('mousedown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        b.blur();
        this.open(this._badgeChange);
      });
      document.body.append(b);
      this._badge = b;
    }
    this._badgeChange = onChange;
    // 장면이 바뀌는 중(화면 전환 동안 타이틀이 아직 돌고 있음)에는 다시 띄우지 않음
    if (performance.now() < (this._hideUntil || 0)) return;
    const name = this.get();
    const label = name ? `👤 ${name} · 이름 바꾸기` : '👤 이름 정하기';
    if (this._badge.textContent !== label) this._badge.textContent = label;
    this._badge.style.display = this.isOpen ? 'none' : 'block';
  },

  hideBadge() {
    this._hideUntil = performance.now() + 1500;
    if (this._badge) this._badge.style.display = 'none';
  },
};

// 모듈(import) 쪽 코드에서도 window.PlayerName 으로 쓸 수 있게
if (typeof window !== "undefined") window.PlayerName = PlayerName;
