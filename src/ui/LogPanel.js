/**
 * 仿真日志面板
 * -------------------------------------------------------------
 * - 订阅 sim:log 事件实时追加，自动滚动到最新行
 * - 对接 Logger 的 CSV 导出与清空
 * - 按级别着色（INFO/WARN/ERROR）
 */
import { logger } from '../core/Logger.js';
import { bus } from '../core/EventBus.js';

export class LogPanel {
  constructor() {
    this.rootEl = document.getElementById('log-root');
    this.exportBtn = document.getElementById('btn-export-log');
    this.clearBtn = document.getElementById('btn-clear-log');
  }

  bind() {
    bus.on('sim:log', (payload) => {
      if (payload.cleared) {
        this.rootEl.innerHTML = '';
      } else {
        this.append(payload);
      }
    });
    this.exportBtn.addEventListener('click', () => logger.exportCSV());
    this.clearBtn.addEventListener('click', () => {
      logger.clear();
      this.rootEl.innerHTML = '';
    });
  }

  /** 追加一条日志 */
  append(entry) {
    const line = document.createElement('div');
    line.className = 'log-line';
    const time = `t=${entry.simTime.toFixed(2)}s`;
    line.innerHTML = `
      <span class="log-time">${time}</span>
      <span class="log-level-${entry.level}">[${entry.level}]</span>
      <span class="log-msg"></span>`;
    // textContent 写入，防止模型/文案中的特殊字符破坏 DOM
    line.querySelector('.log-msg').textContent = entry.message;
    this.rootEl.appendChild(line);

    // 限制 DOM 节点数量，与 Logger 环形缓冲双保险
    while (this.rootEl.children.length > 300) {
      this.rootEl.removeChild(this.rootEl.firstChild);
    }
    // 自动滚底（用户向上翻看时不强制打断：仅在接近底部时跟随）
    const nearBottom = this.rootEl.scrollHeight - this.rootEl.scrollTop - this.rootEl.clientHeight < 80;
    if (nearBottom) this.rootEl.scrollTop = this.rootEl.scrollHeight;
  }
}
