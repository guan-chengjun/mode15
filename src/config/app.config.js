/**
 * 应用全局配置
 * -------------------------------------------------------------
 * 所有“可被部署人员修改”的参数集中在此：
 *  - 远程模型 / HDR 地址（模型不内嵌、不打包进 JS）
 *  - 相机书签、自动巡检路径
 *  - 渲染、阴影、性能降级阈值
 *  - 仿真默认参数
 *
 * 运行时还支持 URL 查询参数覆盖：
 *   ?model=https://xxx/coffee.glb&hdr=https://xxx/studio.hdr
 */

/** 解析 URL 查询参数（便于部署时切换模型源） */
const query = new URLSearchParams(window.location.search);

export const APP_CONFIG = {
  /** 应用名称（用于日志、截图文件名等） */
  name: '旋转咖啡杯机械仿真',

  /** 远程 GLTF/GLB 模型地址（默认走 public 静态目录，可替换为 CDN 绝对地址） */
  modelUrl: query.get('model') || './models/coffee_cup.glb',

  /** 部件科普文案配置（独立 JSON，见 docs/模型制作规范.md 的命名约定） */
  partInfoUrl: query.get('partInfo') || './config/parts.info.json',

  /** HDR 环境贴图地址（PMREM 预过滤，提供真实反射与环境光照） */
  hdrUrl: query.get('hdr') || './hdr/studio.hdr',

  /** 模型加载失败时是否使用内置程序化兜底模型（保证教学页面始终可用） */
  fallbackToProcedural: true,

  /** DRACO 解码器公共 CDN 路径（仅压缩模型需要，远程加载不本地内嵌） */
  dracoDecoderPath: 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/',

  renderer: {
    /** 像素比上限（高 DPI 屏幕限幅，减轻 GPU 压力） */
    maxPixelRatio: 2,
    /** 阴影贴图尺寸（会随性能降级动态下调） */
    shadowMapSize: 2048,
    /** 色调映射曝光 */
    exposure: 1.05,
    /** 相机到模型的最小距离（防穿模兜底，单位与模型一致） */
    minDistance: 1.2,
    maxDistance: 40
  },

  /** 性能自动降级策略阈值（详见 docs/扩展文档.md） */
  performance: {
    /** 采样窗口（毫秒） */
    sampleInterval: 3000,
    /** 低于该 FPS 触发一次降级 */
    degradeFps: 30,
    /** 高于该 FPS 且有余量时尝试升档（防抖：连续 3 个窗口达标才升） */
    upgradeFps: 55,
    /** 画质档位，从高到低逐级降低 */
    levels: [
      { name: '高', pixelRatio: 2, shadows: true, shadowMapSize: 2048, hdr: true },
      { name: '中', pixelRatio: 1.5, shadows: true, shadowMapSize: 1024, hdr: true },
      { name: '低', pixelRatio: 1, shadows: false, shadowMapSize: 512, hdr: true },
      { name: '最低', pixelRatio: 0.75, shadows: false, shadowMapSize: 512, hdr: false }
    ]
  },

  /** 相机视角书签（可被 GUI 与工具条调用） */
  cameraBookmarks: [
    { name: '总览视角', position: [7, 5.5, 8], target: [0, 0.8, 0] },
    { name: '传动舱俯视', position: [3.5, 6.2, 3.5], target: [0, 0.4, 0] },
    { name: '摩擦轮特写', position: [1.6, 1.1, 1.6], target: [0.6, 0.55, 0.6] },
    { name: '咖啡杯正视', position: [0, 2.2, 5.2], target: [0, 1.1, 0] },
    { name: '底盘侧视', position: [6.5, 1.2, 0], target: [0, 0.6, 0] }
  ],

  /** 自动巡检：在书签之间巡航的停留与过渡时间（秒） */
  autoTour: {
    dwellTime: 4,
    transitionTime: 2.5,
    loop: true
  },

  /** 仿真默认参数（运行时可由 GUI 覆盖） */
  simulation: {
    /** 固定时间步长（秒），单步仿真即推进一个该步长 */
    fixedDt: 1 / 60,
    /** 主电机目标转速（转/分） */
    masterRPM: 12,
    /** 缓启缓停一阶阻尼系数（越大越快达到目标速度） */
    damping: 2.2,
    /** 传动模式：friction 摩擦耦合联动 / independent 独立驱动 */
    defaultMode: 'friction',
    /** 摩擦轮摆臂角度限位（弧度，相对“压紧位”的偏移范围） */
    armLimit: 0.44,
    /** 联动模式下摩擦轮到杯底盘的传动比（教学演示量，非严格工程值） */
    frictionRatio: 0.38,
    /** 单杯默认自转目标转速（独立驱动模式，转/分） */
    cupDefaultRPM: 24,
    /** 轨迹采样间隔（秒）与最大采样点数 */
    trailInterval: 0.05,
    trailMaxPoints: 600
  }
};
