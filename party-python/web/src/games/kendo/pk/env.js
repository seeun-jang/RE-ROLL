// 원본 검도 코드는 window.PK 라는 전역 이름공간에 자신을 등록한다.
// 브라우저가 아닌 곳(테스트용 Node.js)에서도 돌도록 window 를 준비한다.
if (typeof window === 'undefined') globalThis.window = globalThis;
