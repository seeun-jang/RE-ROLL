// =============================================================
// FighterRenderer.js — Fighter 상태 → 스프라이트 프레임 선택 + 그리기
//   - 기울기: 균형 값만큼 상체를 행(row) 단위로 밀어 픽셀 시어(발은 고정)
//   - 헛손질: 스쿼시 & 스트레치 (앞으로 늘어남)
//   - 맞음: 흰 실루엣 번쩍임 / 차지 가득: 깜빡임
//   - 넘어짐: 회전 프레임 → 낙하 → 수면 위 허우적
// =============================================================
import { silhouette } from '../assets/AssetLoader.js';
import { PAL } from '../palette.js';
import { clamp } from '../util.js';

// 넘어짐 연출 타이밍 (fallT 기준 프레임)
export const FALL_ROTATE_END = 20;
export const FALL_SPLASH_AT = 34;

export class FighterRenderer {
  constructor(cfg, assets) {
    this.cfg = cfg;
    this.assets = assets;
  }

  // 애니메이션 틱 (ANIM_FPS 기준)
  tick(f, speed = 1) {
    return Math.floor((f.animT * this.cfg.JUICE.ANIM_FPS * speed) / this.cfg.SCREEN.LOGIC_FPS);
  }

  pickFrame(f) {
    const set = this.assets.fighter(f.lookId);
    const A = set[f.facing];
    const t = this.tick(f);
    const ping = [0, 1, 2, 1];
    if (f.won) return A.win[Math.floor(this.tick(f, 0.6)) % A.win.length];
    switch (f.state) {
      case 'idle':
        return A.idle[ping[Math.floor(this.tick(f, 0.6)) % 4] % A.idle.length];
      case 'windup':
        return A.push[0];
      case 'charge':
        return A.charge[(f.charge >= 1 ? t : Math.floor(t / 2)) % A.charge.length];
      case 'release':
        return A.push[1];
      case 'push':
        return f.stateFrame < 2 ? A.push[1] : A.push[2];
      case 'recover':
        return f.stateFrame < 6 ? A.push[3] : A.idle[0];
      case 'feint':
        return f.stateFrame < 3 ? A.feint[0] : A.feint[1];
      case 'feintRecover':
        return A.feint[2];
      case 'holdStart':
      case 'holdRecover':
        return A.hold[0];
      case 'hold':
        return A.hold[Math.floor(this.tick(f, 0.5)) % A.hold.length];
      case 'stagger':
        return A.stagger[t % A.stagger.length];
      case 'fall': {
        const anim = f.fallDir > 0 ? A.fallFwd : A.fallBack;
        const i = clamp(Math.floor((f.fallT / FALL_ROTATE_END) * anim.length), 0, anim.length - 1);
        return anim[i];
      }
      default:
        return A.idle[0];
    }
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {Fighter} f
   * @param {object} o { stoneWobble, camX, camY }
   */
  draw(ctx, f, { stoneWobble = 0 } = {}) {
    const S = this.cfg.STAGE;
    const set = this.assets.fighter(f.lookId);
    const footX = f.baseX;
    const footY = S.FLOOR_Y + stoneWobble;

    // ---- 넘어짐: 물에 빠진 뒤 ----
    if (f.fallen && f.fallT >= FALL_SPLASH_AT) {
      const wet = set[f.facing].wet;
      const fr = wet[this.tick(f) % wet.length];
      const bob = Math.round(Math.sin(f.fallT * 0.15) * 1);
      ctx.drawImage(fr.canvas, f.fallWaterX() - fr.ax, S.WATER_Y + 1 + bob - fr.ay);
      return;
    }

    const fr = this.pickFrame(f);

    // ---- 넘어짐: 회전 후 낙하 ----
    if (f.fallen) {
      let x = footX;
      let y = footY;
      if (f.fallT > FALL_ROTATE_END) {
        const k = (f.fallT - FALL_ROTATE_END) / (FALL_SPLASH_AT - FALL_ROTATE_END);
        x += Math.round(f.dir * f.fallDir * 13 * k);
        y += Math.round(k * k * (S.WATER_Y - S.FLOOR_Y + 10));
      }
      ctx.drawImage(fr.canvas, Math.round(x - fr.ax), Math.round(y - fr.ay));
      return;
    }

    // 발밑 그림자 (받침대 윗면에 짧은 어두운 줄)
    ctx.fillStyle = PAL.charcoal;
    ctx.fillRect(footX - 4, footY, 8, 1);

    let img = fr.canvas;
    if (f.flash > 0) img = silhouette(fr.canvas, PAL.white);
    else if (f.state === 'charge' && f.charge >= 1 && this.tick(f, 2) % 4 === 0) img = silhouette(fr.canvas, PAL.sand);

    // ---- 헛손질 스쿼시 & 스트레치: 앞으로 길쭉하게 늘어남 ----
    if (f.squash > 0) {
      const k = f.squash / 10;
      const w = Math.round(fr.w * (1 + 0.3 * k));
      const h = Math.round(fr.h * (1 - 0.16 * k));
      const ax = Math.round(fr.ax * (w / fr.w));
      const dx = footX - ax + f.dir * Math.round(2 * k);
      ctx.drawImage(img, 0, 0, fr.w, fr.h, dx, footY - Math.round(fr.ay * (h / fr.h)), w, h);
      return;
    }

    // ---- 기울기: 행 단위 시어 (아래 4줄 = 발은 고정) ----
    const lean = clamp(f.body.b / this.cfg.BALANCE.LIMIT, -1, 1);
    const top = this.cfg.STAGE.MAX_SHEAR * lean * f.dir;
    const x0 = footX - fr.ax;
    const y0 = footY - fr.ay;
    const fixedRows = 4;
    const span = Math.max(1, fr.h - fixedRows);
    let bandStart = 0;
    let bandOff = Math.round(top);
    for (let y = 1; y <= fr.h; y++) {
      const off = y < fr.h ? Math.round(top * clamp(1 - y / span, 0, 1)) : null;
      if (off !== bandOff) {
        const hgt = y - bandStart;
        ctx.drawImage(img, 0, bandStart, fr.w, hgt, x0 + bandOff, y0 + bandStart, fr.w, hgt);
        bandStart = y;
        bandOff = off;
      }
    }
  }

  // 머리 위 위치 (차지 게이지, 팝업 등)
  headPos(f, stoneWobble = 0) {
    const S = this.cfg.STAGE;
    const lean = clamp(f.body.b / this.cfg.BALANCE.LIMIT, -1, 1);
    return {
      x: Math.round(f.baseX + this.cfg.STAGE.MAX_SHEAR * lean * f.dir),
      y: S.FLOOR_Y + stoneWobble - 34,
    };
  }

  // 손바닥 위치 (충돌 반짝임 위치)
  palmPos(f) {
    const S = this.cfg.STAGE;
    return { x: Math.round(f.baseX + f.dir * 8), y: S.FLOOR_Y - 18 };
  }
}
