/**
 * 顶部工具条
 * -------------------------------------------------------------
 * 运行/暂停、单步、复位、截图四个全局仿真操作，
 * 按钮激活态与仿真状态双向同步（含空格键快捷键）。
 */
import { bus } from '../core/EventBus.js';

export class Toolbar {
  /**
   * @param {SimulationEngine} simulation
   * @param {RendererManager} rendererManager
   */
  constructor(simulation, rendererManager) {
    this.sim = simulation;
    this.rendererManager = rendererManager;
    this.el = {
      play: document.getElementById('btn-play'),
      step: document.getElementById('btn-step'),
      reset: document.getElementById('btn-reset'),
      screenshot: document.getElementById('btn-screenshot')
    };
  }

  /** 绑定事件（模型加载后由 UIManager 调用） */
  bind() {
    this.el.play.addEventListener('click', () => {
      this.sim.toggleRunning();
    });
    this.el.step.addEventListener('click', () => {
      this.sim.singleStep();
    });
    this.el.reset.addEventListener('click', () => {
      this.sim.reset();
    });
    this.el.screenshot.addEventListener('click', () => {
      this.rendererManager.screenshot();
    });

    // 空格键：运行/暂停（输入框聚焦时不劫持）
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !this._isTyping(e.target)) {
        e.preventDefault();
        this.sim.toggleRunning();
      }
    });

    // 运行状态 -> 按钮文案与激活态
    bus.on('sim:running', (running) => {
      this.el.play.textContent = running ? '⏸ 暂停' : '▶ 运行';
      this.el.play.classList.toggle('active', running);
    });
  }

  _isTyping(target) {
    return target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
  }
}
