/**
 * 增强轨道相机控制器
 * -------------------------------------------------------------
 * 在 three 原生 OrbitControls 基础上增加：
 *  1. 视角书签：flyTo 缓动飞行 + 书签管理（可保存当前视角）
 *  2. 自动巡检：按配置在书签之间循环巡航（过渡 → 停留 → 下一点）
 *  3. 相机防穿模：每帧从观察目标向相机发射射线，命中实体表面时把相机拉回碰撞点外
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { bus } from '../core/EventBus.js';
import { logger } from '../core/Logger.js';

/** 位置插值缓动函数（smoothstep，起步与收束都平缓） */
function easeInOut(t) {
  return t * t * (3 - 2 * t);
}

export class CameraController {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} domElement 事件绑定元素（canvas）
   * @param {object} config APP_CONFIG
   */
  constructor(camera, domElement, config) {
    this.camera = camera;
    this.config = config;
    this.controls = new OrbitControls(camera, domElement);

    // 轨道相机基础参数
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = config.renderer.minDistance;
    this.controls.maxDistance = config.renderer.maxDistance;
    this.controls.maxPolarAngle = Math.PI * 0.495; // 禁止钻到地面以下
    this.controls.target.set(0, 0.8, 0);

    /** 防穿模碰撞体网格列表（由 PartRegistry 注册） */
    this.collisionMeshes = [];
    this._raycaster = new THREE.Raycaster();
    this._collisionMargin = 0.35; // 相机与表面保持的安全余量

    /** 书签列表（可运行时扩展） */
    this.bookmarks = config.cameraBookmarks.map((b) => ({ ...b }));

    /** 飞行补间状态 */
    this._tween = null;
    /** 自动巡检状态 */
    this._tour = { active: false, index: 0, timer: 0, phase: 'dwell' };

    // 用户手动操作相机时，自动中断飞行补间与巡检
    this.controls.addEventListener('start', () => {
      if (this._tween) this._tween = null;
      if (this._tour.active) this.stopTour();
    });
  }

  /**
   * 设置防穿模碰撞网格
   * @param {THREE.Mesh[]} meshes
   */
  setCollisionMeshes(meshes) {
    this.collisionMeshes = meshes;
  }

  /**
   * 缓动飞行到指定书签
   * @param {{position:number[], target:number[]}} bookmark
   */
  flyTo(bookmark) {
    this.stopTour();
    this._tween = {
      elapsed: 0,
      duration: this.config.autoTour.transitionTime,
      fromPos: this.camera.position.clone(),
      toPos: new THREE.Vector3(...bookmark.position),
      fromTarget: this.controls.target.clone(),
      toTarget: new THREE.Vector3(...bookmark.target)
    };
    this.controls.enabled = false;
    bus.emit('camera:bookmark', bookmark);
    logger.info(`相机切换到视角书签：${bookmark.name || '未命名书签'}`);
  }

  /** 按书签名称飞行（GUI / 书签面板调用） */
  flyToByName(name) {
    const bm = this.bookmarks.find((b) => b.name === name);
    if (bm) this.flyTo(bm);
  }

  /**
   * 保存当前视角为新书签
   * @returns {object} 新建的书签对象
   */
  addBookmarkFromCurrent() {
    const bm = {
      name: `自定义视角 ${this.bookmarks.length + 1}`,
      position: this.camera.position.toArray().map((v) => Number(v.toFixed(2))),
      target: this.controls.target.toArray().map((v) => Number(v.toFixed(2)))
    };
    this.bookmarks.push(bm);
    logger.info(`已保存新书签：${bm.name}`);
    return bm;
  }

  /** 启动自动巡检 */
  startTour() {
    // 先启动飞行补间（flyTo 内部会清理旧补间），再置巡检状态，避免被 stopTour 清掉事件
    this._tween = this._buildTween(this.bookmarks[0]);
    this.controls.enabled = false;
    this._tour = { active: true, index: 0, timer: 0, phase: 'dwell' };
    bus.emit('camera:tour', true);
    bus.emit('camera:bookmark', this.bookmarks[0]);
    logger.info('自动巡检已启动');
  }

  /** 构造一个指向书签的飞行补间 */
  _buildTween(bookmark) {
    return {
      elapsed: 0,
      duration: this.config.autoTour.transitionTime,
      fromPos: this.camera.position.clone(),
      toPos: new THREE.Vector3(...bookmark.position),
      fromTarget: this.controls.target.clone(),
      toTarget: new THREE.Vector3(...bookmark.target)
    };
  }

  /** 停止自动巡检 */
  stopTour() {
    if (!this._tour.active) return;
    this._tour.active = false;
    bus.emit('camera:tour', false);
    logger.info('自动巡检已停止');
  }

  /** 巡检开关切换 */
  toggleTour() {
    this._tour.active ? this.stopTour() : this.startTour();
    return this._tour.active;
  }

  /** 每帧更新（由 Engine 主循环调用） */
  update(dt) {
    // 1. 飞行补间推进
    if (this._tween) {
      this._tween.elapsed += dt;
      const t = Math.min(this._tween.elapsed / this._tween.duration, 1);
      const k = easeInOut(t);
      this.camera.position.lerpVectors(this._tween.fromPos, this._tween.toPos, k);
      this.controls.target.lerpVectors(this._tween.fromTarget, this._tween.toTarget, k);
      if (t >= 1) {
        this._tween = null;
        this.controls.enabled = true;
      }
    } else {
      this.controls.update();
    }

    // 2. 防穿模检测（飞行过程中同样生效）
    this._enforceCollision();

    // 3. 自动巡检状态机
    if (this._tour.active && !this._tween) {
      this._tour.timer += dt;
      if (this._tour.phase === 'dwell' && this._tour.timer >= this.config.autoTour.dwellTime) {
        // 停留结束，飞向下一个书签
        this._tour.timer = 0;
        this._tour.phase = 'transition';
        const next = this._tour.index + 1;
        if (next >= this.bookmarks.length) {
          if (!this.config.autoTour.loop) {
            this.stopTour();
            return;
          }
          this._tour.index = 0;
        } else {
          this._tour.index = next;
        }
        // 直接启动补间但不重置整个巡检状态
        const bm = this.bookmarks[this._tour.index];
        this._tween = this._buildTween(bm);
        this.controls.enabled = false;
        bus.emit('camera:bookmark', bm);
      } else if (this._tour.phase === 'transition') {
        // 飞行期间 phase 标记为 transition，补间结束后进入停留
        this._tour.phase = 'dwell';
        this._tour.timer = 0;
      }
    }
  }

  /**
   * 防穿模核心：
   * 从观察目标朝相机方向射线检测，若实体表面比相机更近，则把相机推到碰撞点外
   */
  _enforceCollision() {
    if (this.collisionMeshes.length === 0) return;

    const target = this.controls.target;
    const dir = new THREE.Vector3().subVectors(this.camera.position, target);
    const dist = dir.length();
    if (dist < 1e-4) return;
    dir.normalize();

    this._raycaster.set(target, dir);
    this._raycaster.far = dist; // 只检测目标与相机之间的物体
    const hits = this._raycaster.intersectObjects(this.collisionMeshes, false);

    if (hits.length > 0) {
      const safeDist = Math.max(hits[0].distance - this._collisionMargin, this.config.renderer.minDistance);
      this.camera.position.copy(target).addScaledVector(dir, safeDist);
    }
  }

  /** 复位到默认书签 */
  reset() {
    this.stopTour();
    this.flyTo(this.bookmarks[0]);
  }
}
