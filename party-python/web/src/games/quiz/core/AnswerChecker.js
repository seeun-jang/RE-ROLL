// 정답 판정 — 시험용 진행기(QuizSim) 전용. 실제 판정은 서버(server/party/games/quiz/checker.py)가 한다.
// (원본 AnswerChecker.js 에서 팀 이름 처리만 뺐다)
import { normalize } from '../util/hangul.js';

const FILLER_PREFIX = ['정답은', '정답', '답은', '답', '음', '어', '아', '그', '저기', '제생각엔', '제생각에는'];
const FILLER_SUFFIX = ['입니다', '이에요', '예요', '이요', '요', '이다', '다', '인가요', '일까요'];
const SLACK_CHARS = 2;

function variants(text) {
  const out = new Set([text]);
  let cur = text;
  for (let guard = 0; guard < 4; guard++) {
    const p = FILLER_PREFIX.find((f) => cur.startsWith(f) && cur.length > f.length);
    if (!p) break;
    cur = cur.slice(p.length);
    out.add(cur);
  }
  for (const base of [...out]) {
    let s = base;
    for (let guard = 0; guard < 3; guard++) {
      const f = FILLER_SUFFIX.find((x) => s.endsWith(x) && s.length > x.length);
      if (!f) break;
      s = s.slice(0, -f.length);
      out.add(s);
    }
  }
  return [...out];
}

export class AnswerChecker {
  constructor(question) {
    this.accepted = [question.answer, ...(question.aliases || [])].map(normalize).filter(Boolean);
  }

  isCorrect(text) {
    const cleaned = normalize(text);
    if (!cleaned) return false;
    for (const v of variants(cleaned)) {
      for (const a of this.accepted) {
        if (v === a) return true;
        const slack = Math.min(SLACK_CHARS, Math.floor(a.length / 2));
        if (v.includes(a) && v.length - a.length <= slack) return true;
      }
    }
    return false;
  }
}
