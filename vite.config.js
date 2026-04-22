import { defineConfig } from 'vite'
import legacy from '@vitejs/plugin-legacy'
import { copyFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'

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

// 自訂插件：複製 node_modules 依賴到 dist
const copyDependenciesPlugin = {
  name: 'copy-dependencies',
  async writeBundle() {
    if (process.env.NODE_ENV === 'production') {
      const deps = [
        'node_modules/leaflet/dist/leaflet.js',
        'node_modules/leaflet/dist/leaflet.css',
        'node_modules/dompurify/dist/purify.js',
        'node_modules/xlsx/dist/xlsx.full.min.js'
      ];

      deps.forEach(dep => {
        try {
          const src = resolve(dep);
          const dest = resolve('dist', dep);
          // 建立目錄
          mkdirSync(resolve('dist', dep).replace(/\/[^/]+$/, ''), { recursive: true });
          // 複製文件
          copyFileSync(src, dest);
          console.log(`✓ Copied ${dep}`);
        } catch (err) {
          console.warn(`⚠ Failed to copy ${dep}:`, err.message);
        }
      });
    }
  }
};

export default defineConfig({
  plugins: [
    legacy({
      targets: ['defaults', 'not IE 11']
    }),
    preserveScriptsPlugin,
    copyDependenciesPlugin
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
    open: false,
    host: true,
    preTransformRequests: false
  }
})
