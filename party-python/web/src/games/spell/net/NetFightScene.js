// =============================================================
// 결투 장면 (멀티플레이용)
//  - 내 결투(쉬는 사람은 첫 번째 결투)를 보여 준다. 내 캐릭터는 항상 왼쪽.
//  - 입력: 숫자키 1~6 / 주문 칸 클릭 / 마이크(주문 이름 외치기) → 서버로 보낸다.
//  - 서버 상태와 사건을 MirrorDuel 에 넘겨 그린다.
// =============================================================
import { pcmToBase64 } from '../../../shared/MicCapture.js';
import { Scene } from '../core/SceneManager.js';
import { CONFIG } from '../config.js';
import { C } from '../data/palette.js';
import { SPELLS, SPELL_BY_KEY } from '../data/spells.js';
import { Background } from '../game/Background.js';
import { SpeechBubble } from '../ui/SpeechBubble.js';
import { SpellPanel } from '../ui/SpellPanel.js';
import { nineSlice } from '../ui/Widgets.js';
import { MirrorDuel } from './MirrorDuel.js';
import { NetHUD } from './NetHUD.js';

const FAIL_TEXT = { mana: '마나 부족!', cooldown: '아직 쿨다운…', unknown: '모르는 주문', notready: '아직이야!' };

export class NetFightScene extends Scene {
  enter(params) {
    const g = this.game;
    const s = g.net.snap;
    this.round = params.round;
    this.rounds = s.rounds;
    const me = g.me;
    let index = me ? s.matches.findIndex((m) => m.a === me.id || m.b === me.id) : -1;
    this.spectate = index < 0;
    if (index < 0) index = 0;
    this.index = index;
    const match = s.matches[index];
    this.meKey = this.spectate ? null : match.a === me.id ? 'a' : 'b';
    this.duel = new MirrorDuel({
      game: g, a: g.playerById(match.a), b: g.playerById(match.b), swap: this.meKey === 'b', meKey: this.meKey,
    });
    this.myMage = this.meKey ? this.duel.mages[this.meKey] : null;
    this.bg = new Background(this.round % 2 ? 'volcano' : 'training');
    this.hud = new NetHUD(g);
    this.panel = new SpellPanel(g, { onSlot: (spell) => this.cast(spell.id) });
    this.bubbles = { a: new SpeechBubble(g), b: new SpeechBubble(g) };
    this.banner = null;
    this.countdown = null;
    this.started = false;
    this.endShown = false;
    this._listenToken = 0;
    g.net.takeEvents(index); // 지난 장면에서 쌓인 사건은 버린다
    g.audio.playMusic('battle');
  }

  exit() {
    this._listenToken++;
    this.game.mic.cancel();
    this.game.audio.setDuck(false);
  }

  showBanner(text, sub = '', color = C.white, time = 1.4) {
    this.banner = { text, sub, color, time, total: time };
  }

  get canCast() {
    return !!this.meKey && this.duel.fighting;
  }

  cast(spellId) {
    if (!this.canCast) return;
    this.game.net.cast(spellId);
  }

  /** 결투 중에는 계속 듣는다: 말 한 토막이 끝날 때마다 서버로 보내고 다시 듣는다 */
  _updateListening() {
    const mic = this.game.mic;
    if (!this.canCast || !this.game.voice) {
      if (mic.listening) mic.cancel();
      return;
    }
    if (mic.status !== 'ready' || mic.listening) return;
    const token = ++this._listenToken;
    mic.listen().then((clip) => {
      if (!clip || token !== this._listenToken || !this.canCast) return;
      this.game.net.voice(pcmToBase64(clip.pcm), clip.rate);
    });
  }

  // ---------- 서버 사건 ----------
  _handleEvent(e) {
    const g = this.game;
    if (e.type === 'voiceOff') return;
    if (e.type === 'heard') {
      // 주문으로 인정되지 않은 말: 무엇으로 들렸는지 보여 준다 (인정된 말은 곧이어 오는 cast 사건이 처리)
      if (!e.spell) {
        this.bubbles[e.who].show('???', 'fail', { sub: `"${e.text}"`, duration: 1.4 });
        if (e.who === this.meKey) g.audio.play('fail');
      }
      return;
    }
    const out = this.duel.handleEvent(e);
    if (e.type === 'cast') {
      this.bubbles[e.who].show(`${out.spell.name}!`, 'success');
      if (e.who === this.meKey) {
        this.panel.flash(SPELLS.findIndex((sp) => sp.id === e.spell), true);
        g.audio.play('success');
      }
    } else if (e.type === 'castFail') {
      if (e.who === this.meKey) {
        const spell = SPELLS.find((sp) => sp.id === e.spell);
        this.bubbles[e.who].show(FAIL_TEXT[e.reason] || '실패', 'info', { sub: spell ? spell.name : '' });
        this.panel.flash(SPELLS.findIndex((sp) => sp.id === e.spell), false);
      }
    } else if (e.type === 'end') {
      this._onEnd(e.result);
    }
  }

  _onEnd(result) {
    if (this.endShown) return;
    this.endShown = true;
    const g = this.game;
    const draw = result.winner === 'draw';
    const sub = result.reason === 'timeout' ? '시간 종료' : result.reason === 'forfeit' ? '상대 기권' : 'K.O.';
    g.audio.stopMusic();
    if (this.meKey) {
      const win = result.winner === this.meKey;
      this.showBanner(draw ? '무승부!' : win ? '승리!' : '패배…', sub, win ? C.yellow : C.silver, 2.4);
      g.audio.play(draw ? 'draw' : win ? 'win' : 'lose');
    } else {
      const name = draw ? '' : this.duel.mages[result.winner].name;
      this.showBanner(draw ? '무승부!' : `${name} 승리!`, sub, C.yellow, 2.4);
      g.audio.play(draw ? 'draw' : 'win');
    }
  }

  // ---------- 갱신 ----------
  update(dt) {
    const g = this.game;
    const s = g.net.snap;
    if (s && s.round === this.round && s.duels[this.index]) {
      this.duel.apply(s.duels[this.index]);
      // 카운트다운 (서버 시계 기준)
      if (s.phase === 'countdown') {
        const n = Math.max(1, Math.ceil(s.startAt - g.net.now()));
        if (n !== this.countdown) {
          this.countdown = n;
          g.audio.play('countdown');
        }
      } else if (s.phase === 'fight' && !this.started) {
        this.started = true;
        this.countdown = null;
        g.audio.play('countdown', { go: true });
        this.showBanner('시작!', g.voice ? '주문을 외쳐라!' : '숫자키 1~6 으로 주문을 써라!', C.green, 1.2);
      }
      if (this.duel.result) this._onEnd(this.duel.result); // 사건을 놓쳤을 때(다시 접속 등) 대비
    }
    for (const e of g.net.takeEvents(this.index)) this._handleEvent(e);

    this._updateListening();
    const mic = g.mic;
    if (this.myMage) {
      // 말하는 동안 기 모으는 자세 + 배경음 줄이기
      const speaking = mic.speaking && this.canCast;
      if (speaking && this.myMage.anim === 'idle') this.myMage.setAnim('charge');
      else if (!speaking && this.myMage.anim === 'charge') this.myMage.setAnim('idle');
      g.audio.setDuck(speaking);
    }

    if (this.banner) {
      this.banner.time -= dt;
      if (this.banner.time <= 0) this.banner = null;
    }
    this.bg.update(dt);
    this.duel.update(dt);
    this.hud.update(dt, this.duel);
    this.panel.update(dt);
    this.bubbles.a.update(dt);
    this.bubbles.b.update(dt);
  }

  // ---------- 그리기 ----------
  render(r) {
    const g = this.game;
    const { text } = g;
    const ctx = r.ctx;
    const shake = r.shakeOffset;
    this.bg.render(r, shake);
    this.bg.renderGround(r, shake);
    r.pushShake();
    this.duel.render(r);
    for (const key of ['a', 'b']) {
      const m = this.duel.mages[key];
      this.bubbles[key].render(r, m.x + m.facing * 3, m.y - 30);
    }
    r.popShake();

    if (this.countdown !== null && !this.started) {
      text.draw(ctx, String(this.countdown), 160, 50, { size: 'l', color: C.yellow, align: 'center', outline: C.ink, scale: 2 });
    }
    const b = this.banner;
    if (b) {
      const big = b.text.length <= 8;
      const th = big ? 30 : 15;
      const h = th + (b.sub ? 11 : 0) + 3;
      r.dither(0, 36, r.W, h, C.ink, 0.6);
      text.draw(ctx, b.text, 160, 37, { size: 'l', color: b.color, align: 'center', outline: C.ink, scale: big ? 2 : 1 });
      if (b.sub) text.draw(ctx, b.sub, 160, 37 + th, { size: 's', color: C.white, align: 'center', outline: C.ink });
    }

    this.hud.render(r, this.duel, { showTimer: true });
    text.draw(ctx, `ROUND ${this.round}/${this.rounds}`, 160, 122, { size: 's', color: C.white, outline: C.ink, align: 'center' });

    if (this.myMage) {
      const mic = g.mic;
      const micOn = g.voice && mic.status === 'ready';
      const hub = {
        listening: micOn && mic.speaking && this.canCast,
        level: micOn ? Math.min(1, mic.level * 5) : 0,
        statuses: { voice: { status: micOn ? 'listening' : 'off' } },
      };
      let hint = null;
      if (!g.voice) hint = '음성 인식 꺼짐 — 숫자키 1~6 으로 시전';
      else if (mic.status === 'denied') hint = '마이크 권한 거부 — 숫자키 1~6 으로 시전';
      else if (mic.status !== 'ready') hint = '마이크 준비 중… (숫자키 1~6 가능)';
      this.panel.render(r, { hub, spellBook: this.myMage.spellBook, mana: this.myMage.mana, hint });
      const s = g.net.snap;
      const othersBusy = s && s.duels.some((d, i) => i !== this.index && d.state !== 'over');
      if (this.endShown && s && s.phase === 'fight' && othersBusy) {
        text.draw(ctx, '다른 결투가 끝나기를 기다리는 중…', 160, 28, { size: 's', color: C.yellow, outline: C.ink, align: 'center' });
      }
    } else {
      nineSlice(r, g.assets, 0, CONFIG.LAYOUT.PANEL_Y, 320, 180 - CONFIG.LAYOUT.PANEL_Y, 'dark');
      text.draw(ctx, '이번 라운드는 쉬어요 — 관전 중', 160, CONFIG.LAYOUT.PANEL_Y + 14, { size: 'm', color: C.yellow, align: 'center' });
      text.draw(ctx, '다음 라운드에 결투합니다', 160, CONFIG.LAYOUT.PANEL_Y + 28, { size: 's', color: C.silver, align: 'center' });
    }
  }

  // ---------- 포인터/키 ----------
  onPointerMove(p) {
    if (this.myMage) this.panel.onPointerMove(p, SPELLS);
  }

  onPointerDown(p) {
    return this.myMage ? this.panel.onPointerDown(p, SPELLS) : false;
  }

  onPointerUp(p) {
    return this.myMage ? this.panel.onPointerUp(p, SPELLS) : false;
  }

  onKeyDown(e) {
    if (e.repeat) return false;
    const key = e.code.startsWith('Digit') ? e.code.slice(5) : e.code.startsWith('Numpad') ? e.code.slice(6) : null;
    const spell = key ? SPELL_BY_KEY[key] : null;
    if (!spell) return false;
    e.preventDefault?.();
    this.cast(spell.id);
    return true;
  }
}
