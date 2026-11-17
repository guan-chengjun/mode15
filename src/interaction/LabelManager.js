/**
 * 3D 空间标签管理器
 * -------------------------------------------------------------
 * 基于 CSS2DRenderer：标签是真实 DOM，可随部件在 3D 空间中定位、缩放透视，
 * 同时支持中文排版、点击事件与样式控制。
 *  - 每个已注册部件生成一个标签，定位到其包围盒中心上方
 *  - 部件隐藏/隔离时标签同步淡出
 *  - 点击标签等价于点击部件（复用 part:select 事件链）
 */
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { bus } from '../core/EventBus.js';

export class LabelManager {
  /**
   * @param {HTMLElement} container 标签层 div
   * @param {PartRegistry} registry
   */
  constructor(container, registry) {
    this.container = container;
    this.registry = registry;
    /** partId -> CSS2DObject */
    this.labels = new Map();

    this.labelRenderer = new CSS2DRenderer({ element: container });
    this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    // 标签层不拦截画布事件，只有标签本体可点（CSS 中 pointer-events 已配置）
    container.style.pointerEvents = 'none';
  }

  /** 模型注册完成后批量创建标签 */
  init() {
    for (const part of this.registry.parts.values()) {
      const div = document.createElement('div');
      div.className = 'spatial-label';
      div.textContent = part.name;
      div.style.pointerEvents = 'auto';
      div.dataset.partId = part.id;
      div.title = `点击查看「${part.name}」科普信息`;
      div.addEventListener('click', (e) => {
        e.stopPropagation();
        bus.emit('part:select', part.id);
      });

      const label = new CSS2DObject(div);
      // 定位到部件包围盒顶部上方
      const box = new THREE.Box3().setFromObject(part.root);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      label.position.copy(center);
      label.position.y += size.y * 0.5 + 0.25;

      part.root.add(label); // 挂到部件节点下，随部件一起运动
      this.labels.set(part.id, { object: label, element: div, part });
    }

    // 显隐/隔离联动
    bus.on('part:visibility', ({ partId, hidden }) => this._syncDim(partId));
    bus.on('part:isolate', () => {
      for (const id of this.labels.keys()) this._syncDim(id);
    });
    bus.on('part:select', (partId) => {
      for (const [id, entry] of this.labels) {
        entry.element.style.borderColor = id === partId ? '#ffb454' : '';
      }
    });
  }

  /** 根据部件可见性刷新标签透明度 */
  _syncDim(partId) {
    const entry = this.labels.get(partId);
    if (!entry) return;
    const visible = entry.part.root.visible;
    entry.element.classList.toggle('dim', !visible);
    entry.element.style.display = visible ? '' : 'none';
  }

  /** 标签总开关 */
  setVisible(visible) {
    this.container.style.display = visible ? '' : 'none';
  }

  /** 窗口尺寸同步 */
  resize() {
    this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
  }

  /** 每帧渲染标签（在 WebGL 渲染之后调用） */
  render() {
    if (this._scene && this._camera) {
      this.labelRenderer.render(this._scene, this._camera);
    }
  }

  /**
   * 注入场景与相机引用（CSS2DRenderer 渲染需要）
   * 由 Engine 在装配阶段调用
   */
  attach(scene, camera) {
    this._scene = scene;
    this._camera = camera;
  }
}
