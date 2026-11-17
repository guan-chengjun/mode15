/**
 * 引擎装配与主循环
 * -------------------------------------------------------------
 * Engine 是整个应用的“总装车间”，只负责装配与生命周期调度，
 * 各功能模块保持独立、互不直接依赖（通过 EventBus 通信）：
 *
 *  渲染层：RendererManager / LightingRig / CameraController / PerformanceMonitor
 *  模型层：ModelLoader / PartRegistry
 *  仿真层：SimulationEngine / Visualization / PhysicsBridge
 *  交互层：Picker / LabelManager
 *  UI 层：UIManager（DOM 面板与 lil-gui）
 */
import * as THREE from 'three';
import { APP_CONFIG } from '../config/app.config.js';
import { bus } from './EventBus.js';
import { logger } from './Logger.js';
import { RendererManager } from '../render/RendererManager.js';
import { LightingRig } from '../render/LightingRig.js';
import { CameraController } from '../render/CameraController.js';
import { PerformanceMonitor } from '../render/PerformanceMonitor.js';
import { ModelLoader } from '../model/ModelLoader.js';
import { PartRegistry } from '../model/PartRegistry.js';
import { SimulationEngine } from '../simulation/SimulationEngine.js';
import { Visualization } from '../simulation/Visualization.js';
import { PhysicsBridge } from '../simulation/PhysicsBridge.js';
import { Picker } from '../interaction/Picker.js';
import { LabelManager } from '../interaction/LabelManager.js';

export class Engine {
  constructor() {
    this.config = APP_CONFIG;
    this.clock = new THREE.Clock();
    this._rafId = 0;
    this._disposed = false;
  }

  /**
   * 启动应用（异步：含模型与 HDR 远程加载）
   * @param {(percent:number, text:string)=>void} onLoading 加载进度回调
   */
  async start(onLoading) {
    // —— 1. 场景与相机 ——
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      200
    );
    this.camera.position.fromArray(this.config.cameraBookmarks[0].position);

    // —— 2. 渲染器、灯光、相机控制、性能监控 ——
    this.rendererManager = new RendererManager(
      document.getElementById('three-canvas'),
      this.scene,
      this.camera,
      this.config
    );
    this.rendererManager.init();
    await this.rendererManager.loadEnvironment();

    this.lighting = new LightingRig(this.scene, this.config.renderer);
    this.lighting.setup();

    this.cameraController = new CameraController(this.camera, this.rendererManager.renderer.domElement, this.config);

    this.perfMonitor = new PerformanceMonitor(this.rendererManager.renderer, this.config.performance);
    this.perfMonitor.onLevelChange = (level, index) =>
      this.rendererManager.applyQuality(level, index);

    // 地面接收阴影（教学场景地台）
    this._addGround();

    // —— 3. 远程加载模型并注册部件 ——
    const loader = new ModelLoader(this.config);
    const { root, isFallback } = await loader.load(onLoading);
    this.scene.add(root);

    this.registry = new PartRegistry();
    this.registry.scan(root);
    await this._loadPartInfo();

    // —— 4. 仿真、可视化、物理桥接 ——
    this.simulation = new SimulationEngine(this.registry, this.config.simulation);
    this.simulation.init();

    this.visualization = new Visualization(this.scene, this.simulation, this.config.simulation);
    this.visualization.init();

    this.physics = new PhysicsBridge(this.scene, this.simulation);
    bus.on('sim:reset', () => {
      this.physics.reset();
      this.visualization.clearTrails();
    });

    // —— 5. 交互：拾取与空间标签 ——
    this.picker = new Picker(this.camera, this.rendererManager.renderer.domElement, this.registry, this.rendererManager);
    this.picker.bind();

    this.labels = new LabelManager(document.getElementById('label-layer'), this.registry);
    this.labels.attach(this.scene, this.camera);
    this.labels.init();

    // 相机防穿模碰撞体（机架部分）
    this.cameraController.setCollisionMeshes(this.registry.getCollisionMeshes());

    // —— 6. 通知 UI 层装配面板 ——
    bus.emit('model:loaded', { root, registry: this.registry, isFallback });

    // —— 7. 窗口与主循环 ——
    window.addEventListener('resize', this._onResize = () => this.resize());
    this._loop = this._loop.bind(this);
    this.clock.start();
    this._rafId = requestAnimationFrame(this._loop);

    logger.info('引擎装配完成，进入仿真主循环');
  }

  /** 加载独立 JSON 科普文案（失败不阻断，使用注册表默认名称） */
  async _loadPartInfo() {
    try {
      const resp = await fetch(this.config.partInfoUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const info = await resp.json();
      this.registry.setInfoData(info);
      logger.info(`部件科普文案加载成功：${this.config.partInfoUrl}`);
    } catch (err) {
      logger.warn(`科普文案加载失败，使用内置默认名称：${err.message || err}`);
    }
  }

  /** 地台：深色哑光平面，承接软阴影 */
  _addGround() {
    const geo = new THREE.CircleGeometry(14, 64);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x141a24,
      roughness: 0.92,
      metalness: 0.05
    });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.005;
    ground.receiveShadow = true;
    ground.name = 'ground_platform';
    this.scene.add(ground);
  }

  /** 主循环：固定职责顺序，保证仿真先于渲染 */
  _loop() {
    if (this._disposed) return;
    this._rafId = requestAnimationFrame(this._loop);
    const dt = Math.min(this.clock.getDelta(), 0.05); // 钳制大帧间隔，防止标签页切回后跳变

    // 1. 仿真积分（暂停时内部做缓停）
    this.simulation.update();
    // 2. 可视化箭头/轨迹
    this.visualization.update(dt);
    // 3. 可选物理
    this.physics.update(dt);
    // 4. 相机（含巡检补间与防穿模）
    this.cameraController.update(dt);
    // 5. 性能统计
    this.perfMonitor.update(dt);
    // 6. WebGL 后处理渲染 + CSS2D 标签渲染
    this.rendererManager.render();
    this.labels.render();
  }

  /** 窗口尺寸变化统一入口 */
  resize() {
    this.rendererManager.resize();
    this.labels.resize();
  }

  /** 销毁（热更新/页面卸载） */
  dispose() {
    this._disposed = true;
    cancelAnimationFrame(this._rafId);
    window.removeEventListener('resize', this._onResize);
    this.picker?.dispose();
    this.visualization?.dispose();
    this.rendererManager?.dispose();
  }
}
