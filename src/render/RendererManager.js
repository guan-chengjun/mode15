/**
 * 渲染器管理器
 * -------------------------------------------------------------
 * 职责：
 *  1. WebGLRenderer / EffectComposer 生命周期管理
 *  2. 四种渲染模式切换：实体 solid / X 光分层透视 xray / 线框 wireframe / 法线 normal
 *  3. Outline 轮廓高亮（postprocessing OutlineEffect，支持遮挡边显示）
 *  4. HDR 环境贴图远程加载（RGBELoader + PMREM 预过滤）
 *  5. 软阴影、画质档位热切换（配合性能自动降级）
 *  6. 截图导出
 */
import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  NormalPass,
  OutlineEffect,
  SMAAEffect,
  SMAAPreset,
  VignetteEffect,
  BlendFunction
} from 'postprocessing';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { bus } from '../core/EventBus.js';
import { logger } from '../core/Logger.js';

/** 渲染模式枚举 */
export const RenderMode = {
  SOLID: 'solid',
  XRAY: 'xray',
  WIREFRAME: 'wireframe',
  NORMAL: 'normal'
};

/**
 * X 光模式下按部件类别的“分层”透明度：
 * 外层座舱最透、传动舱中等、机架最实，形成由外到内的透视层次
 */
const XRAY_OPACITY_BY_CATEGORY = {
  执行部件: 0.16,
  电气部件: 0.22,
  动力部件: 0.34,
  传动部件: 0.42,
  机架部件: 0.58
};
const XRAY_OPACITY_DEFAULT = 0.3;

export class RendererManager {
  /**
   * @param {HTMLCanvasElement} canvas 画布元素
   * @param {THREE.Scene} scene 场景
   * @param {THREE.Camera} camera 相机
   * @param {object} config APP_CONFIG
   */
  constructor(canvas, scene, camera, config) {
    this.canvas = canvas;
    this.scene = scene;
    this.camera = camera;
    this.config = config;

    /** @type {THREE.WebGLRenderer|null} */
    this.renderer = null;
    /** @type {EffectComposer|null} */
    this.composer = null;
    /** @type {OutlineEffect|null} */
    this.outlineEffect = null;

    /** 当前渲染模式 */
    this.renderMode = RenderMode.SOLID;
    /** 模型全部网格缓存（模式切换时遍历用） */
    this.modelMeshes = [];
    /** 材质原始状态缓存，保证模式切换可还原 */
    this._materialSnapshots = new Map();
    /** 法线覆盖材质（normal 模式用，挂到 RenderPass.overrideMaterial） */
    this._normalOverride = null;
    /** RenderPass 引用（法线模式需要切换其覆盖材质） */
    this._renderPass = null;
    /** 当前画质档位下标 */
    this.qualityLevel = 0;
    /** 环境贴图纹理（降级到“最低”档时可关闭） */
    this._envTexture = null;
    this._hdrEnabled = true;
  }

  /** 初始化渲染器与后处理管线 */
  init() {
    const { maxPixelRatio, shadowMapSize, exposure } = this.config.renderer;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false, // 抗锯齿交给后处理 SMAA，避免双重 MSAA 浪费
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // 软阴影：PCFSoft 阴影边缘柔和，适合教学展示
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = exposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this._setupComposer(shadowMapSize);

    // 模型加载完成后缓存网格，并对当前模式做一次补应用
    bus.on('model:loaded', ({ registry }) => {
      this.modelMeshes = registry.getAllMeshes();
      this._applyRenderMode(this.renderMode);
    });

    logger.info('渲染器与后处理管线初始化完成（SMAA + Outline + 暗角）');
  }

  /** 搭建后处理管线：RenderPass → NormalPass → EffectPass(Outline/SMAA/Vignette) */
  _setupComposer(shadowMapSize) {
    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType // 半浮点缓冲，HDR 色调过渡更平滑
    });
    // RenderPass 保留引用：法线视图通过其 overrideMaterial 实现
    this._renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this._renderPass);

    // OutlineEffect 依赖法线缓冲做边缘检测
    const normalPass = new NormalPass(this.scene, this.camera);

    // 轮廓高亮：可见边蓝色，被遮挡边暗红，便于在 X 光模式下看清内部件轮廓
    this.outlineEffect = new OutlineEffect(this.scene, this.camera, {
      blendFunction: BlendFunction.SCREEN,
      multisampling: 4,
      edgeStrength: 2.6,
      pulseSpeed: 0, // 不做呼吸闪烁，教学画面保持稳定
      visibleEdgeColor: new THREE.Color(0x4aa8ff),
      hiddenEdgeColor: new THREE.Color(0x8a2f3d),
      resolutionScale: 1,
      blur: false,
      xRay: true
    });

    const smaaEffect = new SMAAEffect({ preset: SMAAPreset.MEDIUM });
    const vignetteEffect = new VignetteEffect({ darkness: 0.28, offset: 0.32 });

    const effectPass = new EffectPass(this.camera, this.outlineEffect, smaaEffect, vignetteEffect);
    this.composer.addPass(normalPass);
    this.composer.addPass(effectPass);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  /**
   * 远程加载 HDR 环境贴图
   * 失败不致命：回退到灯光直射，保证课堂网络受限时仍可使用
   */
  async loadEnvironment() {
    const url = this.config.hdrUrl;
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const texture = await new RGBELoader().loadAsync(url);
      this._envTexture = pmrem.fromEquirectangular(texture).texture;
      texture.dispose();
      pmrem.dispose();
      this.scene.environment = this._envTexture;
      // 背景仍保持深色，环境贴图只负责反射/照明，避免抢主体视线
      this.scene.background = new THREE.Color(0x0d1117);
      logger.info(`HDR 环境贴图加载成功：${url}`);
    } catch (err) {
      this.scene.background = new THREE.Color(0x0d1117);
      logger.warn(`HDR 加载失败，改用纯灯光照明：${err.message || err}`);
    }
  }

  /**
   * 切换渲染模式
   * @param {string} mode RenderMode 之一
   */
  setRenderMode(mode) {
    if (mode === this.renderMode) return;
    this._restoreMaterials();
    this.renderMode = mode;
    this._applyRenderMode(mode);
    bus.emit('render:mode-changed', mode);
    logger.info(`渲染模式切换为：${this.getModeLabel(mode)}`);
  }

  /** 模式中文名（状态栏与 GUI 复用） */
  getModeLabel(mode = this.renderMode) {
    return { solid: '实体', xray: 'X 光透视', wireframe: '线框', normal: '法线视图' }[mode] || mode;
  }

  /** 应用指定模式到全部模型网格 */
  _applyRenderMode(mode) {
    if (this.modelMeshes.length === 0) return;

    // 法线模式：把 MeshNormalMaterial 挂到 RenderPass 的 overrideMaterial，
    // 由 postprocessing 的 OverrideMaterialManager 在渲染期临时替换、渲染后自动还原，
    // 与后处理管线（Outline/SMAA）完全兼容
    if (mode === RenderMode.NORMAL) {
      if (!this._normalOverride) this._normalOverride = new THREE.MeshNormalMaterial();
      this._renderPass.overrideMaterial = this._normalOverride;
      return;
    }
    // 离开法线模式：清空 RenderPass 覆盖材质
    this._renderPass.overrideMaterial = null;

    for (const mesh of this.modelMeshes) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((mat) => {
        if (!mat || mat.isMeshNormalMaterial) return;
        this._snapshot(mat);
        if (mode === RenderMode.WIREFRAME) {
          mat.wireframe = true;
        } else if (mode === RenderMode.XRAY) {
          const category = mesh.userData?.partCategory || mesh.parent?.userData?.partCategory;
          mat.transparent = true;
          mat.opacity = XRAY_OPACITY_BY_CATEGORY[category] ?? XRAY_OPACITY_DEFAULT;
          mat.depthWrite = false; // 关闭深度写入，才能看到内部被遮挡的结构
          mat.needsUpdate = true;
        }
      });
    }
  }

  /** 缓存材质原始属性（同一材质只缓存一次） */
  _snapshot(mat) {
    if (this._materialSnapshots.has(mat.uuid)) return;
    this._materialSnapshots.set(mat.uuid, {
      mat,
      wireframe: mat.wireframe,
      transparent: mat.transparent,
      opacity: mat.opacity,
      depthWrite: mat.depthWrite
    });
  }

  /** 还原全部材质到实体模式 */
  _restoreMaterials() {
    for (const { mat, wireframe, transparent, opacity, depthWrite } of this._materialSnapshots.values()) {
      mat.wireframe = wireframe;
      mat.transparent = transparent;
      mat.opacity = opacity;
      mat.depthWrite = depthWrite;
      mat.needsUpdate = true;
    }
    this._materialSnapshots.clear();
    // 确保法线覆盖材质被移除
    if (this._renderPass) this._renderPass.overrideMaterial = null;
    this.scene.overrideMaterial = null;
  }

  /**
   * 设置 Outline 高亮目标
   * @param {THREE.Object3D[]} objects 网格或部件根节点列表
   */
  setSelection(objects) {
    if (!this.outlineEffect) return;
    this.outlineEffect.selection.set(objects);
  }

  /** 清除高亮 */
  clearSelection() {
    this.outlineEffect?.selection.clear();
  }

  /**
   * 应用画质档位（性能降级/升档时调用）
   * @param {object} level APP_CONFIG.performance.levels 中的档位对象
   * @param {number} index 档位下标
   */
  applyQuality(level, index) {
    this.qualityLevel = index;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, level.pixelRatio));

    // 阴影开关与阴影贴图尺寸
    this.renderer.shadowMap.enabled = level.shadows;
    this.scene.traverse((obj) => {
      if (obj.isLight && obj.isDirectionalLight && obj.castShadow) {
        obj.castShadow = level.shadows;
        if (level.shadows) {
          obj.shadow.mapSize.set(level.shadowMapSize, level.shadowMapSize);
          // 强制阴影贴图按新尺寸重新分配
          if (obj.shadow.map) {
            obj.shadow.map.dispose();
            obj.shadow.map = null;
          }
        }
      }
    });

    // 最低档关闭 HDR 环境反射，显著减少着色器开销
    if (!level.hdr && this._hdrEnabled) {
      this.scene.environment = null;
      this._hdrEnabled = false;
    } else if (level.hdr && !this._hdrEnabled && this._envTexture) {
      this.scene.environment = this._envTexture;
      this._hdrEnabled = true;
    }
    this.resize();
  }

  /** 画布尺寸同步（窗口变化与档位切换都走这里） */
  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
  }

  /** 每帧渲染（走后处理管线） */
  render() {
    this.composer.render();
  }

  /** 截图：立即补渲一帧再抓取，避免 preserveDrawingBuffer 的常驻开销 */
  screenshot() {
    this.composer.render();
    const dataURL = this.renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataURL;
    a.download = `咖啡杯仿真截图_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    a.click();
    logger.info('已保存当前画面截图（PNG）');
  }

  /** 释放资源 */
  dispose() {
    this.composer?.dispose();
    this.renderer?.dispose();
    this._envTexture?.dispose();
  }
}
