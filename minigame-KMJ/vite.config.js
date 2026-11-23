import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // transformers.js(Hugging Face)는 미리 묶지 않고 그대로 불러와야 해요
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
});
