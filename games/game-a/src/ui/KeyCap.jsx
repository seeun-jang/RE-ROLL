// 키보드 키 모양
import { KEY_LABELS } from '../config.js';

export default function KeyCap({ code }) {
  return <kbd className="bc-key">{KEY_LABELS[code] ?? code}</kbd>;
}

export function Keys({ codes }) {
  return (
    <span className="bc-keys">
      <KeyCap code={codes[0]} />
    </span>
  );
}
