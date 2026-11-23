// =============================================================
// 음성 퀴즈 화면 — 서버 상태(NetLink.snap)를 그리고, 내 입력(버저 키·음성·타자)을 서버로 보낸다.
// 판정·점수·진행은 모두 서버가 한다. 여기서는 정답을 알지 못한다(정답 공개 때만 받는다).
// =============================================================
import { ANIMALS, animalForIndex } from '../../shared/animals.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { Music } from './audio/Music.js';
import { Sfx } from './audio/Sfx.js';
import { AUDIO, DEFAULT_RULES, KEYS, MIC, SCREEN } from './config.js';
import { assets } from './render/assets.js';
import { StageRenderer } from './render/StageRenderer.js';
import { injectStyle } from './ui/style.js';
import { MicCapture, pcmToBase64 } from '../../shared/MicCapture.js';

const WRONG_CAUSE = { timeout: '시간 초과', voice: '오답', typed: '오답' };
const MIC_TEXT = {
  idle: ['wait', '마이크 꺼짐'],
  starting: ['wait', '마이크 연결 중…'],
  ready: ['ok', '마이크 준비됨'],
  denied: ['bad', '마이크 권한 거부 — 타자로 답하세요'],
  unsupported: ['bad', '마이크 사용 불가 — 타자로 답하세요'],
  error: ['bad', '마이크 오류 — 타자로 답하세요'],
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name) => `<img class="icon" src="${assets.url(`icon.${name}`)}" alt="">`;

export class QuizScreen {
  /**
   * @param {HTMLElement} container
   * @param {{net: import('./net/NetLink.js').NetLink, players: object[], me: object|null, options: object}} opts
   */
  constructor(container, { net, players, me, options }) {
    this.container = container;
    this.net = net;
    this.rules = { ...DEFAULT_RULES, ...((options && options.rules) || {}) };
    this.score = (options && options.score) || { CORRECT: 100, WRONG: -50 };
    this.players = players.map((p, i) => {
      const animal = ANIMALS[p.character] || animalForIndex(p.index ?? i);
      return { id: p.id, name: p.name, animal: animal.id, color: animal.color, isMe: !!me && p.id === me.id };
    });
    this.indexOf = new Map(this.players.map((p, i) => [p.id, i]));
    this.meId = me ? me.id : null;

    injectStyle();
    assets.load();
    this._buildDom();

    this.stage = new StageRenderer(this.canvas, this.shakeEl, this.players);
    this.audio = new AudioEngine();
    this.sfx = new Sfx(this.audio);
    this.music = new Music(this.audio);
    this.mic = new MicCapture(MIC);
    this.voiceWanted = !!(options && options.voice); // 서버에 음성 인식이 있는지

    this.heard = null;        // 마지막으로 들린 말 { player, text }
    this.retry = null;        // 다시 말하기 안내 { text, left }
    this.note = '';           // 내게만 보이는 안내 (못 들었어요 등)
    this.sending = false;     // 내 음성을 보내고 판정을 기다리는 중
    this._listenToken = 0;
    this._lastTick = { q: null, a: null };
    this._lastHtml = {};
    this._lastPhaseKey = '';
    this._finalShown = false;
    this._last = performance.now();
    this._raf = 0;
    this._destroyed = false;

    this._onKeyDown = (e) => this._keyDown(e);
    this._onResize = () => this._fit();
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(container);
    }
    this._fit();
    this._unlockAudio();
    if (this.voiceWanted && this.meId) this.mic.start();

    const loop = (t) => {
      if (this._destroyed) return;
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (t - this._last) / 1000);
      this._last = t;
      this._frame(dt);
    };
    this._raf = requestAnimationFrame(loop);
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
    this.mic.stop();
    this.music.stop();
    this.stage.dispose();
    if (this.audio.ctx) this.audio.ctx.close().catch(() => {});
    this.root.remove();
  }

  // ------------------------------------------------------------------
  // 화면 틀
  // ------------------------------------------------------------------
  _buildDom() {
    const root = document.createElement('div');
    root.className = 'vq-root';
    for (const k of ['default', 'question', 'red', 'blue', 'green', 'button']) {
      root.style.setProperty(`--nine-${k}`, `url(${assets.url(`nine.${k}`)})`);
    }
    const notchA = (1 - this.rules.HINT_CHOSUNG_AT / this.rules.QUESTION_TIME) * 100;
    const notchB = (1 - this.rules.HINT_FIRST_AT / this.rules.QUESTION_TIME) * 100;
    root.innerHTML = `
      <div class="vq-stage">
        <div class="vq-shake">
          <canvas class="pixel"></canvas>
          <div class="vq-ui">
            <div class="abs row" style="left:10px;top:8px" data-ref="chips"></div>
            <div class="abs" style="left:230px;right:70px;top:13px">
              <div class="timerbar" data-ref="qbar"><div></div>
                <span class="notch" style="left:${notchA}%"></span><span class="notch" style="left:${notchB}%"></span>
              </div>
            </div>
            <div class="abs t-huge shadow-text t-yellow" style="right:10px;top:4px;width:50px;text-align:right" data-ref="qtime"></div>
            <div class="abs center-x" style="top:32px;width:560px">
              <div class="pbox question" style="min-height:74px;display:flex;flex-direction:column;justify-content:center" data-ref="question"></div>
            </div>
            <div class="abs center-x row" style="top:110px;gap:8px" data-ref="hints"></div>
            <div class="abs center-x" style="top:146px;width:420px;text-align:center" data-ref="banner"></div>
            <div class="abs center-x" style="top:186px;width:280px" data-ref="center"></div>
            <div class="abs center-x" style="top:186px;width:280px;display:none" data-ref="answerBox">
              <div class="pbox blue">
                <div class="row" style="justify-content:space-between">
                  <span class="t-yellow" data-ref="answerTitle"></span>
                  <span class="t-big t-yellow" data-ref="answerTime"></span>
                </div>
                <div class="timerbar" style="margin:2px 0 3px;height:6px" data-ref="abar"><div></div></div>
                <div class="row" style="margin-bottom:3px">
                  ${icon('mic')}<div class="meter" data-ref="meter"><div></div></div>
                </div>
                <div class="bubble dim" style="margin-bottom:3px" data-ref="heard"></div>
                <div class="row">
                  <input class="pinput" maxlength="30" placeholder="타자로 입력 후 Enter" data-ref="input" autocomplete="off">
                  <button class="pbtn" data-ref="submit">확인</button>
                </div>
              </div>
            </div>
            <div class="abs row" style="left:8px;top:274px" data-ref="mic"></div>
            <div class="panels" data-ref="panels"></div>
            <div data-ref="overlay"></div>
          </div>
        </div>
      </div>`;
    this.root = root;
    this.stageEl = root.querySelector('.vq-stage');
    this.shakeEl = root.querySelector('.vq-shake');
    this.canvas = root.querySelector('canvas');
    this.ref = {};
    root.querySelectorAll('[data-ref]').forEach((el) => {
      this.ref[el.dataset.ref] = el;
    });
    this.ref.input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // 입력 중에는 버저 키(스페이스)·M 키가 동작하지 않게
      // 한글 조합 중 Enter 는 무시(조합 완료 Enter 와 중복 제출 방지)
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        this._submitTyped();
      }
    });
    this.ref.submit.addEventListener('mousedown', (e) => e.preventDefault());
    this.ref.submit.addEventListener('click', () => this._submitTyped());
    root.addEventListener('pointerdown', () => this._unlockAudio());
    this.container.appendChild(root);
  }

  _fit() {
    const cw = this.container.clientWidth || SCREEN.UI_W;
    const ch = this.container.clientHeight || (cw * SCREEN.UI_H) / SCREEN.UI_W;
    let scale = Math.min(cw / SCREEN.UI_W, ch / SCREEN.UI_H);
    if (scale >= 1) scale = Math.floor(scale * 2) / 2; // 0.5배 단위로 맞춰 픽셀이 고르게 보이게
    scale = Math.max(0.25, scale);
    this.stageEl.style.transform = `scale(${scale})`;
    this.stageEl.style.left = `${Math.max(0, Math.floor((cw - SCREEN.UI_W * scale) / 2))}px`;
    this.stageEl.style.top = `${Math.max(0, Math.floor((ch - SCREEN.UI_H * scale) / 2))}px`;
    if (!this.container.clientHeight) this.root.style.height = `${Math.round(SCREEN.UI_H * scale)}px`;
  }

  _unlockAudio() {
    try {
      this.audio.unlock();
      if (this.audio.ctx && !this.music.timer) this.music.play('play');
    } catch (e) { /* 소리 없이 진행 */ }
  }

  // ------------------------------------------------------------------
  // 입력
  // ------------------------------------------------------------------
  _keyDown(e) {
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    this._unlockAudio();
    if (KEYS.MUTE.includes(e.code)) {
      this.audio.toggleMute();
      return;
    }
    if (KEYS.BUZZ.includes(e.code)) {
      e.preventDefault();
      const s = this.net.snap;
      if (!s || !this.meId) return;
      if ((s.phase === 'open' || s.phase === 'wrong') && !s.locked.includes(this.meId)) this.net.buzz();
    }
  }

  _submitTyped() {
    const s = this.net.snap;
    const text = this.ref.input.value.trim();
    if (!text || !s || s.phase !== 'answering' || s.buzzer !== this.meId) return;
    this.mic.cancel();
    this.net.typed(text);
    this.ref.input.value = '';
  }

  /** 내가 답할 차례이면 마이크로 말 한 토막을 듣고 서버로 보낸다 */
  _updateListening(s) {
    const myTurn = s.phase === 'answering' && s.buzzer === this.meId;
    if (!myTurn) {
      if (this.mic.listening) this.mic.cancel();
      if (s.phase !== 'judging') this.sending = false;
      return;
    }
    if (!s.voice || this.mic.status !== 'ready' || this.mic.listening || this.sending) return;
    const token = ++this._listenToken;
    this.mic.listen().then((clip) => {
      if (!clip || token !== this._listenToken || this._destroyed) return;
      const now = this.net.snap;
      if (!now || now.phase !== 'answering' || now.buzzer !== this.meId) return;
      this.sending = true;
      this.note = '';
      this.net.voice(pcmToBase64(clip.pcm), clip.rate);
      // 서버가 받지 못했을 때를 대비해 잠시 뒤 다시 들을 수 있게 한다
      setTimeout(() => {
        if (token === this._listenToken) this.sending = false;
      }, 1500);
    });
  }

  // ------------------------------------------------------------------
  // 서버 사건 → 연출
  // ------------------------------------------------------------------
  _handleEvent(e, s) {
    const p = e.player !== undefined ? this.indexOf.get(e.player) : undefined;
    const st = this.stage;
    switch (e.type) {
      case 'intro':
        this.sfx.questionIntro();
        st.fxIntro();
        st.setSkyLevel(Math.floor((e.index / Math.max(1, s ? s.total : 10)) * 3));
        this.audio.duck(1);
        this.heard = null;
        this.retry = null;
        this.note = '';
        break;
      case 'open':
        this.sfx.go();
        this.audio.duck(0.55);
        break;
      case 'hint':
        this.sfx.hint();
        st.fxHint();
        break;
      case 'buzz':
        if (p === undefined) break;
        this.sfx.buzz(p % 2);
        st.fxBuzz(p);
        this.audio.duck(AUDIO.DUCK_LEVEL);
        this.heard = null;
        this.retry = null;
        this.note = '';
        this.sending = false;
        if (e.player === this.meId) {
          this.ref.input.value = '';
          setTimeout(() => !this._destroyed && this.ref.input.focus({ preventScroll: true }), 0);
        }
        break;
      case 'heard':
        this.heard = { player: e.player, text: e.text };
        break;
      case 'retry':
        this.sfx.retry();
        if (p !== undefined) st.fxRetry(p);
        this.retry = { text: e.text, left: e.left };
        this.sending = false;
        break;
      case 'unheard':
        this.sending = false;
        if (e.player === this.meId) this.note = '잘 못 들었어요. 다시 크게 말해 주세요!';
        break;
      case 'sttFail':
        this.sending = false;
        if (e.player === this.meId) this.note = '음성 인식이 늦어요. 다시 말하거나 타자로 답하세요.';
        break;
      case 'voiceOff':
        this.sending = false;
        this.note = '서버의 음성 인식이 꺼져 있어요. 타자로 답하세요.';
        break;
      case 'wrong':
        this.sfx.wrong();
        if (p !== undefined) st.fxWrong(p);
        this.audio.duck(0.55);
        this.retry = null;
        break;
      case 'reopen':
        st.fxReopen();
        break;
      case 'correct':
        this.sfx.correct();
        if (p !== undefined) st.fxCorrect(p);
        this.audio.duck(1);
        this.retry = null;
        break;
      case 'timeup':
      case 'allWrong':
        this.sfx.timeUp();
        st.fxTimeUp();
        this.audio.duck(1);
        break;
      case 'final':
        this._showFinal(e.results);
        break;
      default:
        break;
    }
  }

  _showFinal(results) {
    if (this._finalShown || !results) return;
    this._finalShown = true;
    const winners = results.filter((r) => r.isWinner).map((r) => this.indexOf.get(r.playerId)).filter((i) => i !== undefined);
    this.stage.fxResult(winners);
    this.sfx.fanfare();
    this.audio.duck(1);
    this.music.play('result');
  }

  // ------------------------------------------------------------------
  // 매 프레임
  // ------------------------------------------------------------------
  _frame(dt) {
    const s = this.net.snap;
    for (const e of this.net.takeEvents()) this._handleEvent(e, s);
    if (s) {
      if ((s.phase === 'final' || s.phase === 'done') && s.results) this._showFinal(s.results);
      this._updateListening(s);
      this._render(s);
    } else {
      this._set('banner', '<div class="t-big shadow-text">서버를 기다리는 중…</div>');
    }
    this.stage.update(dt, this.music.beat);
    this.stage.draw();
  }

  _set(key, html) {
    if (this._lastHtml[key] === html) return;
    this._lastHtml[key] = html;
    this.ref[key].innerHTML = html;
  }

  _name(id) {
    const p = this.players[this.indexOf.get(id)];
    return p ? p.name : '?';
  }

  _render(s) {
    const R = this.rules;
    const lag = Math.max(0, this.net.now() - s.now);
    const timeLeft = Math.max(0, s.timeLeft - (s.timeRunning ? lag : 0));
    const answerLeft = Math.max(0, s.answerLeft - (s.answerRunning ? lag : 0));
    const playing = s.index >= 0 && !['ready', 'final', 'done'].includes(s.phase);
    const reveal = s.phase === 'reveal';
    const me = this.meId;

    // 째깍 소리
    const qs = Math.ceil(timeLeft);
    if (s.timeRunning && qs !== this._lastTick.q && qs <= 10 && qs > 0) this.sfx.tick(qs <= 5, false);
    this._lastTick.q = s.timeRunning ? qs : null;
    const as = Math.ceil(answerLeft);
    if (s.answerRunning && as !== this._lastTick.a && as <= 3 && as > 0) this.sfx.tick(true, true);
    this._lastTick.a = s.answerRunning ? as : null;

    // 위쪽: 문제 번호·분야·타이머
    this._set('chips', playing
      ? `<span class="chip">Q ${s.index + 1}/${s.total}</span>${s.category ? `<span class="chip">${esc(s.category)}</span>` : ''}${
        s.source === 'gemini' || s.source === 'mixed' ? '<span class="chip ok">Gemini 출제</span>' : ''}`
      : '');
    const ratio = Math.max(0, Math.min(1, timeLeft / R.QUESTION_TIME));
    this.ref.qbar.style.visibility = playing ? 'visible' : 'hidden';
    this.ref.qbar.className = `timerbar ${ratio < 0.15 ? 'danger' : ratio < 0.35 ? 'warn' : ''}`;
    this.ref.qbar.firstElementChild.style.width = `${Math.round(ratio * 200) / 2}%`;
    const qtime = playing ? String(Math.ceil(timeLeft)) : '';
    if (this.ref.qtime.textContent !== qtime) this.ref.qtime.textContent = qtime;
    this.ref.qtime.className = `abs t-huge shadow-text ${timeLeft <= 10 ? 't-red' : 't-yellow'}`;

    // 문제
    this.ref.question.parentElement.style.display = playing ? '' : 'none';
    this._set('question', s.question
      ? `<div class="t-big" style="line-height:1.45">${esc(s.question)}</div>${
        reveal && s.answer ? `<div class="t-big t-green pop" style="margin-top:4px">정답: ${esc(s.answer)}</div>` : ''}`
      : `<div class="t-big t-gray" style="text-align:center">문제 ${s.index + 1} 준비 중…</div>`);

    // 힌트
    const slot = (ic, label, value) => `<div class="pbox hint-slot ${value ? 'question pop' : 'locked'}">${icon(value ? ic : 'lock')}`
      + `<span class="t-gray">${label}</span><span class="val">${value ? esc(value) : '???'}</span></div>`;
    this._set('hints', playing && s.question ? slot('magnify', '초성', s.hints.chosung) + slot('key', '첫 글자', s.hints.firstLetter) : '');

    // 가운데 안내
    this._set('banner', this._bannerHtml(s));

    // 답변 상자 (버저를 잡은 사람에게만 입력창이 보인다)
    const answering = s.phase === 'answering' || s.phase === 'judging';
    const mine = answering && s.buzzer === me;
    this.ref.answerBox.style.display = mine ? '' : 'none';
    if (mine) {
      const title = s.phase === 'judging' ? '인식 중…' : this.mic.speaking ? '듣는 중…' : s.voice && this.mic.status === 'ready' ? '정답을 말하세요!' : '정답을 입력하세요!';
      if (this.ref.answerTitle.textContent !== title) this.ref.answerTitle.textContent = title;
      const at = String(Math.ceil(answerLeft));
      if (this.ref.answerTime.textContent !== at) this.ref.answerTime.textContent = at;
      this.ref.abar.firstElementChild.style.width = `${Math.round(Math.min(1, answerLeft / R.ANSWER_TIME) * 100)}%`;
      this.ref.meter.className = `meter ${this.mic.speaking ? 'live' : ''}`;
      this.ref.meter.firstElementChild.style.width = `${Math.round(Math.min(1, this.mic.level * 6) * 100)}%`;
      this.ref.meter.parentElement.style.display = s.voice && this.mic.status === 'ready' ? '' : 'none';
      const heard = this.retry ? `"${this.retry.text}" … 다시 한 번! (${this.retry.left}번 남음)`
        : this.note ? this.note
          : this.heard && this.heard.player === me ? `"${this.heard.text}"` : s.voice && this.mic.status === 'ready' ? '말하면 여기에 들린 말이 나와요' : '';
      if (this.ref.heard.textContent !== heard) this.ref.heard.textContent = heard;
      this.ref.heard.className = `bubble ${this.retry || this.note ? '' : 'dim'}`;
    }
    this._set('center', answering && !mine && s.buzzer
      ? `<div class="pbox" style="text-align:center"><div class="row" style="justify-content:space-between">`
        + `<span class="t-yellow">${esc(this._name(s.buzzer))} ${s.phase === 'judging' ? '— 인식 중…' : '답변 중!'}</span>`
        + `<span class="t-big t-yellow">${Math.ceil(answerLeft)}</span></div>`
        + `<div class="bubble dim" style="margin-top:3px">${
          this.retry ? `"${esc(this.retry.text)}" … 다시 한 번!` : this.heard && this.heard.player === s.buzzer ? `"${esc(this.heard.text)}"` : '…'}</div></div>`
      : '');

    // 마이크 상태 (내 것)
    let mic = '';
    if (me && playing) {
      if (!s.voice) mic = '<span class="chip wait">음성 인식 꺼짐 — 타자로 답하기</span>';
      else {
        const [cls, text] = MIC_TEXT[this.mic.status] || MIC_TEXT.idle;
        mic = `<span class="chip ${cls}">${icon('mic')} ${text}</span>`;
      }
    }
    this._set('mic', mic);

    // 참가자 패널
    this._set('panels', this.players.map((p) => {
      const sc = s.scores[p.id] || { score: 0, correct: 0, wrong: 0 };
      const isBuzzer = answering && s.buzzer === p.id;
      const locked = s.locked.includes(p.id) && !reveal;
      const won = reveal && s.last && s.last.type === 'correct' && s.last.player === p.id;
      let status = '<span class="t-gray">버저 대기</span>';
      if (isBuzzer) status = '<span class="t-yellow blink">답변 중!</span>';
      else if (won) status = `<span class="t-green">정답! +${this.score.CORRECT}</span>`;
      else if (locked) status = `<span class="t-red">${icon('lock')} 잠김 ${this.score.WRONG}</span>`;
      else if (!playing) status = `<span class="t-gray">정답 ${sc.correct} · 오답 ${sc.wrong}</span>`;
      return `<div class="panel ${p.isMe ? 'me' : ''} ${isBuzzer || won ? 'active' : ''} ${locked ? 'locked' : ''}" style="--pc:${p.color}">`
        + `<div class="row" style="justify-content:space-between;gap:2px"><span class="name" style="color:#f4f4f4;border-left:4px solid ${p.color};padding-left:4px">${esc(p.name)}</span>`   // 이름은 밝은 색으로(어두운 캐릭터 색이면 안 보였다), 캐릭터 색은 왼쪽 띠로
        + `<span class="score shadow-text">${sc.score}</span></div><div class="status">${status}</div></div>`;
    }).join(''));

    // 덮개: 시작 안내 / 최종 결과
    this._set('overlay', this._overlayHtml(s));
  }

  _bannerHtml(s) {
    const me = this.meId;
    const last = s.last || {};
    switch (s.phase) {
      case 'intro':
        return `<div class="t-huge t-yellow shadow-text pop">문제 ${s.index + 1}</div>`;
      case 'open': {
        if (me && s.locked.includes(me)) return '<div class="t-big t-red shadow-text">이번 문제는 기회가 없어요</div>';
        if (!me) return '<div class="t-big shadow-text t-gray">관전 중</div>';
        return '<div class="t-big shadow-text"><span class="t-yellow">스페이스</span>를 눌러 <span class="t-mint">버저!</span></div>';
      }
      case 'answering':
      case 'judging':
        return s.buzzer ? `<div class="t-big t-yellow shadow-text pop">${icon('bang')} ${esc(this._name(s.buzzer))}!</div>` : '';
      case 'wrong':
        return `<div class="t-big t-red shadow-text pop">땡! ${esc(this._name(last.player))} ${WRONG_CAUSE[last.cause] || ''} (${this.score.WRONG}점)</div>`
          + (last.text ? `<div class="shadow-text t-gray">"${esc(last.text)}"</div>` : '');
      case 'reveal':
        if (last.type === 'correct') return `<div class="t-big t-green shadow-text pop">${esc(this._name(last.player))} 정답! (+${this.score.CORRECT}점)</div>`;
        if (last.type === 'allWrong') return '<div class="t-big t-red shadow-text pop">모두 오답!</div>';
        return '<div class="t-big t-red shadow-text pop">시간 종료!</div>';
      default:
        return '';
    }
  }

  _overlayHtml(s) {
    if (s.phase === 'ready') {
      const R = this.rules;
      const voice = s.voice
        ? `버저를 잡으면 <span class="t-mint">마이크로 정답을 말하세요</span> (타자 입력도 가능)`
        : '서버의 음성 인식이 꺼져 있어 <span class="t-mint">타자로</span> 답합니다';
      const left = s.until ? Math.max(0, Math.ceil(s.until - this.net.now())) : 0;
      return `<div class="overlay"><div class="pbox" style="width:380px;text-align:center">
        <div class="t-huge t-yellow" style="margin:4px 0 8px">음성 퀴즈</div>
        <div style="line-height:1.7">문제 ${s.total}개 · 문제당 ${R.QUESTION_TIME}초<br>
        <kbd>스페이스</kbd> 로 버저 → ${voice}<br>
        정답 <span class="t-green">+${this.score.CORRECT}</span> · 오답 <span class="t-red">${this.score.WRONG}</span> (그 문제는 잠김)<br>
        ${R.HINT_CHOSUNG_AT}초 뒤 초성, ${R.HINT_FIRST_AT}초 뒤 첫 글자 힌트</div>
        <div class="t-big t-mint" style="margin-top:6px">${left > 0 ? `${left}초 뒤 시작` : '시작!'}</div>
      </div></div>`;
    }
    if ((s.phase === 'final' || s.phase === 'done') && s.results) {
      const rows = s.results.map((r) => {
        const st = r.stats || {};
        return `<tr class="${r.isWinner ? 'win' : ''} ${r.playerId === this.meId ? 'me' : ''}"><td>${r.rank}위</td><td style="text-align:left">${
          r.isWinner ? icon('crown') : ''} ${esc(r.name)}</td><td>${r.score}점</td><td class="t-gray">정답 ${st.correct ?? 0} · 오답 ${st.wrong ?? 0}</td></tr>`;
      }).join('');
      const winners = s.results.filter((r) => r.isWinner);
      const title = winners.length === 1 ? `${esc(winners[0].name)} 우승!` : '공동 우승!';
      return `<div class="overlay" style="align-items:flex-start;padding-top:20px;background:rgba(26,28,44,0.45)">
        <div class="pbox" style="width:400px;text-align:center">
        <div class="t-huge t-yellow" style="margin:4px 0 8px">${title}</div>
        <table class="rank">${rows}</table></div></div>`;
    }
    return '';
  }
}
