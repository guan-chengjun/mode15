/**
 * 部件注册表
 * -------------------------------------------------------------
 * 扫描加载后的 GLTF 场景节点，按“部件 ID 前缀命名约定”识别机械部件：
 *   base_frame_*       主机底座
 *   main_motor_*       主驱动电机
 *   slewing_bearing_*  回转支承
 *   main_turntable_*   旋转大转盘
 *   friction_wheel_*   摩擦轮组件
 *   cup_drive_*        杯体独立驱动单元
 *   coffee_cup_*       咖啡杯座舱（模板，自动编号 0..N-1）
 *   slip_ring_*        中心导电滑环
 *
 * 命名约定同时兼容：
 *   1. 节点名以 partId 开头（推荐，见《模型制作规范.md》）
 *   2. Blender 导出时在节点自定义属性中写 userData.partId
 *
 * 注册表对外提供：
 *  - 部件树数据（供侧边树 UI）
 *  - 仿真语义查询（转盘、杯位、摩擦轮、电机节点）
 *  - 射线拾取结果反查 partId
 *  - 显隐 / 隔离控制
 */
import * as THREE from 'three';
import { logger } from '../core/Logger.js';

/** 部件 ID -> 默认中文名与分类（parts.info.json 会覆盖名称与文案） */
export const PART_DEFS = {
  base_frame: { name: '主机底座', category: '机架部件' },
  main_motor: { name: '主驱动电机', category: '动力部件' },
  slewing_bearing: { name: '回转支承', category: '传动部件' },
  main_turntable: { name: '旋转大转盘', category: '执行部件' },
  friction_wheel: { name: '摩擦轮组件', category: '传动部件' },
  cup_drive: { name: '杯体独立驱动单元', category: '动力部件' },
  coffee_cup: { name: '咖啡杯座舱', category: '执行部件' },
  slip_ring: { name: '中心导电滑环', category: '电气部件' }
};

/** 仿真需要按“模板 + 编号”管理的部件 */
const TEMPLATED_PARTS = new Set(['coffee_cup', 'friction_wheel', 'cup_drive']);

export class PartRegistry {
  constructor() {
    /**
     * 部件表：partId ->
     * { id, defId, name, category, root:Object3D, meshes:Mesh[], children:partId[] }
     */
    this.parts = new Map();
    /** 网格 uuid -> partId 反查表（射线拾取用） */
    this.meshToPart = new Map();
    /** 仿真语义节点 */
    this.turntable = null;
    this.motor = null;
    /** 杯位列表：{ index, cup, drive, frictionWheel, pivot(世界坐标), spinNode } */
    this.cupStations = [];
    /** 科普文案（由外部 fetch parts.info.json 后注入） */
    this.infoData = null;
  }

  /**
   * 扫描场景并注册全部部件
   * @param {THREE.Object3D} root 模型根节点
   */
  scan(root) {
    this.root = root;
    // 先按节点建立“部件根节点”归属
    root.traverse((obj) => {
      const defId = this._matchDefId(obj);
      if (!defId) return;
      const partId = this._resolvePartId(obj, defId);
      if (!this.parts.has(partId)) {
        this._registerPart(partId, defId, obj);
      }
    });

    // 再把每个 Mesh 归属到其最近的已注册部件祖先
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      const partId = this._findOwningPart(obj);
      if (!partId) return;
      const part = this.parts.get(partId);
      part.meshes.push(obj);
      this.meshToPart.set(obj.uuid, partId);
      obj.userData.partId = partId;
      obj.userData.partCategory = part.category;
    });

    this._buildSemantics();
    logger.info(
      `部件注册完成：共 ${this.parts.size} 个部件、${this.cupStations.length} 个杯位、${this.meshToPart.size} 个网格`
    );
  }

  /** 注入科普文案 JSON */
  setInfoData(infoData) {
    this.infoData = infoData;
    // 用文案中的名称/分类覆盖默认值（缺失时保留默认）
    for (const [partId, part] of this.parts) {
      const info = infoData?.parts?.[part.defId];
      if (info) {
        part.name = info.name || part.name;
        part.category = info.category || part.category;
        part.info = info;
      }
    }
  }

  /** 匹配节点对应的部件定义 ID（前缀命名或 userData.partId） */
  _matchDefId(obj) {
    // 场景装配根节点不参与部件识别（避免 coffee_cup_machine 这类名字误匹配）
    if (obj === this.root || obj.type === 'Scene') return null;

    // 优先读取自定义属性（GLTF extras 会被 three 解析到 userData）
    const explicit = obj.userData?.partId;
    if (explicit) {
      const defId = String(explicit).replace(/_\d+$/, '');
      if (PART_DEFS[defId]) return defId;
    }
    const name = obj.name || '';
    for (const defId of Object.keys(PART_DEFS)) {
      // 精确匹配
      if (name === defId) return defId;
      // 前缀匹配且要求词边界：defId 后必须紧跟下划线，或紧跟数字（如 coffee_cup0）
      if (name.startsWith(defId) && name.length > defId.length) {
        const next = name[defId.length];
        if (next === '_' || /\d/.test(next)) return defId;
      }
    }
    return null;
  }

  /** 计算部件实例 ID：模板部件带编号，普通部件直接用定义 ID */
  _resolvePartId(obj, defId) {
    if (!TEMPLATED_PARTS.has(defId)) return defId;
    const explicit = obj.userData?.partId;
    if (explicit && this._isTemplatedId(explicit)) return explicit;
    // 从节点名提取编号：coffee_cup_02_body -> 02
    const match = (obj.name || '').match(/_(\d+)(?:_|$)/);
    const index = match ? Number(match[1]) : this._nextTemplateIndex(defId);
    return `${defId}_${index}`;
  }

  _isTemplatedId(id) {
    return /_\d+$/.test(id);
  }

  _nextTemplateIndex(defId) {
    let i = 0;
    const prefix = `${defId}_`;
    for (const id of this.parts.keys()) {
      if (id.startsWith(prefix)) i++;
    }
    return i;
  }

  /** 注册部件根节点 */
  _registerPart(partId, defId, object) {
    const def = PART_DEFS[defId];
    const part = {
      id: partId,
      defId,
      name: def.name,
      category: def.category,
      root: object,
      meshes: [],
      info: null,
      hidden: false,
      isolated: false
    };
    object.userData.partId = partId;
    this.parts.set(partId, part);
  }

  /** 沿父链向上找最近的已注册部件 */
  _findOwningPart(mesh) {
    let cur = mesh;
    while (cur) {
      if (cur.userData?.partId && this.parts.has(cur.userData.partId)) return cur.userData.partId;
      cur = cur.parent;
    }
    return null;
  }

  /** 构建仿真语义：转盘、电机、杯位装配关系 */
  _buildSemantics() {
    this.turntable = this.parts.get('main_turntable')?.root || null;
    this.motor = this.parts.get('main_motor')?.root || null;

    // 收集全部杯位编号
    const cupIndices = [...this.parts.keys()]
      .filter((id) => id.startsWith('coffee_cup_'))
      .map((id) => Number(id.split('_').pop()))
      .sort((a, b) => a - b);

    // 杯位节点通常是大转盘的子节点（随盘公转），取其相对转盘的局部坐标作为偏心基准，
    // 避免底座高度、模型整体平移污染轨迹与矢量计算
    const turntableNode = this.parts.get('main_turntable')?.root || null;

    for (const index of cupIndices) {
      const cup = this.parts.get(`coffee_cup_${index}`);
      const drive = this.parts.get(`cup_drive_${index}`);
      const frictionWheel = this.parts.get(`friction_wheel_${index}`);
      if (!cup) continue;

      // 杯心坐标：相对转盘用局部坐标，否则退回世界坐标
      const pivot = new THREE.Vector3();
      if (turntableNode && cup.root.parent === turntableNode) {
        pivot.copy(cup.root.position);
      } else {
        cup.root.getWorldPosition(pivot);
      }

      this.cupStations.push({
        index,
        cup,
        drive: drive || null,
        frictionWheel: frictionWheel || null,
        pivot,
        /** 自转轴节点：约定杯部件根节点即自转节点（程序化模型与规范模型均如此） */
        spinNode: cup.root
      });
    }
  }

  /* ---------------- 查询 API ---------------- */

  getPart(partId) {
    return this.parts.get(partId) || null;
  }

  /** 射线拾取：网格对象 -> 所属部件 */
  getPartByMesh(mesh) {
    const partId = this.meshToPart.get(mesh.uuid) || mesh.userData?.partId;
    return partId ? this.parts.get(partId) : null;
  }

  /** 全部网格（渲染模式切换、碰撞体注册用） */
  getAllMeshes() {
    const all = [];
    for (const part of this.parts.values()) all.push(...part.meshes);
    return all;
  }

  /** 机架类部件网格作为相机防穿模碰撞体（运动部件不参与，避免误挡视线） */
  getCollisionMeshes() {
    const collisionIds = ['base_frame'];
    const result = [];
    for (const id of collisionIds) {
      const part = this.parts.get(id);
      if (part) result.push(...part.meshes);
    }
    return result;
  }

  /** 构建侧边树数据：按分类分组，模板部件归组显示 */
  getTreeData() {
    const groups = new Map();
    for (const part of this.parts.values()) {
      if (!groups.has(part.category)) groups.set(part.category, []);
      groups.get(part.category).push(part);
    }
    return [...groups.entries()].map(([category, parts]) => ({
      category,
      parts: parts.sort((a, b) => a.id.localeCompare(b.id, 'zh-CN', { numeric: true }))
    }));
  }

  /* ---------------- 显隐 / 隔离 ---------------- */

  /**
   * 设置部件显隐
   * @param {string} partId
   * @param {boolean} hidden
   */
  setHidden(partId, hidden) {
    const part = this.parts.get(partId);
    if (!part) return;
    part.hidden = hidden;
    part.root.visible = !hidden;
  }

  /**
   * 隔离显示某部件（其余全部隐藏）；再次隔离同一部件则解除
   * @param {string|null} partId null 表示解除隔离
   */
  isolate(partId) {
    if (partId === null) {
      for (const part of this.parts.values()) {
        part.root.visible = !part.hidden;
        part.isolated = false;
      }
      return;
    }
    for (const part of this.parts.values()) {
      part.isolated = part.id === partId;
      part.root.visible = part.id === partId;
    }
  }
}
