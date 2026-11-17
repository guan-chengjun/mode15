/**
 * UI 总装管理器
 * -------------------------------------------------------------
 * 等待 model:loaded 事件后，把全部 UI 面板与已装配的引擎模块接线。
 * UI 模块之间不互相引用，统一通过 EventBus 与引擎模块交互。
 */
import { Toolbar } from './Toolbar.js';
import { TreePanel } from './TreePanel.js';
import { DataPanel } from './DataPanel.js';
import { LogPanel } from './LogPanel.js';
import { InfoModal } from './InfoModal.js';
import { GuiPanel } from './GuiPanel.js';
import { StatusBar } from './StatusBar.js';
import { bus } from '../core/EventBus.js';
import { logger } from '../core/Logger.js';

export class UIManager {
  /**
   * @param {Engine} engine 已创建但模型可能尚未加载完成的引擎
   */
  constructor(engine) {
    this.engine = engine;
    this._built = false;
  }

  /** 启动监听：模型加载完成后一次性装配 UI */
  init() {
    bus.on('model:loaded', ({ registry, isFallback }) => {
      if (this._built) return;
      this._built = true;
      const e = this.engine;

      // 1. 工具条
      this.toolbar = new Toolbar(e.simulation, e.rendererManager);
      this.toolbar.bind();

      // 2. 左侧部件树
      this.treePanel = new TreePanel(registry);
      this.treePanel.render();

      // 3. 右侧数据与日志
      this.dataPanel = new DataPanel(e.simulation);
      this.dataPanel.bind();
      this.logPanel = new LogPanel();
      this.logPanel.bind();

      // 4. 科普弹窗
      this.infoModal = new InfoModal(registry);
      this.infoModal.bind();

      // 5. lil-gui 控制台
      this.guiPanel = new GuiPanel({
        simulation: e.simulation,
        rendererManager: e.rendererManager,
        cameraController: e.cameraController,
        visualization: e.visualization,
        labelManager: e.labels,
        physics: e.physics,
        perfMonitor: e.perfMonitor,
        registry,
        config: e.config
      });
      this.guiPanel.bind();

      // 6. 状态栏
      this.statusBar = new StatusBar(e.perfMonitor, e.rendererManager);
      this.statusBar.bind();

      // 7. 显示主界面
      document.getElementById('toolbar').classList.remove('hidden');
      document.getElementById('tree-panel').classList.remove('hidden');
      document.getElementById('data-panel').classList.remove('hidden');
      document.getElementById('status-bar').classList.remove('hidden');

      if (isFallback) {
        logger.warn('提示：当前为程序化兜底模型，替换远程 GLTF 后刷新即可显示真实模型');
      }
      logger.info('全部 UI 面板装配完成');
    });
  }
}
