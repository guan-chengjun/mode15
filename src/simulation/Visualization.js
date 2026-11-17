/**
 * 运动可视化模块
 * -------------------------------------------------------------
 * 两类教学可视化元素：
 *  1. 矢量箭头（ArrowHelper）
 *     - 每个杯位一个“切向速度箭头”：方向 = 杯心切向，长度 ∝ 公转线速度
 *     - 每个杯位一个“自转角速度箭头”：沿杯体竖轴，方向体现正反转
 *  2. 运动轨迹（Line + 环形缓冲）
 *     - 记录杯心世界坐标，画出公转+自转耦合的复合轨迹（摆线特征）
 *     - 环形缓冲定长，长时间运行不膨胀
 */
import * as THREE from 'three';
import { bus } from '../core/EventBus.js';

/** 箭头长度缩放系数（把物理量映射到场景尺度） */
const TANGENT_SCALE = 0.28;
const SPIN_SCALE = 0.012;
/** 箭头基础长度下限，速度接近零时仍可见 */
const MIN_ARROW_LEN = 0.08;

export class Visualization {
  /**
   * @param {THREE.Scene} scene
   * @param {SimulationEngine} sim
   * @param {object} config APP_CONFIG.simulation
   */
  constructor(scene, sim, config) {
    this.scene = scene;
    this.sim = sim;
    this.config = config;

    this.group = new THREE.Group();
    this.group.name = 'visualization_overlay';
    this.group.visible = false; // 默认关闭，GUI 开关控制

    /** 每杯一套箭头 */
    this.tangentArrows = [];
    this.spinArrows = [];
    /** 每杯一条轨迹 */
    this.trails = [];

    this._trailTimer = 0;
    this._up = new THREE.Vector3(0, 1, 0);
    this._down = new THREE.Vector3(0, -1, 0);
  }

  /** 仿真初始化后，按杯位创建可视化元素 */
  init() {
    const n = this.sim.cups.length;
    for (let i = 0; i < n; i++) {
      // 切向速度箭头：青色
      const tangent = new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(),
        MIN_ARROW_LEN,
        0x36e0d0,
        0.16,
        0.09
      );
      tangent.name = `arrow_tangent_${i}`;

      // 自转角速度箭头：金色，立在杯体上方
      const spin = new THREE.ArrowHelper(
        this._up.clone(),
        new THREE.Vector3(),
        MIN_ARROW_LEN,
        0xffc84a,
        0.14,
        0.08
      );
      spin.name = `arrow_spin_${i}`;

      // 轨迹线：定长滑动缓冲
      const maxPoints = this.config.trailMaxPoints;
      const positions = new Float32Array(maxPoints * 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setDrawRange(0, 0);
      const material = new THREE.LineBasicMaterial({
        color: 0x7dd0ff,
        transparent: true,
        opacity: 0.75
      });
      const line = new THREE.Line(geometry, material);
      line.name = `trail_cup_${i}`;
      line.frustumCulled = false; // 动态缓冲，跳过包围盒剔除

      this.tangentArrows.push(tangent);
      this.spinArrows.push(spin);
      this.trails.push({ line, positions, count: 0, maxPoints });
      this.group.add(tangent, spin, line);
    }
    // 初始与 GUI 默认状态保持一致：总组隐藏，箭头/轨迹各自标记为不可见
    this.setArrowsVisible(false);
    this.setTrailsVisible(false);
    this.scene.add(this.group);
  }

  /** 总开关（GUI 调用） */
  setVisible(visible) {
    this.group.visible = visible;
  }

  /** 分别控制箭头与轨迹（GUI 细粒度开关） */
  setArrowsVisible(visible) {
    [...this.tangentArrows, ...this.spinArrows].forEach((a) => (a.visible = visible));
  }
  setTrailsVisible(visible) {
    this.trails.forEach((t) => (t.line.visible = visible));
  }

  /** 清空全部轨迹（复位与手动清除调用） */
  clearTrails() {
    for (const trail of this.trails) {
      trail.count = 0;
      trail.positions.fill(0);
      const attr = trail.line.geometry.attributes.position;
      attr.needsUpdate = true;
      trail.line.geometry.setDrawRange(0, 0);
    }
  }

  /**
   * 每帧更新（由 Engine 在仿真 step 之后调用）
   * @param {number} dt 帧间隔
   */
  update(dt) {
    if (!this.group.visible) return;
    const data = this.sim.visualData;

    data.cups.forEach((cup, i) => {
      const origin = cup.worldPos.clone();
      origin.y += 0.95; // 箭头抬到杯体上方，避免与模型穿插

      // —— 切向速度箭头 ——
      const tangentArrow = this.tangentArrows[i];
      const tSpeed = cup.tangential.length();
      if (tSpeed > 1e-3) {
        tangentArrow.setDirection(cup.tangential.clone().normalize());
      }
      tangentArrow.position.copy(origin);
      tangentArrow.setLength(Math.max(tSpeed * TANGENT_SCALE, MIN_ARROW_LEN), 0.16, 0.09);

      // —— 自转角速度箭头：正负反转方向 ——
      const spinArrow = this.spinArrows[i];
      const spinLen = Math.max(Math.abs(cup.spinOmega) * SPIN_SCALE * 10, MIN_ARROW_LEN);
      spinArrow.setDirection(cup.spinOmega >= 0 ? this._up : this._down);
      spinArrow.position.copy(origin).add(new THREE.Vector3(0, 0.12, 0));
      spinArrow.setLength(spinLen, 0.14, 0.08);
    });

    // —— 轨迹按固定时间间隔采样 ——
    this._trailTimer += dt;
    if (this._trailTimer >= this.config.trailInterval) {
      this._trailTimer = 0;
      this._sampleTrails();
    }
  }

  /** 采样一次杯心位置；缓冲写满后整体前移一位，保证点序始终连续 */
  _sampleTrails() {
    this.sim.visualData.cups.forEach((cup, i) => {
      const trail = this.trails[i];
      // 写满：把第 1..末尾的数据整体前移 1 个点（3 个 float），腾出最后一个位置
      if (trail.count >= trail.maxPoints) {
        trail.positions.copyWithin(0, 3, trail.maxPoints * 3);
        trail.count = trail.maxPoints - 1;
      }
      const idx = trail.count * 3;
      trail.positions[idx] = cup.worldPos.x;
      trail.positions[idx + 1] = cup.worldPos.y + 0.06;
      trail.positions[idx + 2] = cup.worldPos.z;
      trail.count = Math.min(trail.count + 1, trail.maxPoints);

      const attr = trail.line.geometry.attributes.position;
      attr.needsUpdate = true;
      trail.line.geometry.setDrawRange(0, trail.count);
    });
  }

  /** 释放几何与材质 */
  dispose() {
    for (const trail of this.trails) trail.line.geometry.dispose();
    this.trails.forEach((t) => t.line.material.dispose());
  }
}
