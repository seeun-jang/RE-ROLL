// =====================================================
// 플레이: 교실 하나, 교수님 한 분, 학생 5명이 동시에 몰래 춤추기 (수업 60초)
//  가운데 키 꾹 = 작은 춤 · ←/→ 꾹 = 큰 춤 (점수 2.5배, 멈추는 데 시간 걸림)
//  교수님이 돌아봤을 때 춤추고 있으면 딱 걸림 → 점수 깎이고 벌서기 · 3번이면 복도행
//  돌아봤을 때 얌전히 앉아 있으면(그 전에 춤췄다면) 피버 단계 상승 ×1 → ×1.5 → ×2 → ×3
// =====================================================
class PlayScene {
  // opts: { mode, count, charIdx, embed, autoplay, seed }
  constructor(game, opts) {
    this.game = game;
    this.opts = opts;
    const personal = opts.mode === 'personal';
    const n = personal ? CONFIG.MAX_PLAYERS : opts.count;
    // 개인 화면은 오늘 날짜 seed → 같은 날엔 교수님이 똑같이 움직임 (점수 비교 공정)
    this.seed = opts.seed != null ? opts.seed : personal ? dateSeed() : (Math.random() * 1e9) | 0;
    this.teacher = new Teacher(this.seed);
    this.players = [];
    for (let i = 0; i < n; i++) {
      const human = !opts.autoplay && (personal ? i === opts.charIdx : true);
      const [s0, s1] = CONFIG.CPU_SKILL;
      this.players.push({
        slot: i,
        index: i,
        def: CHARACTERS[i],
        name: CHARACTERS[i].name,
        human,
        bot: human ? null : new DanceBot(opts.autoplay ? 0.3 + Math.random() * 0.65 : s0 + Math.random() * (s1 - s0)),
        mode: 'none', // none | small | big | recover
        danceT: 0,
        recover: 0,
        punishT: 0,
        strikes: 0,
        out: false,
        outT: 0,    // 복도로 걸어 나가는 연출
        fever: 0,
        maxFever: 0,
        score: 0,
        danced: false, // 이번 쓰기 동안 춤췄나 (피버 조건)
        caughtThisLook: false,
        msg: null,
        place: null,
      });
    }
    this.colX0 = Math.round((CONFIG.WIDTH - n * ROOM.COL_W) / 2);
    this.phase = 'intro'; // intro | play | end
    this.t = 0;
    this.left = CONFIG.CLASS_TIME;
    this.frame = 0;
    this.boardDone = [];
    this.curLine = BOARD_LINES[0];
    this.lineIdx = 1;
    this.catchFx = null; // { slot, t } 교수님이 가리킴
    this.dark = 0;       // 교수님이 반을 볼 때 교실이 어두워지는 정도 (0~1)
    this.sweep = 0;      // 훑어보는 눈빛 위치
    this.shake = 0;
    this.particles = new ParticleSystem();
    this.paused = false;
    this.pauseSel = 0;
  }

  enter() {
    this.game.audio.playBgm('game');
  }

  colCx(p) {
    return this.colX0 + p.slot * ROOM.COL_W + ROOM.COL_W / 2;
  }

  inputOf(p) {
    if (!p.human) return p.bot.think(p, this.teacher);
    const input = this.game.input;
    return this.opts.mode === 'personal' ? input.solo(p.index) : input.player(p.index);
  }

  update() {
    const input = this.game.input;
    const audio = this.game.audio;
    if (this.phase !== 'end' && input.anyPressed(['KeyP', 'Escape'])) {
      this.paused = !this.paused;
      this.pauseSel = 0;
      audio.sfx('pause');
    }
    if (this.paused) {
      if (input.anyPressed(['ArrowUp', 'ArrowDown'])) {
        this.pauseSel = 1 - this.pauseSel;
        audio.sfx('select');
      }
      if (input.anyPressed(['Space', 'Enter'])) {
        audio.sfx('select');
        if (this.pauseSel === 0) this.paused = false;
        else this.game.changeScene(() => new TitleScene(this.game), 'fade');
      }
      return;
    }
    this.frame++;
    this.t++;
    if (this.shake > 0) this.shake--;
    this.particles.update();
    if (this.catchFx && ++this.catchFx.t > 60) this.catchFx = null;
    for (const p of this.players) if (p.msg && ++p.msg.t > 60) p.msg = null;

    if (this.phase === 'intro') {
      if (this.t === 1) audio.sfx('chime');
      if (this.t >= 150) {
        this.phase = 'play';
        this.t = 0;
      }
      return;
    }
    if (this.phase === 'end') {
      // 수업 끝! 다 같이 신나게 (점수는 그대로)
      for (const p of this.players) {
        if (p.out) continue;
        p.mode = 'big';
        p.danceT++;
        p.punishT = 0;
      }
      if (this.t === CONFIG.END_DELAY) this.game.changeScene(() => new ResultScene(this.game, this.players, this.opts), 'circle');
      return;
    }
    // 교수님
    const tc = this.teacher;
    const k = 1 - this.left / CONFIG.CLASS_TIME;
    const wasLook = tc.state === 'look';
    tc.update(k);
    for (const e of tc.events) {
      if (e.type === 'chalk') audio.sfx('chalk');
      else if (e.type === 'tell') audio.sfx('ahem');
      else if (e.type === 'turn') audio.sfx('turn');
      else if (e.type === 'write') {
        // 새 줄 쓰기 시작
        if (this.curLine) this.boardDone.push(this.curLine);
        this.curLine = BOARD_LINES[this.lineIdx++ % BOARD_LINES.length];
        for (const p of this.players) p.danced = false;
      }
    }
    tc.events.length = 0;
    // 낌새가 오면 음악이 뚝 줄고, 반을 보는 동안엔 거의 꺼짐 (긴장감)
    const lv = tc.state === 'write' ? 1 : tc.state === 'tell' ? 0.35 : tc.state === 'back' ? 0.6 : 0.12;
    audio.setMusicLevel(lv, tc.state === 'tell' ? 0.08 : 0.25);
    this.dark += ((tc.watching ? 1 : 0) - this.dark) * 0.2;
    if (tc.state === 'look') this.sweep = Math.sin(tc.t / 14);
    // 쓰는 동안 분필 가루 (멈추면 낌새가 눈에 보임)
    if (tc.state === 'write' && this.frame % 5 === 0) {
      this.particles.add(tc.x + 14, ROOM.TEACHER_FOOT - PROF_H + 1, (Math.random() - 0.5) * 0.3, 0.3, 20, C('b'), 1);
    }
    // 다 보고 다시 칠판으로 → 안 걸린 사람은 피버 상승
    if (wasLook && tc.state === 'back') {
      for (const p of this.players) {
        if (!p.out && !p.caughtThisLook && p.danced && p.punishT === 0 && p.fever < CONFIG.FEVER.length - 1) {
          p.fever++;
          p.maxFever = Math.max(p.maxFever, p.fever);
          p.msg = { text: `피버 ×${CONFIG.FEVER[p.fever]}`, color: '9', t: 0 };
          audio.sfx('coin');
        }
        p.caughtThisLook = false;
      }
    }
    for (const p of this.players) this.updateStudent(p, this.inputOf(p));
    // 수업 시간
    this.left--;
    if (this.left === 180 || this.left === 120 || this.left === 60) audio.sfx('countdown');
    if (this.left <= 0) {
      this.phase = 'end';
      this.t = 0;
      const rows = buildResult(this.opts.mode, this.players).ranking;
      for (const r of rows) this.players.find((q) => q.slot === r.seat).place = r.rank;
      audio.setMusicLevel(1, 0.3);
      audio.sfx('chime');
      audio.sfx('win');
    }
  }

  updateStudent(p, inp) {
    if (p.out) {
      p.outT++;
      return;
    }
    const audio = this.game.audio;
    if (p.punishT > 0) {
      p.punishT--;
      p.mode = 'none';
      return;
    }
    const big = inp.left || inp.right;
    const small = inp.skillHeld;
    if (big) {
      p.mode = 'big';
      p.recover = CONFIG.BIG_RECOVER;
    } else if (p.recover > 0) {
      p.recover--;
      p.mode = 'recover';
    } else p.mode = small ? 'small' : 'none';
    if (p.mode !== 'none') p.danceT++;
    // 점수 (춤추는 동안만, 피버 배수)
    const mult = CONFIG.FEVER[p.fever];
    if (p.mode === 'small') p.score += (CONFIG.SMALL_RATE / 60) * mult;
    if (p.mode === 'big') p.score += (CONFIG.BIG_RATE / 60) * mult;
    if (p.mode === 'small' || p.mode === 'big') p.danced = true;
    const cx = this.colCx(p);
    if ((p.mode === 'small' || p.mode === 'big') && p.danceT % (p.mode === 'big' ? 10 : 18) === 0) {
      // 음표
      this.particles.add(cx + (Math.random() - 0.5) * 20, 92, (Math.random() - 0.5) * 0.4, -0.5, 30, C(p.def.color), 2);
      audio.sfx('step');
    }
    // 딱 걸림!
    if (this.teacher.watching && p.mode !== 'none') {
      p.strikes++;
      p.score = Math.max(0, p.score - CONFIG.CAUGHT_PENALTY);
      p.fever = 0;
      p.mode = 'none';
      p.recover = 0;
      p.caughtThisLook = true;
      p.punishT = CONFIG.PUNISH_TIME;
      this.catchFx = { slot: p.slot, t: 0 };
      this.shake = 8;
      audio.sfx('caught');
      if (p.strikes >= CONFIG.MAX_STRIKES) {
        p.out = true;
        p.outT = 0;
        p.msg = { text: '복도로 나가!', color: '5', t: 0 };
      } else p.msg = { text: `걸렸다! -${CONFIG.CAUGHT_PENALTY}`, color: '5', t: 0 };
      this.particles.burst(cx, 100, 14, [C('5'), C('9'), C('b')], 1.6, 24, 1);
    }
  }

  // ---------------- 그리기 ----------------
  render(ctx) {
    const W = CONFIG.WIDTH;
    const sh = this.shake ? (this.frame % 2 ? 1 : -1) : 0;
    ctx.save();
    ctx.translate(sh, 0);
    drawRoom(ctx, this.frame, this.left, CONFIG.CLASS_TIME);
    const tc = this.teacher;
    const k = tc.state === 'write' ? Math.min(1, tc.t / Math.max(1, tc.dur)) : 1;
    drawBoardText(ctx, this.boardDone, this.curLine, k);
    drawTeacher(ctx, tc, this.frame, !!this.catchFx);
    this.renderTell(ctx);
    for (const p of this.players) drawDesk(ctx, this.colCx(p), p, this.frame);
    this.renderGaze(ctx);
    for (const p of this.players) drawWalkOut(ctx, this.colCx(p), p, this.frame);
    this.renderBubble(ctx);
    this.particles.render(ctx);
    for (const p of this.players) this.renderHud(ctx, p);
    ctx.restore();
    if (!this.demo) this.renderTop(ctx);
    if (this.phase === 'intro' && !this.demo) {
      drawCard(ctx, W / 2 - 80, 60, 160, 40, '1', '9');
      KText.draw(ctx, '수업 시작!', W / 2, 63, C('9'), { align: 'center', font: 'b' });
      KText.draw(ctx, '교수님이 칠판 볼 때만 춤추기', W / 2, 78, C('a'), { align: 'center', font: 's' });
      if (this.t > 60) KText.draw(ctx, '흠흠 · 분필 멈춤 = 돌아볼 낌새!', W / 2, 89, C('5'), { align: 'center', font: 'n' });
    }
    if (this.phase === 'end' && this.t > 10 && this.t < CONFIG.END_DELAY - 15) {
      drawCard(ctx, W / 2 - 64, 66, 128, 26, '6', '9');
      KText.draw(ctx, '수업 끝!', W / 2, 69, C('9'), { align: 'center', font: 'L', outline: C('1') });
    }
    if (this.paused) {
      ctx.fillStyle = ctx.createPattern(Transition.patterns[10], 'repeat');
      ctx.fillRect(0, 0, W, CONFIG.HEIGHT);
      drawPanel(ctx, 110, 55, 100, 70, 'default');
      KText.draw(ctx, '일시정지', W / 2, 62, C('9'), { align: 'center', font: 'b', outline: C('1') });
      ['계속하기', '타이틀로'].forEach((s, i) => {
        const sel = this.pauseSel === i;
        KText.draw(ctx, (sel ? '▶ ' : '') + s, W / 2, 84 + i * 16, sel ? C('9') : C('j'), { align: 'center', font: 'b' });
      });
    }
  }

  // 교수님 말풍선: 낌새(흠흠 / …?) · 걸렸을 때(거기 너!)
  renderBubble(ctx) {
    const tc = this.teacher;
    const x = Math.round(tc.x) + 12;
    const y = ROOM.TEACHER_FOOT - PROF_H - 2;
    let text = null;
    let col = '1';
    if (this.catchFx) {
      text = '거기 너!';
      col = '6';
    } else if (tc.state === 'tell') text = tc.t % 40 < 20 ? '흠흠…' : '…?';
    if (!text) return;
    const w = KText.width(text, 's') + 12;
    const bx = Math.max(2, Math.min(CONFIG.WIDTH - w - 2, x + 6));
    drawCard(ctx, bx, y, w, 18, 'b', col === '6' ? '6' : 'k');
    ctx.fillStyle = C('1');
    ctx.fillRect(bx + 2, y + 17, 5, 3);
    ctx.fillStyle = C('b');
    ctx.fillRect(bx + 3, y + 16, 3, 3);
    KText.draw(ctx, text, bx + w / 2, y + 2, C(col), { align: 'center', font: 's' });
  }

  // 낌새: 머리 위 '?' 깜빡 + 긴장선 (분필도 멈춤)
  renderTell(ctx) {
    const tc = this.teacher;
    if (tc.state !== 'tell') return;
    const hx = Math.round(tc.x);
    const hy = ROOM.TEACHER_FOOT - PROF_H;
    if (this.frame % 16 < 11) {
      ctx.fillStyle = C('1');
      ctx.fillRect(hx - 4, hy - 16, 9, 13);
      KText.draw(ctx, '?', hx, hy - 17, C('9'), { align: 'center', font: 'b' });
    }
    // 머리 양옆 긴장선
    ctx.fillStyle = C('5');
    const o = this.frame % 8 < 4 ? 0 : 1;
    ctx.fillRect(hx - 14 - o, hy + 4, 4, 1);
    ctx.fillRect(hx - 13 - o, hy + 9, 4, 1);
    ctx.fillRect(hx + 11 + o, hy + 4, 4, 1);
    ctx.fillRect(hx + 10 + o, hy + 9, 4, 1);
  }

  // 반을 보는 동안: 교실이 어두워지고 교수님 눈빛(조명)이 학생들을 훑음 · 걸리면 그 학생에게 딱 멈춤
  renderGaze(ctx) {
    if (this.dark < 0.05) return;
    const W = CONFIG.WIDTH;
    // 책상 윗부분까지만 살짝 어둡게 (명패 · 이름표는 그대로 잘 보이게)
    ctx.fillStyle = DITHER.get(ctx, 'o', Math.round(this.dark * 2));
    ctx.fillRect(0, 14, W, ROOM.DESK_TOP - 14);
    const tc = this.teacher;
    let tx = W / 2 + this.sweep * (this.players.length * ROOM.COL_W) * 0.45;
    if (this.catchFx) {
      const p = this.players.find((q) => q.slot === this.catchFx.slot);
      if (p) tx = this.colCx(p);
    }
    const ex = Math.round(tc.x);
    const ey = ROOM.TEACHER_FOOT - PROF_H + 11;
    ctx.fillStyle = DITHER.get(ctx, this.catchFx ? '5' : 't', Math.round(2 + this.dark * 2));
    ctx.beginPath();
    ctx.moveTo(ex - 3, ey);
    ctx.lineTo(ex + 3, ey);
    ctx.lineTo(tx + 26, ROOM.DESK_TOP + 2);
    ctx.lineTo(tx - 26, ROOM.DESK_TOP + 2);
    ctx.closePath();
    ctx.fill();
  }

  renderTop(ctx) {
    const W = CONFIG.WIDTH;
    ctx.fillStyle = C('1');
    ctx.fillRect(0, 0, W, 14);
    ctx.fillStyle = C('c');
    ctx.fillRect(0, 13, W, 1);
    KText.draw(ctx, '교수님 몰래 댄스!', 4, 1, C('9'), { font: 'b' });
    const sec = Math.ceil(this.left / 60);
    KText.draw(ctx, this.phase === 'end' ? '수업 끝' : `수업 끝까지 ${sec}초`, W - 4, 1, sec <= 10 && this.frame % 30 < 15 ? C('5') : C('a'), { font: 's', align: 'right' });
  }

  renderHud(ctx, p) {
    const cx = this.colCx(p);
    const x0 = cx - 32;
    drawNameCard(ctx, x0 + 2, 140, 60, { def: p.def, name: p.name, index: p.index, place: this.phase === 'end' ? p.place : null }, this.frame);
    if (p.msg) {
      const y = Math.round(78 - Math.min(6, p.msg.t / 4));
      const tw = KText.width(p.msg.text, 'n') + 8;
      ctx.fillStyle = C(p.msg.color);
      ctx.fillRect(Math.round(cx - tw / 2), y, tw, 12);
      ctx.fillStyle = C('1');
      ctx.fillRect(Math.round(cx - tw / 2) + 1, y + 1, tw - 2, 10);
      KText.draw(ctx, p.msg.text, cx, y + 1, C(p.msg.color), { align: 'center', font: 'n' });
    }
    if (p.punishT > 0 && !p.out) BitmapFont.draw(ctx, String(Math.ceil(p.punishT / 60)), cx, 86, C('5'), { align: 'center', outline: C('1') });
    if (this.opts.mode === 'personal' && p.human) {
      ctx.fillStyle = C('9');
      ctx.fillRect(x0 + 2, 157, 60, 1);
    }
    // 조작키 (항상 표시)
    if (p.human) {
      const input = this.game.input;
      const solo = this.opts.mode === 'personal';
      const labels = solo ? ['<', '^', '>'] : KEYMAP[p.index].keys;
      const k = solo ? input.solo(p.index) : input.player(p.index);
      const held = [k.left, k.skillHeld, k.right];
      const caps = labels.map((l, j) => getKeycap(l, j === 1 ? 'strike' : 'fwd', !!held[j]));
      const tw = caps.reduce((s, c) => s + c.width, 0) + 2;
      let kx = Math.round(cx - tw / 2);
      caps.forEach((c) => {
        ctx.drawImage(c, kx, 159);
        kx += c.width + 1;
      });
    } else KText.draw(ctx, 'CPU', cx, 162, C('j'), { align: 'center', font: 'b' });
  }
}
