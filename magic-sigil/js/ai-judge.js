// =====================================================
// AI 감정: 다 그린 마법진을 AI 가 보고 무엇인지 맞힘 → 맞히면 보너스
//  - 모델: Hugging Face Xenova/quickdraw-mobilevit-small (손그림 345종, fp16 약 11MB)
//    (q8 압축본은 결과가 엉망이라 fp16 사용)
//  - 정확도 50 이상 + AI 가 그 모양으로 알아보면(상위 3개 안) 'AI 인정!' +10 (배수 적용)
//  - 라운드 첫 사람이 그리기 시작할 때 준비가 안 됐으면 그 라운드는 AI 감정 없이 진행 (모두 같은 조건)
//  - 오프라인 시연: tools/download_model.sh 로 models/ 에 받아 두고 로컬 서버로 열기
// =====================================================
const AIJudge = {
  MODEL: 'Xenova/quickdraw-mobilevit-small',
  BONUS: 10,
  TOP_K: 3,
  // 마법진 → AI 가 그렇게 보면 인정하는 그림 이름
  //  (하트는 모델이 모르는 그림, 소용돌이는 거의 못 알아봐서 감정 안 함)
  MATCH: {
    고리: ['circle', 'moon', 'octagon', 'bracelet'],
    삼각: ['triangle', 'mountain'],
    다이아: ['diamond'],
    별: ['star'],
    번개: ['lightning'],
    왕관: ['crown'],
    물고기: ['fish'],
  },
  // 화면에 보여 줄 한글 이름 (없으면 영어 그대로)
  KO: {
    circle: '동그라미', moon: '달', triangle: '세모', diamond: '다이아', star: '별', lightning: '번개',
    crown: '왕관', hurricane: '소용돌이', fish: '물고기', square: '네모', octagon: '팔각형', hexagon: '육각형',
    squiggle: '꼬불선', zigzag: '지그재그', line: '선', mountain: '산', 'smiley face': '웃는 얼굴',
    snail: '달팽이', bowtie: '나비넥타이', bracelet: '팔찌', snowflake: '눈송이', stitches: '바느질 자국', bottlecap: '병뚜껑', envelope: '봉투', house: '집', sun: '해', donut: '도넛',
    lollipop: '막대사탕', 'stop sign': '정지 표지판', apple: '사과', leaf: '나뭇잎', camouflage: '위장 무늬',
  },
  ready: false,
  clf: null,
  RawImage: null,

  async load() {
    try {
      const { pipeline, env, RawImage } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
      env.allowLocalModels = location.protocol !== 'file:';
      env.localModelPath = new URL('./models/', location.href).href;
      this.RawImage = RawImage;
      this.clf = await pipeline('image-classification', this.MODEL, { dtype: 'fp16' });
      this.ready = true;
    } catch (e) {
      console.warn('AI 감정 모델을 못 불러와서 AI 감정 없이 진행', e);
    }
  },

  // 잉크 칸만 검은 바탕에 흰 선으로 다시 그려 가운데 정사각형으로 잘라 냄 (QuickDraw 학습 그림과 같은 모양)
  sketchImage(paper) {
    const S = CONFIG.CANVAS;
    let x0 = S, y0 = S, x1 = -1, y1 = -1;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (!paper.ink[y * S + x]) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return null;
    const side = Math.max(x1 - x0, y1 - y0) + 1;
    const pad = Math.ceil(side * 0.08);
    const box = side + pad * 2;
    const ox = (x0 + x1 + 1) / 2 - box / 2;
    const oy = (y0 + y1 + 1) / 2 - box / 2;
    const OUT = 256;
    const k = OUT / box;
    const c = document.createElement('canvas');
    c.width = c.height = OUT;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, OUT, OUT);
    g.fillStyle = '#fff';
    const r = 3.5; // 28x28 로 줄였을 때 선 굵기 약 1칸
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!paper.ink[y * S + x]) continue;
        g.beginPath();
        g.arc((x - ox) * k, (y - oy) * k, r, 0, Math.PI * 2);
        g.fill();
      }
    }
    return c;
  },

  // → { label, ko, score, match } 또는 null (감정 못 함)
  async judge(paper, shape) {
    const want = this.MATCH[shape.short];
    if (!this.ready || !want) return null;
    const img = this.sketchImage(paper);
    if (!img) return null;
    // 모델이 흑백 1채널 그림을 받음
    const gray = (await this.RawImage.fromURL(img.toDataURL('image/png'))).grayscale();
    const out = await this.clf(gray, { top_k: this.TOP_K });
    const hit = out.find((o) => want.includes(o.label));
    const top = hit || out[0];
    return { label: top.label, ko: this.KO[top.label] || top.label, score: top.score, match: !!hit };
  },
};

AIJudge.load();
