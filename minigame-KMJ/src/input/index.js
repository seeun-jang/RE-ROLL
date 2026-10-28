import { createKeyboardInput } from './keyboardInput.js';
import { createMotionInput } from './motionInput.js';

// type: 'keyboard' | 'motion', clock: 노래 시간을 돌려주는 함수
export function createInput(type = 'keyboard', clock) {
  return type === 'motion' ? createMotionInput(clock) : createKeyboardInput(clock);
}
