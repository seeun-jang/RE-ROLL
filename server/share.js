// =====================================================
// 아무 컴퓨터에서나 접속하게 열기 (npm run share)
//  - 이 컴퓨터에서 서버를 켜고, Cloudflare 무료 터널로 인터넷 주소(https://….trycloudflare.com)를 만듦
//  - 가입 없이 바로 됨 · 진짜 HTTPS 라서 카메라 · 마이크 · WebGPU 도 됨
//  - 이 창을 닫거나 컴퓨터가 잠들면 주소도 끊김. 켤 때마다 주소가 바뀜
//  - 필요한 것: cloudflared (맥: brew install cloudflared)
// =====================================================
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.HTTP_PORT || 8080;
const urlFile = path.join(HERE, 'public-url.txt');
fs.rmSync(urlFile, { force: true });

const server = spawn(process.execPath, [path.join(HERE, 'server.js')], { stdio: 'inherit', env: { ...process.env, HTTP_PORT: String(PORT) } });
const tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });

let shown = false;
const watch = (buf) => {
  const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!m || shown) return;
  shown = true;
  fs.writeFileSync(urlFile, m[0]);
  const line = '='.repeat(60);
  console.log(`\n${line}\n  🌍 어디서나 접속:  ${m[0]}\n  (이 주소를 친구들에게 보내 주세요 · 이 창을 끄면 끊겨요)\n${line}\n`);
};
tunnel.stdout.on('data', watch);
tunnel.stderr.on('data', watch);
tunnel.on('error', () => {
  console.error('\ncloudflared 가 없어요. 맥이면: brew install cloudflared  (윈도우: winget install Cloudflare.cloudflared)\n');
  server.kill();
  process.exit(1);
});

const stop = () => { fs.rmSync(urlFile, { force: true }); tunnel.kill(); server.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
tunnel.on('exit', (code) => { if (code) console.error(`터널이 끊겼어요 (코드 ${code})`); });
server.on('exit', () => { tunnel.kill(); process.exit(0); });
