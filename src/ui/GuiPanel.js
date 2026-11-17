/**
 * lil-gui 参数控制台
 * -------------------------------------------------------------
 * 集中暴露教学演示中需要实时调节的全部参数，分组如下：
 *  仿真控制：运行/暂停/单步/复位、传动模式、主电机转速、阻尼系数
 *  杯位控制：每个咖啡杯独立启停与调速（独立驱动模式下完全解耦）
 *  可视化：矢量箭头、运动轨迹、空间标签、惯性物理开关
 *  渲染：四种渲染模式、Outline、画质档位与自动降级
 *  相机：视角书签、保存书签、自动巡检
 */
import GUI from 'lil-gui';
import { BlendFunction } from 'postprocessing';
import { RenderMode } from '../render/RendererManager.js';
import { bus } from '../core/EventBus.js';
import { logger } from '../core/Logger.js';

export class GuiPanel {
  /**
   * @param {object} deps 全部需要控制的模块
   * @param {SimulationEngine} deps.simulation
   * @param {RendererManager} deps.rendererManager
   * @param {CameraController} deps.cameraController
   * @param {Visualization} deps.visualization
   * @param {LabelManager} deps.labelManager
   * @param {PhysicsBridge} deps.physics
   * @param {PerformanceMonitor} deps.perfMonitor
   * @param {PartRegistry} deps.registry
   * @param {object} deps.config APP_CONFIG
   */
  constructor(deps) {
    this.deps = deps;
    this.gui = new GUI({ title: '仿真控制台' });
    // GUI 绑定的响应式参数对象
    this.params = {
      running: false,
      mode: deps.config.simulation.defaultMode,
      masterRPM: deps.config.simulation.masterRPM,
      damping: deps.config.simulation.damping,
      renderMode: RenderMode.SOLID,
      outline: true,
      quality: '自动',
      showArrows: false,
      showTrails: false,
      showLabels: true,
      physics: false,
      tour: false,
      bookmark: deps.config.cameraBookmarks[0].name
    };
  }

  /** 模型加载、仿真初始化完成后调用 */
  bind() {
    const { simulation: sim, rendererManager, cameraController, visualization, labelManager, physics, perfMonitor, config } = this.deps;

    // ============ 仿真控制 ============
    const fSim = this.gui.addFolder('① 仿真控制');
    fSim.add(this.params, 'running').name('运行 / 暂停').onChange((v) => sim.setRunning(v));
    fSim.add({ step: () => sim.singleStep() }, 'step').name('单步推进');
    fSim.add({ reset: () => sim.reset() }, 'reset').name('复位机构');
    fSim
      .add(this.params, 'mode', { 摩擦耦合联动: 'friction', 独立驱动: 'independent' })
      .name('传动模式')
      .onChange((v) => sim.setMode(v));
    fSim
      .add(this.params, 'masterRPM', 0, 30, 0.5)
      .name('主电机转速 RPM')
      .onChange((v) => sim.setMasterRPM(v));
    fSim
      .add(this.params, 'damping', 0.5, 6, 0.1)
      .name('缓启缓停阻尼')
      .onChange((v) => sim.setDamping(v));
    fSim.open();

    // ============ 单杯控制（每个咖啡杯一个子文件夹） ============
    const fCups = this.gui.addFolder('② 咖啡杯单独控制');
    sim.cups.forEach((cup) => {
      const cupCtrl = {
        enabled: cup.enabled,
        rpm: cup.targetRPM
      };
      const sub = fCups.addFolder(`杯位 #${cup.index}`);
      sub
        .add(cupCtrl, 'enabled')
        .name('使能 / 停止')
        .onChange((v) => sim.setCupEnabled(cup.index, v));
      sub
        .add(cupCtrl, 'rpm', -60, 60, 1)
        .name('目标转速 RPM')
        .onChange((v) => sim.setCupRPM(cup.index, v));
    });

    // ============ 可视化 ============
    const fVis = this.gui.addFolder('③ 教学可视化');
    fVis
      .add(this.params, 'showArrows')
      .name('矢量箭头')
      .onChange((v) => {
        visualization.setVisible(v || this.params.showTrails);
        visualization.setArrowsVisible(v);
      });
    fVis
      .add(this.params, 'showTrails')
      .name('运动轨迹')
      .onChange((v) => {
        visualization.setVisible(v || this.params.showArrows);
        visualization.setTrailsVisible(v);
      });
    fVis
      .add({ clearTrails: () => visualization.clearTrails() }, 'clearTrails')
      .name('清除轨迹');
    fVis
      .add(this.params, 'showLabels')
      .name('3D 空间标签')
      .onChange((v) => labelManager.setVisible(v));
    fVis
      .add(this.params, 'physics')
      .name('惯性物理演示 (Cannon)')
      .onChange(async (v) => {
        if (v) await physics.enable();
        else physics.disable();
      });

    // ============ 渲染模式 ============
    const fRender = this.gui.addFolder('④ 渲染与画质');
    fRender
      .add(this.params, 'renderMode', {
        实体: RenderMode.SOLID,
        'X 光分层透视': RenderMode.XRAY,
        线框: RenderMode.WIREFRAME,
        法线视图: RenderMode.NORMAL
      })
      .name('渲染模式')
      .onChange((v) => rendererManager.setRenderMode(v));
    fRender
      .add(this.params, 'outline')
      .name('Outline 轮廓')
      .onChange((v) => {
        // 关闭时让 OutlineEffect 跳过混合（SKIP），开启恢复 SCREEN 滤色混合
        rendererManager.outlineEffect.blendMode.setBlendFunction(
          v ? BlendFunction.SCREEN : BlendFunction.SKIP
        );
        if (!v) rendererManager.clearSelection();
      });
    const qualityOptions = ['自动', ...config.performance.levels.map((l) => l.name)];
    fRender
      .add(this.params, 'quality', qualityOptions)
      .name('画质档位')
      .onChange((v) => {
        if (v === '自动') {
          perfMonitor.setAuto(true);
        } else {
          perfMonitor.setAuto(false);
          const idx = config.performance.levels.findIndex((l) => l.name === v);
          perfMonitor.setLevel(idx);
        }
      });

    // ============ 相机 ============
    const fCam = this.gui.addFolder('⑤ 相机视角');
    fCam
      .add(this.params, 'bookmark', config.cameraBookmarks.map((b) => b.name))
      .name('视角书签')
      .onChange((name) => cameraController.flyToByName(name));
    fCam
      .add({ saveBookmark: () => this._saveBookmark() }, 'saveBookmark')
      .name('保存当前视角');
    fCam
      .add(this.params, 'tour')
      .name('自动巡检')
      .onChange(() => {
        this.params.tour = cameraController.toggleTour();
        this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
      });

    // 外部事件回写 GUI 状态（工具条按钮等入口）
    bus.on('sim:running', (v) => {
      this.params.running = v;
      this._refresh();
    });
    bus.on('camera:tour', (v) => {
      this.params.tour = v;
      this._refresh();
    });

    logger.info('lil-gui 仿真控制台装配完成');
  }

  /** 保存新书签并刷新下拉框（重建该控制器） */
  _saveBookmark() {
    const bm = this.deps.cameraController.addBookmarkFromCurrent();
    this.params.bookmark = bm.name;
    // lil-gui 无动态 option API，整体重建相机文件夹
    this.gui.folders.find((f) => f._title === '⑤ 相机视角')?.destroy();
    const fCam = this.gui.addFolder('⑤ 相机视角');
    fCam
      .add(this.params, 'bookmark', this.deps.cameraController.bookmarks.map((b) => b.name))
      .name('视角书签')
      .onChange((name) => this.deps.cameraController.flyToByName(name));
    fCam.add({ saveBookmark: () => this._saveBookmark() }, 'saveBookmark').name('保存当前视角');
    fCam
      .add(this.params, 'tour')
      .name('自动巡检')
      .onChange(() => {
        this.params.tour = this.deps.cameraController.toggleTour();
        this._refresh();
      });
  }

  /** 刷新全部控制器显示（外部改参后同步） */
  _refresh() {
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }
}
