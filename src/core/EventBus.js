/**
 * 全局事件总线
 * -------------------------------------------------------------
 * 模块间解耦通信的核心：仿真模块、渲染模块、UI 模块互不直接持有引用，
 * 全部通过 EventBus 发布/订阅事件。
 *
 * 事件名约定（集中维护，避免拼写错误）：
 *  model:loaded        模型加载完成        payload: { root, registry }
 *  model:load-failed   模型加载失败        payload: Error
 *  sim:mode-changed    传动模式切换        payload: 'friction' | 'independent'
 *  sim:running         运行状态变化        payload: boolean
 *  sim:step            单步/每帧仿真完成   payload: SimState
 *  sim:reset           仿真复位
 *  sim:log             仿真日志事件        payload: { time, level, message }
 *  part:select         部件被选中          payload: partId | null
 *  part:hover          悬浮部件变化        payload: partId | null
 *  part:visibility     部件显隐变化        payload: { partId, hidden }
 *  part:isolate        部件隔离变化        payload: partId | null
 *  render:mode-changed 渲染模式变化        payload: 'solid'|'xray'|'wireframe'|'normal'
 *  camera:bookmark     切换视角书签        payload: bookmark 对象
 *  camera:tour         自动巡检开关        payload: boolean
 *  perf:degrade        画质降级/升档       payload: level 对象
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} 事件名 -> 监听函数集合 */
    this._listeners = new Map();
  }

  /**
   * 订阅事件
   * @param {string} event 事件名
   * @param {Function} handler 处理函数
   * @returns {() => void} 取消订阅函数
   */
  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  /** 订阅一次，触发后自动移除 */
  once(event, handler) {
    const wrapper = (payload) => {
      this.off(event, wrapper);
      handler(payload);
    };
    return this.on(event, wrapper);
  }

  /** 取消订阅 */
  off(event, handler) {
    this._listeners.get(event)?.delete(handler);
  }

  /**
   * 发布事件
   * @param {string} event 事件名
   * @param {*} payload 载荷
   */
  emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;
    // 复制一份再遍历，避免回调中增删订阅导致迭代异常
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        // 单个订阅者出错不影响其它订阅者
        console.error(`[EventBus] 事件 "${event}" 的订阅者抛出异常:`, err);
      }
    }
  }

  /** 清除全部订阅（主要用于测试与热更新） */
  clear() {
    this._listeners.clear();
  }
}

/** 全局单例事件总线 */
export const bus = new EventBus();
