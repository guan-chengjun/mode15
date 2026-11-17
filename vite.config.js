import { defineConfig } from 'vite';

/**
 * Vite 构建配置
 * - base 使用相对路径 './'，构建产物可部署到任意子目录
 * - GLTF/GLB/HDR 等大资源通过 URL 远程加载，不打包进 JS（见 src/config/app.config.js）
 */
export default defineConfig({
  // 相对路径部署：构建后的 dist 可放到 Nginx/Apache 任意子目录
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    open: true,
    // 远程模型跨域调试时，可在此配置代理（示例，默认关闭）
    // proxy: {
    //   '/models': { target: 'https://your-cdn.example.com', changeOrigin: true }
    // }
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 4096, // 小于 4KB 的资源才内联，模型/HDR 一律不内联
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // 第三方依赖单独分包，利于浏览器缓存
        manualChunks: {
          three: ['three'],
          postprocessing: ['postprocessing'],
          gui: ['lil-gui'],
          physics: ['cannon-es']
        }
      }
    }
  },
  // 预加载常用的 three 插件模块，加快冷启动
  optimizeDeps: {
    include: ['three', 'postprocessing', 'lil-gui']
  }
});
