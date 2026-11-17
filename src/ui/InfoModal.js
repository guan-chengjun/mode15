/**
 * 部件科普信息弹窗
 * -------------------------------------------------------------
 * 点击 3D 部件 / 部件树 / 空间标签时弹出，内容来自独立 JSON 配置
 * （public/config/parts.info.json），包含：
 *  工作原理、结构说明、常见故障与维护、运行参数。
 * 模板部件（咖啡杯等）按 defId 共享同一份文案，避免 JSON 冗余。
 */
import { bus } from '../core/EventBus.js';

export class InfoModal {
  /**
   * @param {PartRegistry} registry
   */
  constructor(registry) {
    this.registry = registry;
    this.modal = document.getElementById('info-modal');
    this.el = {
      title: document.getElementById('info-title'),
      tags: document.getElementById('info-tags'),
      principle: document.getElementById('info-principle'),
      structure: document.getElementById('info-structure'),
      maintenance: document.getElementById('info-maintenance'),
      paramsSection: document.getElementById('info-params-section'),
      params: document.getElementById('info-params'),
      close: document.getElementById('info-close')
    };
  }

  bind() {
    bus.on('part:select', (partId) => {
      if (partId) this.open(partId);
      else this.close();
    });
    this.el.close.addEventListener('click', () => this.close());
    this.modal.querySelector('.info-modal-mask').addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this.close();
    });
  }

  /** 打开弹窗并填充文案 */
  open(partId) {
    const part = this.registry.getPart(partId);
    if (!part) return;
    const info = part.info;

    this.el.title.textContent = part.name;
    if (!info) {
      // 文案缺失时的优雅降级：展示结构信息而非空白
      this.el.tags.innerHTML = `<span class="tag">${part.category}</span><span class="tag">文案待补充</span>`;
      this.el.principle.textContent = `该部件（节点 ID：${part.id}）的科普文案尚未在 parts.info.json 中配置，请按《模型制作规范.md》补充。`;
      this.el.structure.textContent = '—';
      this.el.maintenance.innerHTML = '<li>暂无维护条目</li>';
      this.el.paramsSection.style.display = 'none';
    } else {
      this.el.tags.innerHTML = [part.category, ...(info.tags || [])]
        .map((t) => `<span class="tag">${t}</span>`)
        .join('');
      this.el.principle.textContent = info.principle;
      this.el.structure.textContent = info.structure;
      this.el.maintenance.innerHTML = (info.maintenance || []).map((m) => `<li>${m}</li>`).join('');
      if (info.params && Object.keys(info.params).length > 0) {
        this.el.paramsSection.style.display = '';
        this.el.params.innerHTML = Object.entries(info.params)
          .map(([k, v]) => `<div class="param-row"><span>${k}</span><span>${v}</span></div>`)
          .join('');
      } else {
        this.el.paramsSection.style.display = 'none';
      }
    }

    this.modal.classList.remove('hidden');
  }

  close() {
    this.modal.classList.add('hidden');
  }
}
