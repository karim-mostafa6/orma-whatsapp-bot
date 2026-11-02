import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// الواجهة بتتبني لـ web/dist، والبوت بيعرضها على http://localhost:3000
export default defineConfig({
  root: here,
  plugins: [react()],
  build: { outDir: path.join(here, 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { proxy: { '/api': 'http://localhost:3000' }, fs: { allow: [path.join(here, '..')] } },
});
