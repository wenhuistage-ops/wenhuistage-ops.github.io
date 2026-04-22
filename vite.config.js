import { defineConfig } from 'vite'
import legacy from '@vitejs/plugin-legacy'

// 自訂插件：保留 HTML 中的原始脚本标签
const preserveScriptsPlugin = {
  name: 'preserve-scripts',
  transformIndexHtml: {
    order: 'pre',
    handler(html) {
      // 在开发环境中不修改 HTML，保留原始脚本标签
      if (process.env.NODE_ENV === 'development') {
        return html;
      }
      return html;
    }
  }
};

export default defineConfig({
  plugins: [
    legacy({
      targets: ['defaults', 'not IE 11']
    }),
    preserveScriptsPlugin
  ],
  root: '.',
  base: '/',
  build: {
    target: 'esnext',
    minify: 'terser',
    sourcemap: false,
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: 'index.html',
      external: ['./dist/compiled.css']
    }
  },
  server: {
    port: 5173,
    open: false,  // 防止自動打開
    host: true,
    // 禁用依賴優化
    preTransformRequests: false
  }
})
