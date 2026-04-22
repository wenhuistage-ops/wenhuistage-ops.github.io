import { defineConfig } from 'vite'
import legacy from '@vitejs/plugin-legacy'

export default defineConfig({
  plugins: [
    legacy({
      targets: ['defaults', 'not IE 11']
    })
  ],
  root: '.',
  base: '/',
  build: {
    target: 'esnext',
    minify: 'terser',
    sourcemap: false,
    outDir: 'dist',
    emptyOutDir: false,  // 保留 dist/ 下的其他文件（如 compiled.css）
    rollupOptions: {
      input: 'index.html',
      external: ['./dist/compiled.css']  // 不處理 compiled.css，保留原檔案
    }
  },
  server: {
    port: 5173,
    open: true,
    host: true
  }
})
