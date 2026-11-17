/**
 * 仿真日志器
 * -------------------------------------------------------------
 * - 分级记录仿真过程中的关键事件（启停、模式切换、限位触发、降级等）
 * - 环形缓冲控制内存占用
 * - 支持导出 CSV，供教学报告与故障复盘使用
 */
import { bus } from './EventBus.js';

/** 日志级别（与控制台方法对应） */
export const LogLevel = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR'
};

/** 环形缓冲最大条数，超出后最旧记录被覆盖 */
const MAX_ENTRIES = 1000;

class Logger {
  constructor() {
    /** @type {Array<{time:number, simTime:number, level:string, message:string}>} */
    this._entries = [];
    /** 仿真时钟（秒），由 SimulationEngine 通过 setSimTime 同步 */
    this._simTime = 0;
  }

  /** 同步当前仿真时间，保证日志时间轴与仿真时间轴一致 */
  setSimTime(t) {
    this._simTime = t;
  }

  /**
   * 写入一条日志
   * @param {string} message 中文日志内容
   * @param {string} level 级别，默认 INFO
   */
  log(message, level = LogLevel.INFO) {
    const entry = {
      time: Date.now(),
      simTime: Number(this._simTime.toFixed(3)),
      level,
      message
    };
    this._entries.push(entry);
    if (this._entries.length > MAX_ENTRIES) this._entries.shift();

    // 同步发布到 UI 日志面板
    bus.emit('sim:log', entry);

    const consoleFn = level === LogLevel.ERROR ? console.error : level === LogLevel.WARN ? console.warn : console.log;
    consoleFn(`[仿真日志][${level}] t=${entry.simTime}s ${message}`);
  }

  info(message) {
    this.log(message, LogLevel.INFO);
  }
  warn(message) {
    this.log(message, LogLevel.WARN);
  }
  error(message) {
    this.log(message, LogLevel.ERROR);
  }

  /** 获取全部日志（不可变副本） */
  getAll() {
    return [...this._entries];
  }

  /** 清空日志 */
  clear() {
    this._entries.length = 0;
    bus.emit('sim:log', { cleared: true });
  }

  /**
   * 导出 CSV 文件（带 UTF-8 BOM，Excel 直接打开不乱码）
   * @returns {boolean} 是否导出成功
   */
  exportCSV() {
    if (this._entries.length === 0) {
      this.warn('暂无日志可导出');
      return false;
    }
    const header = '真实时间戳,仿真时间(秒),级别,内容';
    const rows = this._entries.map((e) => {
      const csvEscape = (v) => `"${String(v).replace(/"/g, '""')}"`;
      return [new Date(e.time).toLocaleString('zh-CN'), e.simTime, e.level, csvEscape(e.message)].join(',');
    });
    // ﻿ 为 UTF-8 BOM，保证中文在 Excel 中正确识别编码
    const csv = '﻿' + [header, ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `咖啡杯仿真日志_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.info(`已导出 ${rows.length} 条仿真日志`);
    return true;
  }
}

/** 全局单例日志器 */
export const logger = new Logger();
