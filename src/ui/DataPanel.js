/**
 * 实时数据面板
 * -------------------------------------------------------------
 * 展示仿真运动学参数（DOM 刷新做 250ms 节流，避免高频重排）：
 *  - 系统级：仿真时间、传动模式、主电机目标/实际转速、转盘角速度与转角、传动比
 *  - 杯位级：每个咖啡杯的自转 RPM、启停状态、切向线速度、摆臂限位状态
 */
import { bus } from '../core/EventBus.js';

export class DataPanel {
  /**
   * @param {SimulationEngine} simulation
   */
  constructor(simulation) {
    this.sim = simulation;
    this.rootEl = document.getElementById('data-root');
    this._lastDomUpdate = 0;
    this._lastState = null;
  }

  /** 订阅仿真状态流 */
  bind() {
    bus.on('sim:step', (state) => {
      this._lastState = state;
    });
    // 定时把最新状态刷到 DOM（节流）
    setInterval(() => {
      if (this._lastState) this._render(this._lastState);
    }, 250);
    // 初始骨架
    this.rootEl.innerHTML = '<div class="data-group"><div class="data-group-title">等待仿真数据…</div></div>';
  }

  /** 渲染一帧数据 */
  _render(s) {
    const cupRows = s.cups
      .map((c) => {
        const tSpeed = c.tangential.length().toFixed(2);
        const stateText = c.enabled ? '<span class="data-value ok">运行</span>' : '<span class="data-value warn">停止</span>';
        return `
          <div class="data-item">
            <span class="data-label">杯 #${c.index} 自转</span>
            <span class="data-value">${c.spinRPM.toFixed(1)} RPM</span>
          </div>
          <div class="data-item">
            <span class="data-label">杯 #${c.index} 切向速度 / 状态</span>
            <span class="data-value">${tSpeed} m/s　${stateText}</span>
          </div>`;
      })
      .join('');

    const armRows = s.arms
      .map(
        (a) => `
        <div class="data-item">
          <span class="data-label">摆臂 #${a.index} 角度</span>
          <span class="data-value ${a.limitHit ? 'warn' : ''}">${radToDeg(a.angle).toFixed(1)}°${a.limitHit ? ' ⚠限位' : ''}</span>
        </div>`
      )
      .join('');

    this.rootEl.innerHTML = `
      <div class="data-group">
        <div class="data-group-title">系统状态</div>
        <div class="data-item"><span class="data-label">仿真时间</span><span class="data-value">${s.simTime.toFixed(2)} s</span></div>
        <div class="data-item"><span class="data-label">运行状态</span>
          <span class="data-value ${s.running ? 'ok' : 'warn'}">${s.running ? '运行中' : '暂停/缓停'}</span></div>
        <div class="data-item"><span class="data-label">传动模式</span><span class="data-value">${s.modeLabel}</span></div>
        <div class="data-item"><span class="data-label">主电机目标转速</span><span class="data-value">${s.masterTargetRPM.toFixed(1)} RPM</span></div>
      </div>
      <div class="data-group">
        <div class="data-group-title">大转盘公转</div>
        <div class="data-item"><span class="data-label">实际转速</span><span class="data-value">${s.turntable.rpm.toFixed(2)} RPM</span></div>
        <div class="data-item"><span class="data-label">角速度 ω</span><span class="data-value">${s.turntable.omega.toFixed(3)} rad/s</span></div>
        <div class="data-item"><span class="data-label">累计转角</span><span class="data-value">${radToDeg(s.turntable.angle).toFixed(1)}°</span></div>
        <div class="data-item"><span class="data-label">当前传动比</span><span class="data-value">${s.transmissionRatio.toFixed(2)}</span></div>
      </div>
      <div class="data-group">
        <div class="data-group-title">咖啡杯自转（${s.cups.length} 杯位）</div>
        ${cupRows}
      </div>
      <div class="data-group">
        <div class="data-group-title">摩擦轮摆臂限位</div>
        ${armRows}
      </div>`;
  }
}

/** 弧度转角度（局部小工具，避免文件顶部依赖 three） */
function radToDeg(rad) {
  return (rad * 180) / Math.PI;
}
