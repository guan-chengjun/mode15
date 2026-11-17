/**
 * 应用入口
 * -------------------------------------------------------------
 * 装配顺序：
 *  1. 先实例化 UIManager 并订阅 model:loaded（保证不遗漏事件）
 *  2. 启动 Engine（远程加载 HDR / GLTF → 注册部件 → 仿真与交互装配）
 *  3. 加载完成后隐藏启动遮罩；任何致命错误给出中文提示
 */
import './styles/main.css';
import { Engine } from './core/Engine.js';
import { UIManager } from './ui/UIManager.js';
import { logger } from './core/Logger.js';

/** 启动遮罩 DOM 操作 */
const loadingOverlay = document.getElementById('loading-overlay');
const loadingProgress = document.getElementById('loading-progress');
const loadingText = document.getElementById('loading-text');
const loadingHint = document.getElementById('loading-hint');

/**
 * 更新加载进度
 * @param {number} percent 0-100
 * @param {string} text 进度说明
 */
function updateLoading(percent, text) {
  loadingProgress.style.width = `${percent}%`;
  if (text) loadingText.textContent = text;
}

/** 加载完成：淡出遮罩 */
function hideLoading() {
  updateLoading(100, '初始化完成');
  setTimeout(() => {
    loadingOverlay.style.transition = 'opacity 0.5s ease';
    loadingOverlay.style.opacity = '0';
    setTimeout(() => loadingOverlay.classList.add('hidden'), 500);
  }, 300);
}

/** 致命错误：遮罩内给出中文诊断信息（页面不白屏） */
function showFatalError(err) {
  logger.error(`启动失败：${err.message || err}`);
  loadingProgress.style.width = '100%';
  loadingProgress.style.background = 'var(--danger)';
  loadingText.textContent = '初始化失败';
  loadingHint.innerHTML = `
    <strong style="color:var(--danger)">${String(err.message || err)}</strong><br/>
    请检查：① 模型/HDR 地址是否可访问（见 src/config/app.config.js）<br/>
    ② 浏览器控制台报错信息　③ 是否通过 npm run dev 访问而非直接打开 HTML
  `;
}

/**
 * 全局兜底：任何未被业务捕获的 Promise 异常只记录、不白屏。
 * 第三方加载器（如 GLTFLoader 扩展解析）可能存在逃逸的异步异常，
 * 业务层已有预检与回退，这里保证课堂环境下页面始终可用。
 */
window.addEventListener('unhandledrejection', (event) => {
  logger.error(`未捕获的异步异常（已兜底，不影响使用）：${event.reason?.message || event.reason}`);
  event.preventDefault();
});
window.addEventListener('error', (event) => {
  // 忽略静态资源加载噪声，仅记录脚本错误
  if (event.message && !event.target?.tagName) {
    logger.error(`全局脚本异常（已兜底）：${event.message}`);
  }
});

async function bootstrap() {
  try {
    updateLoading(2, '正在创建仿真引擎…');
    const engine = new Engine();

    // UI 先订阅，避免错过 model:loaded 事件
    const ui = new UIManager(engine);
    ui.init();

    updateLoading(5, '正在加载 HDR 环境与远程模型…');
    await engine.start(updateLoading);

    hideLoading();
    logger.info('应用启动完成，欢迎使用旋转咖啡杯机械仿真科普平台');
  } catch (err) {
    showFatalError(err);
  }
}

bootstrap();
