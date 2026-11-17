/**
 * 侧边部件树面板
 * -------------------------------------------------------------
 * - 按部件分类分组渲染（数据来自 PartRegistry.getTreeData）
 * - 每行：选中（点击）、隔离显示、隐藏/显示 三个操作
 * - 支持名称搜索过滤
 * - 与 3D 拾取、信息弹窗通过 part:select / part:hover 事件双向联动
 */
import { bus } from '../core/EventBus.js';

export class TreePanel {
  /**
   * @param {PartRegistry} registry
   */
  constructor(registry) {
    this.registry = registry;
    this.rootEl = document.getElementById('tree-root');
    this.searchEl = document.getElementById('tree-search');
    /** 当前隔离的部件 ID（null = 未隔离） */
    this.isolatedId = null;
  }

  /** 模型注册完成后渲染整棵树 */
  render() {
    this.rootEl.innerHTML = '';
    const groups = this.registry.getTreeData();

    for (const group of groups) {
      const groupEl = document.createElement('div');
      groupEl.className = 'tree-group';

      const header = document.createElement('div');
      header.className = 'tree-row';
      header.innerHTML = `<span class="tree-toggle">▾</span>
        <span class="tree-name" style="font-weight:600;color:var(--accent)">${group.category}</span>
        <span class="tree-cat">${group.parts.length}</span>`;

      const children = document.createElement('div');
      children.className = 'tree-children';
      // 分组折叠
      header.addEventListener('click', () => {
        const collapsed = children.style.display === 'none';
        children.style.display = collapsed ? '' : 'none';
        header.querySelector('.tree-toggle').textContent = collapsed ? '▾' : '▸';
      });

      for (const part of group.parts) {
        children.appendChild(this._createRow(part));
      }

      groupEl.append(header, children);
      this.rootEl.appendChild(groupEl);
    }

    // 搜索过滤
    this.searchEl.addEventListener('input', () => {
      const keyword = this.searchEl.value.trim().toLowerCase();
      this.rootEl.querySelectorAll('.tree-node').forEach((row) => {
        row.style.display = !keyword || row.dataset.name.includes(keyword) ? '' : 'none';
      });
    });

    // 3D 拾取联动：选中行高亮
    bus.on('part:select', (partId) => this._highlightRow(partId));
  }

  /** 创建单个部件行 */
  _createRow(part) {
    const row = document.createElement('div');
    row.className = 'tree-node tree-row';
    row.dataset.partId = part.id;
    row.dataset.name = `${part.name} ${part.id}`.toLowerCase();
    row.title = `部件 ID：${part.id}`;
    row.innerHTML = `
      <span class="tree-toggle">●</span>
      <span class="tree-name">${part.name}</span>
      <span class="tree-actions">
        <button class="tree-icon-btn act-isolate" title="隔离显示（再次点击解除）">🔬</button>
        <button class="tree-icon-btn act-hide" title="隐藏/显示">👁</button>
      </span>`;

    // 点击行 = 选中部件（触发信息弹窗与轮廓高亮）
    row.addEventListener('click', (e) => {
      if (e.target.closest('.tree-icon-btn')) return;
      bus.emit('part:select', part.id);
    });

    // 隔离显示
    row.querySelector('.act-isolate').addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleIsolate(part.id, row);
    });

    // 隐藏/显示
    row.querySelector('.act-hide').addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleHidden(part.id, row);
    });

    // 悬浮同步到 3D 轮廓
    row.addEventListener('mouseenter', () => bus.emit('part:hover', part.id));
    row.addEventListener('mouseleave', () => bus.emit('part:hover', null));

    return row;
  }

  /** 隔离切换 */
  _toggleIsolate(partId, row) {
    if (this.isolatedId === partId) {
      this.isolatedId = null;
      this.registry.isolate(null);
      bus.emit('part:isolate', null);
    } else {
      this.isolatedId = partId;
      this.registry.isolate(partId);
      bus.emit('part:isolate', partId);
    }
    this.rootEl.querySelectorAll('.tree-row').forEach((r) => r.classList.remove('selected'));
    row.classList.add('selected');
  }

  /** 隐藏切换 */
  _toggleHidden(partId, row) {
    const part = this.registry.getPart(partId);
    const nextHidden = !part.hidden;
    this.registry.setHidden(partId, nextHidden);
    row.classList.toggle('dimmed', nextHidden);
    row.querySelector('.act-hide').textContent = nextHidden ? '🚫' : '👁';
    bus.emit('part:visibility', { partId, hidden: nextHidden });
  }

  /** 选中行高亮（3D 拾取联动） */
  _highlightRow(partId) {
    this.rootEl.querySelectorAll('.tree-row').forEach((r) => r.classList.remove('selected'));
    if (!partId) return;
    const row = this.rootEl.querySelector(`[data-part-id="${partId}"]`);
    if (row) {
      row.classList.add('selected');
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}
