/**
 * 底部状态栏
 * -------------------------------------------------------------
 * 实时显示 FPS、DrawCall、三角面数、当前画质档位与渲染模式；
 * 降级/升档时短暂高亮提示。
 */
import { bus } from '../core/EventBus.js';

export class StatusBar {
  /**
   * @param {PerformanceMonitor} perfMonitor
   * @param {RendererManager} rendererManager
   */
  constructor(perfMonitor, rendererManager) {
    this.perf = perfMonitor;
    this.rendererManager = rendererManager;
    this.el = {
      fps: document.getElementById('status-fps'),
      draw: document.getElementById('status-draw'),
      triangles: document.getElementById('status-triangles'),
      quality: document.getElementById('status-quality'),
      mode: document.getElementById('status-mode')
    };
  }

  bind() {
    // 250ms 刷新性能数字（与采样窗口解耦，数字变化更平滑）
    setInterval(() => {
      const { fps, drawCalls, triangles } = this.perf.lastStats;
      this.el.fps.textContent = `FPS: ${fps || '--'}`;
      this.el.draw.textContent = `DrawCalls: ${drawCalls || '--'}`;
      this.el.triangles.textContent = `三角面: ${triangles ? triangles.toLocaleString('zh-CN') : '--'}`;
      const level = this.perf.config.levels[this.perf.levelIndex];
      this.el.quality.textContent = `画质: ${this.perf._autoMode ? level.name + '（自动）' : level.name + '（手动）'}`;
    }, 250);

    bus.on('render:mode-changed', () => {
      this.el.mode.textContent = `模式: ${this.rendererManager.getModeLabel()}`;
    });
    bus.on('perf:degrade', ({ level, direction }) => {
      this.el.quality.textContent = `画质: ${level.name}（${direction === 'down' ? '自动降级' : '自动升档'}）`;
      this.el.quality.style.color = direction === 'down' ? 'var(--accent-warm)' : 'var(--ok)';
      setTimeout(() => (this.el.quality.style.color = ''), 2500);
    });
  }
}
