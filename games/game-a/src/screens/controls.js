// 조작 안내에 쓰는 목록과 키 이름 도우미 (타이틀, 경기 화면에서 함께 사용)
import { KEY_LABELS } from '../config.js';

export const CONTROL_ROWS = [
  { action: 'move', label: '이동' },
  { action: 'punch', label: '펀치' },
  { action: 'kick', label: '킥' },
  { action: 'guard', label: '가드' },
  { action: 'special', label: '필살기' },
];

export function keyText(codes) {
  return codes.map((c) => KEY_LABELS[c] ?? c).join(' / ');
}
