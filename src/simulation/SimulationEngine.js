/**
 * 机械仿真引擎
 * -------------------------------------------------------------
 * 本项目的教学核心——不是简单循环动画，而是带物理约束的运动学仿真：
 *
 * 【两种传动模式】
 *  A. friction 摩擦耦合联动（默认）
 *     主电机 → 回转支承 → 大转盘公转；
 *     摩擦轮摆臂压紧杯底盘，靠摩擦力把公转耦合为杯体自转，
 *     自转目标速度 = 转盘角速度 × 摩擦传动比（教学演示量）。
 *     摆臂角度随主电机转速缓动到“压紧位”，受 armLimit 角度限位。
 *
 *  B. independent 独立驱动
 *     摩擦轮摆臂抬起脱开（限位演示），每个杯位由独立电机驱动，
 *     可单独启停、调速、反转，杯体之间运动完全解耦。
 *
 * 【共同特性】
 *   - 全部转动经 DampedJoint：缓启缓停 + 角度限位
 *   - 固定时间步长积分；支持运行/暂停/单步/复位
 *   - 输出每个杯位的角速度、线速度、传动比等数据供面板与矢量可视化使用
 */
import * as THREE from 'three';
import { DampedJoint } from './DampedJoint.js';
import { bus } from '../core/EventBus.js';
import { logger } from '../core/Logger.js';

/** 转/分（RPM）→ 弧度/秒 */
const rpmToRad = (rpm) => (rpm * Math.PI * 2) / 60;
/** 弧度/秒 → 转/分 */
const radToRpm = (rad) => (rad * 60) / (Math.PI * 2);

export class SimulationEngine {
  /**
   * @param {PartRegistry} registry 部件注册表
   * @param {object} config APP_CONFIG.simulation
   */
  constructor(registry, config) {
    this.registry = registry;
    this.config = config;

    /** 固定步长（秒） */
    this.fixedDt = config.fixedDt;
    /** 累计仿真时间（秒） */
    this.simTime = 0;
    /** 运行标志（false 时主循环不推进积分，单步除外） */
    this.running = false;
    /** 传动模式 */
    this.mode = config.defaultMode;

    /** 主电机目标转速（RPM，GUI 可调） */
    this.masterTargetRPM = config.masterRPM;
    /** 大转盘公转关节（无限位，整周回转） */
    this.turntableJoint = new DampedJoint({ name: '大转盘公转', damping: config.damping });

    /** 杯位仿真状态（与 registry.cupStations 一一对应） */
    this.cups = [];
    /** 摩擦轮摆臂关节（带角度限位） */
    this.armJoints = [];

    /** 可视化数据（每步刷新，供箭头/轨迹模块读取） */
    this.visualData = {
      turntable: { angularVelocity: 0, rpm: 0 },
      cups: []
    };

    this._initialized = false;
    /** 限位日志节流，避免每帧刷屏 */
    this._armLimitLogged = false;
  }

  /** 注册表扫描完成后初始化杯位状态 */
  init() {
    const stations = this.registry.cupStations;
    this.cups = stations.map((st) => ({
      index: st.index,
      station: st,
      /** 自转角速度（弧度/秒） */
      spinVelocity: 0,
      /** 目标自转转速（RPM）；独立模式下可单杯设置 */
      targetRPM: this.config.cupDefaultRPM,
      /** 单杯使能（独立模式下可单独停转） */
      enabled: true,
      /** 杯心当前世界坐标（随转盘公转更新） */
      worldPos: st.pivot.clone(),
      /** 杯心切向线速度（用于矢量箭头） */
      tangentialVelocity: new THREE.Vector3(),
      /** 自转角速度矢量方向（世界系 Y 轴分量 + 正负号） */
      spinAxis: new THREE.Vector3(0, 1, 0)
    }));

    // 每个杯位一个摩擦轮摆臂关节：允许在 [-armLimit, +armLimit] 内摆动
    this.armJoints = stations.map(
      (st) =>
        new DampedJoint({
          name: `摩擦轮摆臂#${st.index}`,
          damping: this.config.damping * 1.4,
          minAngle: -this.config.armLimit,
          maxAngle: this.config.armLimit,
          initialAngle: 0
        })
    );
    this._initialized = true;
    logger.info(`仿真引擎初始化：${this.cups.length} 个杯位，模式「${this.modeLabel}」，步长 ${this.fixedDt}s`);
  }

  /** 模式中文名 */
  get modeLabel() {
    return this.mode === 'friction' ? '摩擦耦合联动' : '独立驱动';
  }

  /** 切换传动模式 */
  setMode(mode) {
    if (!['friction', 'independent'].includes(mode) || mode === this.mode) return;
    this.mode = mode;
    bus.emit('sim:mode-changed', mode);
    logger.info(`传动模式切换为「${this.modeLabel}」`);
  }

  /** 运行 / 暂停 */
  setRunning(running) {
    if (this.running === running) return;
    this.running = running;
    bus.emit('sim:running', running);
    logger.info(running ? '仿真开始运行（缓启）' : '仿真暂停（缓停，机构将平滑停转）');
  }

  toggleRunning() {
    this.setRunning(!this.running);
    return this.running;
  }

  /**
   * 单步仿真：无论是否处于运行状态，都精确推进一个固定时间步
   */
  singleStep() {
    if (!this._initialized) return;
    this._integrate(this.fixedDt);
    bus.emit('sim:step', this.getState());
    logger.info(`单步仿真推进 ${this.fixedDt}s，当前仿真时间 ${this.simTime.toFixed(3)}s`);
  }

  /** 主循环每帧调用：运行中按固定步长积分（本项目渲染帧率与步长接近，单步即可） */
  update() {
    if (!this._initialized || !this.running) {
      // 暂停时仍发布状态，保证数据面板显示速度衰减到零的过程
      if (this._initialized) {
        this._integrate(this.fixedDt, true);
        bus.emit('sim:step', this.getState());
      }
      return;
    }
    this._integrate(this.fixedDt);
    bus.emit('sim:step', this.getState());
  }

  /**
   * 核心积分流程
   * @param {number} dt 固定步长
   * @param {boolean} paused 是否处于暂停态（暂停时目标速度清零，演示缓停）
   */
  _integrate(dt, paused = false) {
    this.simTime += dt;
    logger.setSimTime(this.simTime);

    // —— 1. 主电机/大转盘：暂停或停用时目标为零，关节自身完成缓停 ——
    const masterRPM = paused ? 0 : this.masterTargetRPM;
    this.turntableJoint.targetAngularVelocity = rpmToRad(masterRPM);
    this.turntableJoint.step(dt);
    this._applyTurntableRotation();

    // —— 2. 杯位自转与摩擦轮摆臂 ——
    const omegaDisk = this.turntableJoint.angularVelocity;

    this.cups.forEach((cup, i) => {
      const arm = this.armJoints[i];

      if (this.mode === 'friction') {
        // 联动模式：摆臂压向杯底盘（目标摆角与转盘转速挂钩，体现“运转才压紧”）
        const engage = Math.min(Math.abs(omegaDisk) / rpmToRad(this.masterTargetRPM || 1), 1);
        arm.targetAngularVelocity = 0; // 摆臂是角度控制，这里直接给目标角度后用阻尼逼近
        arm._targetAngle = this.config.armLimit * 0.6 * engage;
        this._driveArmToAngle(arm, dt);

        // 摩擦传动：杯体自转跟随转盘角速度 × 传动比；暂停或停用杯位时目标为零（缓停）
        const coupledRPM = paused ? 0 : radToRpm(omegaDisk) * this.config.frictionRatio;
        const targetOmega = cup.enabled ? rpmToRad(coupledRPM) : 0;
        cup.spinVelocity += (targetOmega - cup.spinVelocity) * (1 - Math.exp(-this.config.damping * dt));
      } else {
        // 独立模式：摆臂抬起脱开，触及最小限位
        arm._targetAngle = -this.config.armLimit * 0.85;
        this._driveArmToAngle(arm, dt);

        // 独立电机：单杯目标转速，支持停转与反转；暂停时全局缓停
        const targetOmega = !paused && cup.enabled ? rpmToRad(cup.targetRPM) : 0;
        cup.spinVelocity += (targetOmega - cup.spinVelocity) * (1 - Math.exp(-this.config.damping * dt));
      }

      if (arm.limitHit && !this._armLimitLogged) {
        logger.warn(`摩擦轮摆臂#${cup.index} 到达${arm.limitSide === 'min' ? '脱开（最小）' : '压紧（最大）'}角度限位`);
        this._armLimitLogged = true;
        setTimeout(() => (this._armLimitLogged = false), 1500);
      }

      // —— 3. 应用自转到场景节点 ——
      cup.station.spinNode.rotation.y += cup.spinVelocity * dt;

      // —— 4. 更新杯心世界坐标与切向速度（矢量可视化用） ——
      cup.station.spinNode.getWorldPosition(cup.worldPos);
      // 切向速度 v = ω × r，转盘绕世界 Y 轴
      cup.tangentialVelocity
        .set(-cup.worldPos.z, 0, cup.worldPos.x)
        .normalize()
        .multiplyScalar(omegaDisk * Math.hypot(cup.worldPos.x, cup.worldPos.z));
    });

    this._refreshVisualData();
  }

  /**
   * 角度型阻尼驱动：把摆臂目标角度转换为角速度指令，再交给关节积分与限位
   * （教学化处理：比例控制 + 关节自身阻尼，避免硬切角度）
   */
  _driveArmToAngle(arm, dt) {
    const target = arm._targetAngle ?? 0;
    const error = target - arm.angle;
    arm.targetAngularVelocity = THREE.MathUtils.clamp(error * 4, -1.2, 1.2);
    arm.step(dt);
    arm.limitHit &&= Math.abs(error) > 0.01; // 到达指令目标不算“撞限位”
    this._applyArmRotation(arm);
  }

  /** 把转盘关节角度写入场景节点 */
  _applyTurntableRotation() {
    if (this.registry.turntable) {
      this.registry.turntable.rotation.y = this.turntableJoint.angle;
    }
    if (this.registry.motor) {
      // 电机小齿轮转向与齿圈相反，演示啮合关系（齿数比简化为固定演示值 4）
      this.registry.motor.rotation.y = -this.turntableJoint.angle * 4;
    }
  }

  /** 摆臂角度写入对应摩擦轮节点局部 Z 轴 */
  _applyArmRotation(arm) {
    const index = this.armJoints.indexOf(arm);
    const node = this.cups[index]?.station?.frictionWheel?.root;
    if (node) node.rotation.z = arm.angle;
  }

  /** 汇总可视化/面板数据 */
  _refreshVisualData() {
    this.visualData.turntable.angularVelocity = this.turntableJoint.angularVelocity;
    this.visualData.turntable.rpm = radToRpm(this.turntableJoint.angularVelocity);
    this.visualData.cups = this.cups.map((cup) => ({
      index: cup.index,
      spinRPM: radToRpm(cup.spinVelocity),
      spinOmega: cup.spinVelocity,
      worldPos: cup.worldPos.clone(),
      tangential: cup.tangentialVelocity.clone(),
      enabled: cup.enabled
    }));
  }

  /* ---------------- 单杯控制（GUI 调用） ---------------- */

  /** 设置单杯目标自转转速（RPM，独立模式生效；联动模式记录为停用后的预设） */
  setCupRPM(index, rpm) {
    const cup = this.cups.find((c) => c.index === index);
    if (cup) cup.targetRPM = THREE.MathUtils.clamp(rpm, -60, 60);
  }

  /** 单杯启停 */
  setCupEnabled(index, enabled) {
    const cup = this.cups.find((c) => c.index === index);
    if (!cup || cup.enabled === enabled) return;
    cup.enabled = enabled;
    logger.info(`杯位 #${index} ${enabled ? '启动' : '停止'}（${this.modeLabel}模式，缓变过渡）`);
  }

  /** 主电机转速设置 */
  setMasterRPM(rpm) {
    this.masterTargetRPM = THREE.MathUtils.clamp(rpm, 0, 30);
  }

  /** 阻尼系数设置（同步到全部关节，演示软启动硬度） */
  setDamping(k) {
    this.config.damping = k;
    this.turntableJoint.damping = k;
    for (const arm of this.armJoints) arm.damping = k * 1.4;
  }

  /** 复位：全部关节与场景节点回到初始位姿 */
  reset() {
    this.simTime = 0;
    this.running = false;
    this.turntableJoint.reset();
    for (const arm of this.armJoints) arm.reset(0);
    this.cups.forEach((cup) => {
      cup.spinVelocity = 0;
      cup.station.spinNode.rotation.y = 0;
    });
    if (this.registry.turntable) this.registry.turntable.rotation.y = 0;
    if (this.registry.motor) this.registry.motor.rotation.y = 0;
    this.armJoints.forEach((arm) => this._applyArmRotation(arm));
    this._refreshVisualData();
    bus.emit('sim:reset');
    bus.emit('sim:running', false);
    bus.emit('sim:step', this.getState());
    logger.info('仿真已复位，全部机构回到初始位姿');
  }

  /** 当前完整状态快照（数据面板、日志导出使用） */
  getState() {
    return {
      simTime: this.simTime,
      running: this.running,
      mode: this.mode,
      modeLabel: this.modeLabel,
      masterTargetRPM: this.masterTargetRPM,
      turntable: {
        rpm: radToRpm(this.turntableJoint.angularVelocity),
        omega: this.turntableJoint.angularVelocity,
        angle: this.turntableJoint.angle
      },
      transmissionRatio: this.mode === 'friction' ? this.config.frictionRatio : 1,
      cups: this.visualData.cups.map((c) => ({ ...c })),
      arms: this.armJoints.map((a, i) => ({
        index: this.cups[i]?.index ?? i,
        angle: a.angle,
        limitHit: a.limitHit,
        limitSide: a.limitSide
      }))
    };
  }
}
