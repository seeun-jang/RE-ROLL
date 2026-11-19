// 한글 유틸 — server/hangul.py 와 같은 규칙 (서버 없이 정적 호스팅할 때 사용)

const BASE = 0xac00;
const LAST = 0xd7a3;
const PER_CHO = 21 * 28;
const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
export const HIDDEN_MARK = '○';

const STRIP_RE = /[\s.,!?~\-_'"`·…:;()[\]{}<>/\\|@#$%^&*+=]+/g;

export function isSyllable(ch) {
  const c = ch.charCodeAt(0);
  return c >= BASE && c <= LAST;
}

export function chosungHint(answer) {
  return [...answer].map((ch) => (isSyllable(ch) ? CHO[Math.floor((ch.charCodeAt(0) - BASE) / PER_CHO)] : ch)).join('');
}

export function firstLetterHint(answer) {
  let revealed = false;
  return [...answer]
    .map((ch) => {
      if (/\s/.test(ch)) return ch;
      if (!revealed) {
        revealed = true;
        return ch;
      }
      return HIDDEN_MARK;
    })
    .join('');
}

/** 비교용 정규화: 소문자 + 공백/문장부호 제거 */
export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(STRIP_RE, '');
}

/** text 안에 word 가 몇 번 나오는지 (겹치지 않게) */
export function countOccurrences(text, word) {
  if (!word) return 0;
  let n = 0;
  let i = text.indexOf(word);
  while (i !== -1) {
    n++;
    i = text.indexOf(word, i + word.length);
  }
  return n;
}

// ---------- 팀 이름 느슨한 찾기 (음성 오인식 대비) ----------
// 음성 인식은 "독수리"를 "도수리", "독술이"처럼 받아 적기도 한다.
// 그래서 자모 단위로 풀고(소리 안 나는 첫소리 ㅇ 제거, 된소리·비슷한 모음은 같게 취급)
// 편집 거리가 작으면 같은 이름으로 본다.
const JUNG = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'];
const JONG = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];
const LOOSE = { ㄲ: 'ㄱ', ㄸ: 'ㄷ', ㅃ: 'ㅂ', ㅆ: 'ㅅ', ㅉ: 'ㅈ', ㅐ: 'ㅔ', ㅒ: 'ㅖ', ㅙ: 'ㅞ', ㅚ: 'ㅞ' };
const loose = (j) => LOOSE[j] || j;

/** 한 음절 → 느슨한 자모 배열 */
function syllableJamo(ch) {
  if (!isSyllable(ch)) return [ch];
  const code = ch.charCodeAt(0) - BASE;
  const cho = CHO[Math.floor(code / PER_CHO)];
  const jung = JUNG[Math.floor((code % PER_CHO) / 28)];
  const jong = JONG[code % 28];
  const out = [];
  if (cho !== 'ㅇ') out.push(loose(cho)); // 첫소리 ㅇ 은 소리가 없다 ("독술이" ≈ "독수리")
  out.push(loose(jung));
  if (jong) out.push(loose(jong));
  return out;
}

export function looseJamo(text) {
  return [...text].flatMap(syllableJamo);
}

export function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** 이름 길이에 따른 허용 오차 — 2음절 이하는 (느슨한 자모 기준) 정확히 같아야 한다 */
export function nameTolerance(word) {
  const n = looseJamo(word).length;
  return n >= 10 ? 2 : n >= 5 ? 1 : 0;
}

/**
 * 정규화된 문장(norm)에서 팀 이름(word)이 나온 위치들을 찾는다 (겹치지 않게, 앞에서부터).
 * @returns {{start:number, end:number}[]} 글자 인덱스 범위
 */
export function findMentions(norm, word) {
  if (!word || !norm) return [];
  const chars = [...norm];
  const target = looseJamo(word);
  const L = [...word].length;
  const tol = nameTolerance(word);
  const out = [];
  let i = 0;
  while (i < chars.length) {
    let best = null;
    for (const size of [L, L - 1, L + 1]) {
      if (size < 1 || i + size > chars.length) continue;
      const d = editDistance(looseJamo(chars.slice(i, i + size).join('')), target);
      if (d <= tol && (!best || d < best.d)) best = { d, size };
    }
    if (best) {
      out.push({ start: i, end: i + best.size });
      i += best.size;
    } else i++;
  }
  return out;
}
