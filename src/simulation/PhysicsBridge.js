/**
 * Cannon-es 惯性物理桥接（可选模块）
 * -------------------------------------------------------------
 * 教学目的：演示“为什么旋转机械需要缓启缓停”。
 * 启用后在大转盘上放置若干无约束金属小球：
 *  - 急启动时，小球因惯性相对盘面打滑、甩出（静摩擦力不足以提供向心力）
 *  - 缓启动时，小球可随盘一起转动，直观对比两种启动曲线
 *
 * 设计为可选开关：
 *  - cannon-es 通过动态 import() 按需加载，关闭时不产生首屏体积
 *  - 物理世界只包含演示体，不干扰主仿真的运动学机构
 */
import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { logger } from '../core/Logger.js';

/** 演示小球数量与摆放半径 */
const BALL_COUNT = 5;
const BALL_RADIUS = 0.09;
const BALL_ORBIT = 1.15;

export class PhysicsBridge {
  /**
   * @param {THREE.Scene} scene
   * @param {SimulationEngine} sim
   */
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.enabled = false;
    this.world = null;
    this.bodies = [];
    this.meshes = [];
    this.group = new THREE.Group();
    this.group.name = 'physics_inertia_demo';
    this.group.visible = false;
    this._module = null;
  }

  /** 动态加载 cannon-es 并初始化物理世界（首次开启时调用一次） */
  async enable() {
    if (this.enabled) return;
    if (!this._module) {
      logger.info('正在按需加载 cannon-es 物理引擎…');
      // 动态导入：打包时自动切成独立 chunk，不影响首屏
      this._module = await import('cannon-es');
    }
    const CANNON = this._module;

    if (!this.world) this._initWorld(CANNON);
    this.enabled = true;
    this.group.visible = true;
    this._resetBodies(CANNON);
    bus.emit('physics:toggle', true);
    logger.info('惯性物理演示已开启（观察缓启/急启时小球的打滑与甩出差异）');
  }

  /** 关闭物理演示（保留已加载模块，再次开启无需下载） */
  disable() {
    this.enabled = false;
    this.group.visible = false;
    bus.emit('physics:toggle', false);
    logger.info('惯性物理演示已关闭');
  }

  toggle() {
    return this.enabled ? (this.disable(), false) : (this.enable(), true);
  }

  /** 初始化物理世界、材质与演示网格 */
  _initWorld(CANNON) {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);

    // 盘面世界高度取大转盘节点的世界包围盒（兼容模型归一化后的任意尺度）
    const diskTopY = this._getTurntableTopY();

    // 接触材质：钢球对盘面，低摩擦以便观察打滑
    const ballMat = new CANNON.Material('ball_material');
    const diskMat = new CANNON.Material('disk_material');
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(ballMat, diskMat, {
        friction: 0.25,
        restitution: 0.35
      })
    );

    // 静态地面（兜底，防止小球掉出世界）
    const groundBody = new CANNON.Body({ mass: 0, material: diskMat, shape: new CANNON.Plane() });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    groundBody.position.y = 0.0;
    this.world.addBody(groundBody);

    // 旋转盘面对应的运动学刚体（高度与大转盘一致）
    this.diskBody = new CANNON.Body({
      mass: 0, // 质量为 0 + type KINEMATIC 才能由代码驱动速度
      type: CANNON.Body.KINEMATIC,
      material: diskMat,
      shape: new CANNON.Cylinder(2.45, 2.45, 0.16, 40)
    });
    // CANNON 圆柱高度沿局部 Y，原点在质心，因此整体上移半高使其顶面贴合盘面
    this._diskCenterY = diskTopY - 0.08;
    this.diskBody.position.set(0, this._diskCenterY, 0);
    this.world.addBody(this.diskBody);
    this._ballRestY = diskTopY + BALL_RADIUS + 0.02;

    // 小球刚体与可视化网格
    const sphereGeo = new THREE.SphereGeometry(BALL_RADIUS, 24, 16);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0xb8c4d6,
      metalness: 0.95,
      roughness: 0.18
    });
    for (let i = 0; i < BALL_COUNT; i++) {
      const body = new CANNON.Body({
        mass: 0.6,
        shape: new CANNON.Sphere(BALL_RADIUS),
        material: ballMat,
        linearDamping: 0.02,
        angularDamping: 0.05
      });
      this.world.addBody(body);
      this.bodies.push(body);

      const mesh = new THREE.Mesh(sphereGeo, sphereMat);
      mesh.castShadow = true;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    this.scene.add(this.group);
  }

  /** 测量大转盘顶面的世界 Y 坐标（模型尺度经归一化，不能写死高度） */
  _getTurntableTopY() {
    const node = this.sim.registry.turntable;
    if (!node) return 0.85;
    node.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(node);
    return box.max.y;
  }

  /** 复位小球到盘面初始位置 */
  _resetBodies(CANNON) {
    this.bodies.forEach((body, i) => {
      const a = (i / BALL_COUNT) * Math.PI * 2;
      body.position.set(Math.cos(a) * BALL_ORBIT, this._ballRestY, Math.sin(a) * BALL_ORBIT);
      body.velocity.set(0, 0, 0);
      body.angularVelocity.set(0, 0, 0);
      body.quaternion.set(0, 0, 0, 1);
    });
    this.diskBody.angularVelocity.set(0, 0, 0);
  }

  /**
   * 每帧同步：
   *  1. 把仿真引擎的转盘角速度写入运动学刚体（缓启曲线由此传递给物理世界）
   *  2. 步进物理世界
   *  3. 刚体位姿回写到 three 网格
   */
  update(dt) {
    if (!this.enabled || !this.world) return;

    // 转盘绕 Y 轴角速度（弧度/秒），直接取自主仿真关节
    const omega = this.sim.turntableJoint.angularVelocity;
    this.diskBody.angularVelocity.set(0, omega, 0);
    this.diskBody.quaternion.setFromEuler(0, this.sim.turntableJoint.angle, 0);

    this.world.step(1 / 60, dt, 3);

    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      this.meshes[i].position.set(b.position.x, b.position.y, b.position.z);
      this.meshes[i].quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);

      // 掉出演示区域的小球自动归位，保证课堂演示连续性
      if (b.position.y < -1.5) {
        const a = (i / BALL_COUNT) * Math.PI * 2;
        b.position.set(Math.cos(a) * BALL_ORBIT, this._ballRestY, Math.sin(a) * BALL_ORBIT);
        b.velocity.set(0, 0, 0);
      }
    }
  }

  /** 小球复位（仿真复位时联动） */
  reset() {
    if (!this.enabled || !this._module) return;
    this._resetBodies(this._module);
  }
}
