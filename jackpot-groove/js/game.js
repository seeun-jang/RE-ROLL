// =====================================================
// Game: 메인 루프 (고정 60FPS 로직 + 정수배 확대 렌더링)
// =====================================================
class Game {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = CONFIG.WIDTH;
    canvas.height = CONFIG.HEIGHT;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.audio = new AudioManager();
    this.input = new Input(() => this.audio.unlock());
    this.settings = { mode: 'personal', count: CONFIG.MAX_PLAYERS, charIdx: 0, difficulty: 'normal', song: 'groove', speed: 3 };
    this.scene = null;
    this.transition = null;
    this.frame = 0;
    this.acc = 0;
    this.last = 0;
    this.muteNotice = 0;
    window.addEventListener('resize', () => this.resize());
    // 브라우저 확대/축소(Ctrl +/-)로 배율이 바뀔 때도 다시 맞춤
    if (window.matchMedia) {
      const watch = () => {
        const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        mq.addEventListener && mq.addEventListener('change', () => { this.resize(); watch(); }, { once: true });
      };
      watch();
    }
    this.resize();
  }

  // 창 크기에 맞춰 정수배로만 확대 (픽셀이 찌그러지지 않게)
  //  윈도우 배율(125%, 150% 등)까지 계산해서 '실제 모니터 픽셀' 기준 정수배로 맞춤
  //  → 픽셀 크기가 들쭉날쭉해서 글씨가 뭉개지는 것을 방지
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const s = Math.max(1, Math.floor(Math.min((window.innerWidth * dpr) / CONFIG.WIDTH, (window.innerHeight * dpr) / CONFIG.HEIGHT)));
    this.canvas.style.width = (CONFIG.WIDTH * s) / dpr + 'px';
    this.canvas.style.height = (CONFIG.HEIGHT * s) / dpr + 'px';
  }

  setScene(scene) {
    this.scene = scene;
    if (scene.enter) scene.enter();
  }

  // 전환 효과와 함께 씬 교체
  changeScene(factory, type = 'fade') {
    PlayerName.hideBadge(); // 타이틀에서만 보이는 '이름 바꾸기' 버튼
    if (this.transition) return;
    this.transition = new Transition(type, () => this.setScene(factory()));
  }

  // 씬은 그대로 두고 전환 효과 중간에 콜백만 실행
  transitionTo(callback, type = 'circle') {
    if (this.transition) return;
    this.transition = new Transition(type, callback);
  }

  // firstScene: 처음 띄울 씬 (URL 로 바로 시작할 때는 PlayScene)
  start(firstScene) {
    this.setScene(firstScene || new TitleScene(this));
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  loop(now) {
    let dt = now - this.last;
    this.last = now;
    if (dt > 250) dt = 250; // 탭 전환 후 폭주 방지
    this.acc += dt;
    while (this.acc >= CONFIG.STEP_MS) {
      this.update();
      this.acc -= CONFIG.STEP_MS;
    }
    // 로직 사이의 남은 시간 비율 → 그리기 보간 (고주사율 모니터에서도 부드럽게)
    this.render(this.acc / CONFIG.STEP_MS);
    requestAnimationFrame((t) => this.loop(t));
  }

  update() {
    this.frame++;
    this.input.pollPads();
    if (this.input.wasPressed('KeyM')) {
      this.audio.toggleMute();
      this.muteNotice = 90;
    }
    if (this.muteNotice > 0) this.muteNotice--;
    // 전환 중(닫히는 동안)에는 입력을 씬에 넘기지 않음
    if (this.transition && this.transition.phase !== 'in') this.input.pressed.clear();
    if (this.scene) this.scene.update();
    if (this.transition) {
      this.transition.update();
      if (this.transition.done) this.transition = null;
    }
    this.input.endFrame();
  }

  render(alpha = 1) {
    const ctx = this.ctx;
    ctx.fillStyle = PALETTE.o;
    ctx.fillRect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);
    if (this.scene) this.scene.render(ctx, alpha);
    if (this.transition) this.transition.render(ctx);
    if (this.muteNotice > 0) {
      const txt = this.audio.muted ? '소리 끔' : '소리 켬';
      drawPanel(ctx, CONFIG.WIDTH - 60, CONFIG.HEIGHT - 26, 54, 20, 'dark');
      KText.draw(ctx, txt, CONFIG.WIDTH - 33, CONFIG.HEIGHT - 22, C('a'), { align: 'center', font: 's' });
    }
  }
}
