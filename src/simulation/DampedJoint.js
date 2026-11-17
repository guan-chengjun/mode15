/**
 * 阻尼关节
 * -------------------------------------------------------------
 * 机械仿真的基础运动学单元，体现真实机构的两个关键物理特性：
 *  1. 缓启缓停：角速度不会阶跃，而是按一阶惯性环节逼近目标值
 *        ω += (ω_target - ω) * (1 - exp(-k·dt))
 *     阻尼系数 k 越大，响应越快；越小则启动/停止越柔和。
 *     该模型等价于变频器软启动、电机转子惯性的教学化抽象。
 *
 *  2. 角度限位：角度被钳制在 [min, max] 区间，触限后速度归零，
 *     模拟机械挡块/限位开关，防止“无限旋转”的非物理演示。
 */
export class DampedJoint {
  /**
   * @param {object} opts
   * @param {string} opts.name 关节名称（日志用）
   * @param {number} [opts.damping=2.2] 阻尼系数 k
   * @param {number} [opts.minAngle=-Infinity] 角度下限（弧度）
   * @param {number} [opts.maxAngle=Infinity] 角度上限（弧度）
   * @param {number} [opts.initialAngle=0] 初始角度
   */
  constructor({ name, damping = 2.2, minAngle = -Infinity, maxAngle = Infinity, initialAngle = 0 }) {
    this.name = name;
    this.damping = damping;
    this.minAngle = minAngle;
    this.maxAngle = maxAngle;

    /** 当前角度（弧度） */
    this.angle = initialAngle;
    /** 当前角速度（弧度/秒） */
    this.angularVelocity = 0;
    /** 目标角速度（弧度/秒），由仿真引擎每帧设置 */
    this.targetAngularVelocity = 0;
    /** 本步是否触发限位（供日志与教学提示） */
    this.limitHit = false;
    this._limitSide = null; // 'min' | 'max' | null
  }

  /**
   * 推进一个固定时间步
   * @param {number} dt 固定步长（秒）
   */
  step(dt) {
    this.limitHit = false;

    // —— 一阶阻尼逼近目标角速度（指数缓动，数值稳定） ——
    const blend = 1 - Math.exp(-this.damping * dt);
    this.angularVelocity += (this.targetAngularVelocity - this.angularVelocity) * blend;

    // 速度极小且目标为零时直接钳零，避免浮点残余造成爬行
    if (Math.abs(this.angularVelocity) < 1e-4 && this.targetAngularVelocity === 0) {
      this.angularVelocity = 0;
    }

    // —— 积分角度 ——
    this.angle += this.angularVelocity * dt;

    // —— 角度限位处理 ——
    if (this.angle < this.minAngle) {
      this.angle = this.minAngle;
      this.angularVelocity = 0;
      this.limitHit = true;
      this._limitSide = 'min';
    } else if (this.angle > this.maxAngle) {
      this.angle = this.maxAngle;
      this.angularVelocity = 0;
      this.limitHit = true;
      this._limitSide = 'max';
    } else {
      this._limitSide = null;
    }
  }

  /** 当前限位侧（教学提示用） */
  get limitSide() {
    return this._limitSide;
  }

  /** 复位到初始状态 */
  reset(initialAngle = 0) {
    this.angle = initialAngle;
    this.angularVelocity = 0;
    this.targetAngularVelocity = 0;
    this.limitHit = false;
    this._limitSide = null;
  }
}
