/**
 * 射线拾取器
 * -------------------------------------------------------------
 * - 鼠标悬浮：射线检测部件，悬浮即 Outline 轮廓高亮，并改变鼠标指针
 * - 鼠标点击：选中部件，发布 part:select 事件（信息弹窗、部件树联动）
 * - 自动过滤隐藏部件与辅助对象（矢量箭头、轨迹线不参与拾取）
 */
import * as THREE from 'three';
import { bus } from '../core/EventBus.js';

export class Picker {
  /**
   * @param {THREE.Camera} camera
   * @param {HTMLElement} domElement 监听 DOM（canvas）
   * @param {PartRegistry} registry
   * @param {RendererManager} rendererManager 用于设置 Outline 高亮
   */
  constructor(camera, domElement, registry, rendererManager) {
    this.camera = camera;
    this.dom = domElement;
    this.registry = registry;
    this.rendererManager = rendererManager;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    /** 当前悬浮部件 ID */
    this.hoverPartId = null;
    /** 当前选中部件 ID */
    this.selectedPartId = null;
    /** 悬浮防抖计时（避免像素级抖动导致高亮闪烁） */
    this._hoverRaf = 0;

    this._onPointerMove = this._onPointerMove.bind(this);
    this._onClick = this._onClick.bind(this);
  }

  /** 绑定事件 */
  bind() {
    this.dom.addEventListener('pointermove', this._onPointerMove);
    this.dom.addEventListener('click', this._onClick);

    // 外部（部件树、弹窗关闭）改变选中时，同步高亮
    bus.on('part:select', (partId) => {
      this.selectedPartId = partId;
      this._refreshOutline();
    });
    // 部件被隐藏后，若悬浮/选中的是它则清除状态
    bus.on('part:visibility', ({ partId, hidden }) => {
      if (hidden && (this.hoverPartId === partId || this.selectedPartId === partId)) {
        this.hoverPartId = null;
        if (this.selectedPartId === partId) this.selectedPartId = null;
        this._refreshOutline();
      }
    });
  }

  /** 屏幕坐标 → 归一化设备坐标 */
  _updatePointer(event) {
    const rect = this.dom.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /** 执行射线检测，返回命中的部件（忽略不可见对象） */
  _pick(event) {
    this._updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = this.registry.getAllMeshes().filter((m) => {
      // 自身或任一祖先不可见则不参与拾取
      let obj = m;
      while (obj) {
        if (!obj.visible) return false;
        obj = obj.parent;
      }
      return true;
    });
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;
    return this.registry.getPartByMesh(hits[0].object);
  }

  _onPointerMove(event) {
    // 合并到下一帧，降低高频移动下的检测开销
    cancelAnimationFrame(this._hoverRaf);
    this._hoverRaf = requestAnimationFrame(() => {
      const part = this._pick(event);
      const id = part?.id || null;
      if (id === this.hoverPartId) return;
      this.hoverPartId = id;
      this.dom.style.cursor = id ? 'pointer' : 'default';
      bus.emit('part:hover', id);
      this._refreshOutline();
    });
  }

  _onClick(event) {
    const part = this._pick(event);
    const id = part?.id || null;
    this.selectedPartId = id;
    bus.emit('part:select', id);
    this._refreshOutline();
  }

  /**
   * 刷新 Outline 高亮目标：
   * 选中优先；无选中时高亮悬浮部件
   */
  _refreshOutline() {
    const targetId = this.selectedPartId || this.hoverPartId;
    if (!targetId) {
      this.rendererManager.clearSelection();
      return;
    }
    const part = this.registry.getPart(targetId);
    if (part) this.rendererManager.setSelection(part.meshes);
  }

  /** 解绑事件（热更新/销毁用） */
  dispose() {
    this.dom.removeEventListener('pointermove', this._onPointerMove);
    this.dom.removeEventListener('click', this._onClick);
    cancelAnimationFrame(this._hoverRaf);
  }
}
