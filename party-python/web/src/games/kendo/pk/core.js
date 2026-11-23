// 원본 검도 코드 중 판정에 필요한 부분(설정·판정·선수·규칙)만 불러온다. 화면이 없어도 돈다.
// pk/ 폴더의 파일은 원본 그대로이며(전역 PK 에 등록되는 방식), 불러오는 순서가 중요하다.
import './env.js';
import './config.js';
import './game/judge.js';
import './game/fighter.js';
import './game/rules.js';

export const PK = globalThis.PK;
