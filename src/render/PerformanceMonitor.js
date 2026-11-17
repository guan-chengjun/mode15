/**
 * 性能自动降级监控器
 * -------------------------------------------------------------
 * 策略（配置见 APP_CONFIG.performance）：
 *  - 按固定采样窗口统计 FPS、DrawCall、三角面
 *  - 连续 1 个窗口低于 degradeFps → 降一档（像素比→阴影→阴影分辨率→HDR）
 *  - 连续 3 个窗口高于 upgradeFps → 尝试升一档（带防抖，避免反复横跳）
 *  - 升降档通过 perf:degrade 事件通知 RendererManager 与状态栏
 */
import { bus } from '../core/EventBus.js';
import { logger } from '../core/Logger.js';

export class PerformanceMonitor {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} config APP_CONFIG.performance
   */
  constructor(renderer, config) {
    this.renderer = renderer;
    this.config = config;

    this._frames = 0;
    this._elapsed = 0;
    this._goodWindows = 0; // 连续高帧窗口计数（升档防抖）
    this.levelIndex = 0;   // 当前档位下标，0 = 最高
    this.lastStats = { fps: 0, drawCalls: 0, triangles: 0 };

    /** 降级回调（由 Engine 注入，内部调用 rendererManager.applyQuality） */
    this.onLevelChange = null;
    this._autoMode = true; // 手动锁定档位时关闭自动策略
  }

  /** 关闭自动降级（GUI 手动指定画质时调用） */
  setAuto(enabled) {
    this._autoMode = enabled;
  }

  /** 手动切档 */
  setLevel(index) {
    index = THREE_clamp(index, 0, this.config.levels.length - 1);
    if (index === this.levelIndex) return;
    this.levelIndex = index;
    this._goodWindows = 0;
    this.onLevelChange?.(this.config.levels[index], index);
  }

  /**
   * 每帧调用
   * @param {number} dt 帧间隔（秒）
   */
  update(dt) {
    this._frames++;
    this._elapsed += dt;
    if (this._elapsed < this.config.sampleInterval / 1000) return;

    // —— 采样窗口结束，汇总统计 ——
    const fps = Math.round(this._frames / this._elapsed);
    const info = this.renderer.info.render;
    this.lastStats = { fps, drawCalls: info.calls, triangles: info.triangles };

    if (this._autoMode) this._evaluate(fps);

    this._frames = 0;
    this._elapsed = 0;
  }

  /** 根据窗口 FPS 评估升降档 */
  _evaluate(fps) {
    if (fps < this.config.degradeFps && this.levelIndex < this.config.levels.length - 1) {
      // 性能不足：立即降档，并重置升档计数
      this._goodWindows = 0;
      this.levelIndex++;
      const level = this.config.levels[this.levelIndex];
      this.onLevelChange?.(level, this.levelIndex);
      bus.emit('perf:degrade', { level, index: this.levelIndex, fps, direction: 'down' });
      logger.warn(`性能降级 →「${level.name}」档（窗口 FPS=${fps}，低于阈值 ${this.config.degradeFps}）`);
    } else if (fps > this.config.upgradeFps && this.levelIndex > 0) {
      // 性能富余：连续 3 个窗口达标才升档，防抖
      this._goodWindows++;
      if (this._goodWindows >= 3) {
        this.levelIndex--;
        const level = this.config.levels[this.levelIndex];
        this.onLevelChange?.(level, this.levelIndex);
        bus.emit('perf:degrade', { level, index: this.levelIndex, fps, direction: 'up' });
        logger.info(`性能升档 →「${level.name}」档（连续 3 窗口 FPS=${fps}）`);
        this._goodWindows = 0;
      }
    } else {
      this._goodWindows = 0;
    }
  }
}

/** 数值限幅（避免为一个小工具再引 lodash） */
function THREE_clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}
