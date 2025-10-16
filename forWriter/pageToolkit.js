// ==UserScript==
// @name         Page Actions Toolkit - Draggable UI + Image Unlink + Lazy Remove (with Close Button)
// @namespace    https://blog.17lai.site
// @version      1.1.0
// @description  可拖动工具条（位置持久化）+ 一键去除包裹图片的 <a> + 一键移除 lazyload（可扩展动作注册）。含关闭按钮（本次会话关闭，刷新后恢复）。Alt+U/Alt+L 快捷键。@match all sites
// @author       夜法之书
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/appotry/JsTools/main/forWriter/pageToolkit.js
// @updateURL    https://raw.githubusercontent.com/appotry/JsTools/main/forWriter/pageToolkit.js
// ==/UserScript==

(function () {
  'use strict';

  /* ========== CONFIG ========== */
  const CONFIG = {
    DEFAULT_ACTION_KEY: 'unlink_images',
    WRAP_IN_FIGURE: false,
    IMAGE_EXT_RE: /\.(png|jpe?g|gif|webp|svg|bmp)(\?.*)?$/i,
    UI_ZINDEX: 2147483647,
    SHOW_OBSERVER: false,
    AUTO_DEBOUNCE_MS: 400,
    SHORTCUT: { key: 'u', alt: true },
    QUICK_LAZY_BUTTON: { enabled: true, title: 'Remove lazyload attributes (quick)', icon: '🧹' },
    DRAG_KEY: 'page_actions_position_v1',
    DEFAULT_POS: { right: 16, top: 16 }
  };

  /* If previously closed in this page session, don't create UI again */
  if (window.__page_actions_closed) {
    // nothing to do — respect in-memory close flag
    return;
  }

  /* ========== Helpers: safe appendChild (防护) ========== */
  function safeAppend(parent, nodeOrHtml, label) {
    try {
      if (!parent || !(parent instanceof Node)) {
        console.warn('safeAppend: parent is not a Node', parent, label);
        return;
      }
      if (nodeOrHtml instanceof Node) {
        parent.appendChild(nodeOrHtml);
        return;
      }
      if (typeof nodeOrHtml === 'string') {
        try {
          const range = document.createRange();
          const frag = range.createContextualFragment(nodeOrHtml);
          parent.appendChild(frag);
          return;
        } catch (e) {
          parent.appendChild(document.createTextNode(nodeOrHtml));
          return;
        }
      }
      if (Array.isArray(nodeOrHtml)) {
        nodeOrHtml.forEach((it, idx) => safeAppend(parent, it, (label || '') + '[' + idx + ']'));
        return;
      }
      if (typeof nodeOrHtml === 'object') {
        const maybeHtml = (nodeOrHtml && nodeOrHtml.outerHTML) ? nodeOrHtml.outerHTML : String(nodeOrHtml);
        try {
          const frag = document.createRange().createContextualFragment(maybeHtml);
          parent.appendChild(frag);
          return;
        } catch (e) {
          parent.appendChild(document.createTextNode(maybeHtml));
          return;
        }
      }
      parent.appendChild(document.createTextNode(String(nodeOrHtml)));
    } catch (e) {
      console.error('safeAppend: append failed', label, e, parent, nodeOrHtml);
    }
  }

  /* ========== Actions registry & Undo stack ========== */
  const Actions = (function () {
    const registry = new Map();
    function addAction(action) {
      if (!action || !action.key || !action.name || !action.handler) {
        throw new Error('Invalid action registration');
      }
      registry.set(action.key, action);
    }
    function getAction(key) { return registry.get(key); }
    function listActions() { return Array.from(registry.values()); }
    return { addAction, getAction, listActions };
  })();

  const UndoStack = (function () {
    const stack = [];
    return {
      push: (r) => stack.push(r),
      pop: () => stack.pop(),
      clear: () => { stack.length = 0; },
      size: () => stack.length
    };
  })();

  /* ========== Lazy helpers ========== */
  const LAZY_ATTRS = [
    'data-src','data-srcset','data-lazy','data-lazy-src','data-lazy-srcset',
    'data-original','data-original-src','data-original-srcset',
    'data-src-webp','data-echo','data-zoom-image'
  ];

  function applyLazyToSrc(img) {
    if (!img || !(img instanceof HTMLElement)) return false;
    let changed = false;
    if (img.tagName.toLowerCase() === 'img') {
      for (const a of LAZY_ATTRS) {
        if (img.hasAttribute(a)) {
          const val = img.getAttribute(a);
          if (val) {
            if (/srcset$/i.test(a)) img.setAttribute('srcset', val);
            else img.setAttribute('src', val);
            changed = true;
          }
        }
      }
      if (img.getAttribute('loading') === 'lazy') { img.removeAttribute('loading'); changed = true; }
      const cls = img.className || '';
      const newCls = cls.split(/\s+/).filter(c => {
        if (!c) return false;
        const lc = c.toLowerCase();
        if (lc.indexOf('lazy') === 0 || lc === 'lozad' || lc === 'lazyload' || lc === 'lazyloaded' || lc === 'lazyloading') return false;
        return true;
      }).join(' ');
      if (newCls !== cls) { img.className = newCls; changed = true; }
    }
    return changed;
  }

  function applyLazyToSource(source) {
    if (!source || !(source instanceof HTMLElement)) return false;
    let changed = false;
    for (const a of LAZY_ATTRS) {
      if (source.hasAttribute(a)) {
        const val = source.getAttribute(a);
        if (val) {
          if (/srcset$/i.test(a)) source.setAttribute('srcset', val);
          else source.setAttribute('src', val);
          changed = true;
        }
      }
    }
    if (source.className) {
      const cls = source.className;
      const newCls = cls.split(/\s+/).filter(c => {
        if (!c) return false;
        const lc = c.toLowerCase();
        if (lc.indexOf('lazy') === 0 || lc === 'lozad' || lc === 'lazyload') return false;
        return true;
      }).join(' ');
      if (newCls !== cls) { source.className = newCls; changed = true; }
    }
    return changed;
  }

  function removeLazyAttributesFromElement(el) {
    let changed = false;
    if (!el || !(el instanceof HTMLElement)) return false;
    for (const a of LAZY_ATTRS) {
      if (el.hasAttribute(a)) { el.removeAttribute(a); changed = true; }
    }
    if (el.getAttribute && el.getAttribute('loading') === 'lazy') { el.removeAttribute('loading'); changed = true; }
    if (el.className) {
      const cls = el.className;
      const newCls = cls.split(/\s+/).filter(c => {
        if (!c) return false;
        const lc = c.toLowerCase();
        if (lc.indexOf('lazy') === 0 || lc === 'lozad' || lc === 'lazyload' || lc === 'lazyloaded' || lc === 'lazyloading') return false;
        return true;
      }).join(' ');
      if (newCls !== cls) { el.className = newCls; changed = true; }
    }
    return changed;
  }

  async function removeLazyHandler(scopeRoot = document) {
    const imgs = Array.from(scopeRoot.querySelectorAll('img'));
    let changedCount = 0;
    const changedImgs = [];
    for (const img of imgs) {
      let changed = false;
      const picture = img.closest('picture');
      if (picture) {
        const sources = Array.from(picture.querySelectorAll('source'));
        for (const s of sources) {
          const did = applyLazyToSource(s);
          if (did) changed = true;
          const removed = removeLazyAttributesFromElement(s);
          if (removed) changed = true;
        }
      }
      const act = applyLazyToSrc(img);
      if (act) changed = true;
      const parent = img.parentElement;
      if (parent) {
        for (const a of LAZY_ATTRS) {
          if (parent.hasAttribute && parent.hasAttribute(a)) {
            const val = parent.getAttribute(a);
            if (val) {
              if (/srcset$/i.test(a)) img.setAttribute('srcset', val);
              else img.setAttribute('src', val);
              changed = true;
            }
          }
        }
      }
      const removedSelf = removeLazyAttributesFromElement(img);
      if (removedSelf) changed = true;
      if (changed) {
        changedCount++;
        changedImgs.push(img);
        try {
          const src = img.getAttribute('src');
          if (src) img.src = src;
        } catch (e) { /* ignore */ }
      }
    }
    const bgElems = Array.from(scopeRoot.querySelectorAll('[data-bg],[data-background]'));
    for (const el of bgElems) {
      const src = el.getAttribute('data-bg') || el.getAttribute('data-background');
      if (src) {
        el.style.backgroundImage = `url("${src}")`;
        el.removeAttribute('data-bg');
        el.removeAttribute('data-background');
        changedCount++;
      }
    }
    const wrappers = Array.from(scopeRoot.querySelectorAll('[class*="lazy"],[data-lazy]'));
    for (const w of wrappers) {
      const removed = removeLazyAttributesFromElement(w);
      if (removed) changedCount++;
    }
    return { count: changedCount, items: changedImgs };
  }

  /* ========== Unlink image anchors (conservative) ========== */
  function isImageAnchor(a) {
    if (!a || !(a instanceof HTMLElement)) return false;
    const imgs = a.querySelectorAll('img');
    if (!imgs || imgs.length === 0) return false;
    if (a.getAttribute('data-type') === 'image') return true;
    if (a.hasAttribute('data-fancybox') || a.hasAttribute('data-lightbox') || a.hasAttribute('data-lity')) return true;
    const href = a.getAttribute('href') || '';
    if (href && CONFIG.IMAGE_EXT_RE.test(href)) return true;
    for (const img of imgs) {
      const src = img.getAttribute('src') || '';
      if (!src) continue;
      try {
        const uImg = new URL(src, location.href);
        const uHref = new URL(href || '', location.href);
        if (uImg.pathname === uHref.pathname) return true;
      } catch (e) { /* ignore */ }
    }
    for (const child of a.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'img' || tag === 'figcaption') continue;
        const nestedImgs = child.querySelectorAll && child.querySelectorAll('img');
        if (nestedImgs && nestedImgs.length) continue;
        return false;
      } else if (child.nodeType === Node.TEXT_NODE) {
        if (/\S/.test(child.nodeValue || '')) return false;
      }
    }
    return true;
  }

  function unwrapAnchor(a) {
    if (!a || !(a instanceof HTMLElement)) return null;
    const imgs = Array.from(a.querySelectorAll('img'));
    if (imgs.length === 0) return null;
    const nodes = Array.from(a.childNodes);
    const keepFrag = document.createDocumentFragment();
    let movedAny = false;
    for (const n of nodes) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const tag = n.tagName.toLowerCase();
        if (tag === 'img' || tag === 'figcaption') {
          keepFrag.appendChild(n);
          movedAny = true;
          continue;
        }
        const nestedImgs = n.querySelectorAll && n.querySelectorAll('img');
        if (nestedImgs && nestedImgs.length) {
          for (const ni of nestedImgs) {
            keepFrag.appendChild(ni);
            movedAny = true;
          }
          const nestedFig = n.querySelector && n.querySelector('figcaption');
          if (nestedFig) keepFrag.appendChild(nestedFig);
          continue;
        }
      } else if (n.nodeType === Node.TEXT_NODE) {
        if (/\S/.test(n.nodeValue || '')) return null;
      }
    }
    if (!movedAny) return null;
    let replacement;
    if (CONFIG.WRAP_IN_FIGURE) {
      const fig = document.createElement('figure');
      if (a.className) fig.className = a.className;
      fig.appendChild(keepFrag);
      replacement = fig;
    } else {
      replacement = keepFrag;
    }
    const parent = a.parentNode;
    const nextSibling = a.nextSibling;
    const record = { anchorOuterHTML: a.outerHTML, parent, nextSibling };
    parent.replaceChild(replacement, a);
    UndoStack.push(record);
    return record;
  }

  function processUnlinkImages(scopeRoot = document) {
    const anchors = Array.from(scopeRoot.querySelectorAll('a'));
    let count = 0;
    const details = [];
    for (const a of anchors) {
      try {
        if (isImageAnchor(a)) {
          const rec = unwrapAnchor(a);
          if (rec) {
            count++;
            details.push(rec);
          }
        }
      } catch (e) {
        console.error('unlink anchor error', e);
      }
    }
    return { count, details };
  }

  function undoLast() {
    const rec = UndoStack.pop();
    if (!rec) return false;
    try {
      const container = rec.parent;
      const html = rec.anchorOuterHTML;
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const restored = tmp.firstElementChild;
      if (!restored) return false;
      if (rec.nextSibling && rec.nextSibling.parentNode === container) {
        container.insertBefore(restored, rec.nextSibling);
      } else {
        container.appendChild(restored);
      }
      return true;
    } catch (e) {
      console.error('undo failed', e);
      return false;
    }
  }

  /* ========== Position persistence helpers (robust) ========== */
  function readSavedPos() {
    try {
      const raw = localStorage.getItem(CONFIG.DRAG_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') return obj;
      return null;
    } catch (e) {
      return null;
    }
  }
  function savePos(pos) {
    try { localStorage.setItem(CONFIG.DRAG_KEY, JSON.stringify(pos)); } catch (e) { /* ignore */ }
  }
  function clearSavedPos() {
    try { localStorage.removeItem(CONFIG.DRAG_KEY); } catch (e) { /* ignore */ }
  }

  /* ========== Draggable behavior ========== */
  function makeDraggable(rootEl) {
    if (!rootEl) return;
    let dragging = false;
    let startX = 0, startY = 0, startRight = 0, startTop = 0;
    function onPointerDown(e) {
      if (e.type === 'mousedown' && e.button !== 0) return;
      e.preventDefault();
      dragging = true;
      startX = e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX) || 0;
      startY = e.clientY || (e.touches && e.touches[0] && e.touches[0].clientY) || 0;
      const comp = getComputedStyle(rootEl);
      startRight = parseFloat(comp.right) || 0;
      startTop = parseFloat(comp.top) || 0;
      document.documentElement.style.userSelect = 'none';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onPointerMove, { passive: false });
      window.addEventListener('mouseup', onPointerUp, { passive: false });
      window.addEventListener('touchmove', onPointerMove, { passive: false });
      window.addEventListener('touchend', onPointerUp, { passive: false });
    }
    function onPointerMove(e) {
      if (!dragging) return;
      e.preventDefault();
      const clientX = e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX) || 0;
      const clientY = e.clientY || (e.touches && e.touches[0] && e.touches[0].clientY) || 0;
      const dx = clientX - startX, dy = clientY - startY;
      const newRight = Math.max(0, startRight - dx);
      const newTop = Math.max(0, startTop + dy);
      const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
      const elW = rootEl.offsetWidth || 0;
      const clampedRight = Math.max(0, Math.min(newRight, vw - elW));
      rootEl.style.right = `${clampedRight}px`;
      rootEl.style.top = `${newTop}px`;
    }
    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      document.documentElement.style.userSelect = '';
      document.body.style.userSelect = '';
      const comp = getComputedStyle(rootEl);
      const finalRight = comp.right && comp.right !== 'auto' ? parseFloat(comp.right) : null;
      const finalLeft = comp.left && comp.left !== 'auto' ? parseFloat(comp.left) : null;
      const finalTop = comp.top && comp.top !== 'auto' ? parseFloat(comp.top) : null;
      const pos = {};
      if (finalRight !== null) pos.right = finalRight;
      if (finalLeft !== null) pos.left = finalLeft;
      if (finalTop !== null) pos.top = finalTop;
      savePos(pos);
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mouseup', onPointerUp);
      window.removeEventListener('touchmove', onPointerMove);
      window.removeEventListener('touchend', onPointerUp);
      rootEl.style.transition = 'right 120ms, top 120ms';
    }
    rootEl.addEventListener('mousedown', onPointerDown, { passive: false });
    rootEl.addEventListener('touchstart', onPointerDown, { passive: false });
    rootEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      clearSavedPos();
      rootEl.style.right = `${CONFIG.DEFAULT_POS.right}px`;
      rootEl.style.top = `${CONFIG.DEFAULT_POS.top}px`;
      showToast('Position reset');
      return false;
    });
  }

  /* ========== UI creation (uses safeAppend) ========== */
  function createUI() {
    if (document.getElementById('page-actions-toolkit')) return;

    const root = document.createElement('div');
    root.id = 'page-actions-toolkit';
    Object.assign(root.style, {
      position: 'fixed',
      right: `${CONFIG.DEFAULT_POS.right}px`,
      top: `${CONFIG.DEFAULT_POS.top}px`,
      zIndex: CONFIG.UI_ZINDEX,
      fontFamily: 'system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      transition: 'right 120ms, top 120ms'
    });

    // load saved pos
    try {
      const saved = readSavedPos();
      if (saved && typeof saved === 'object') {
        if ('right' in saved) root.style.right = `${saved.right}px`;
        else if ('left' in saved) { root.style.left = `${saved.left}px`; root.style.removeProperty('right'); }
        if ('top' in saved) root.style.top = `${saved.top}px`;
      }
    } catch (e) { /* ignore */ }

    const mainBtn = document.createElement('button');
    mainBtn.id = 'page-actions-button';
    mainBtn.type = 'button';
    mainBtn.title = 'Page Actions Toolkit (drag to move; right-click to reset)';
    mainBtn.innerHTML = '⚙️ Actions';
    Object.assign(mainBtn.style, {
      background: '#2d8cff', color: '#fff', border: 'none', padding: '8px 10px', borderRadius: '6px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.2)', cursor: 'grab', fontSize: '13px', opacity: '0.95'
    });

    let quickBtn = null;
    if (CONFIG.QUICK_LAZY_BUTTON && CONFIG.QUICK_LAZY_BUTTON.enabled) {
      quickBtn = document.createElement('button');
      quickBtn.id = 'page-actions-quick-lazy';
      quickBtn.type = 'button';
      quickBtn.title = CONFIG.QUICK_LAZY_BUTTON.title || 'Remove lazyload';
      quickBtn.innerHTML = CONFIG.QUICK_LAZY_BUTTON.icon || '🧹';
      Object.assign(quickBtn.style, {
        background: '#4caf50', color: '#fff', border: 'none', padding: '8px 10px', borderRadius: '6px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.15)', cursor: 'pointer', fontSize: '13px', opacity: '0.95'
      });
    }

    /* ====== CLOSE BUTTON (本次会话关闭，刷新恢复) ====== */
    const closeBtn = document.createElement('button');
    closeBtn.id = 'page-actions-close';
    closeBtn.type = 'button';
    closeBtn.title = 'Close (hide for this page session; refresh to restore)';
    closeBtn.innerHTML = '✖';
    Object.assign(closeBtn.style, {
      background: 'transparent', color: '#666', border: 'none', padding: '6px 8px', borderRadius: '6px',
      cursor: 'pointer', fontSize: '14px', lineHeight: '1'
    });
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#222'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = '#666'; });
    closeBtn.addEventListener('click', (e) => {
      try {
        // set in-memory flag — will not persist across refresh
        window.__page_actions_closed = true;
        // hide the UI immediately
        const el = document.getElementById('page-actions-toolkit');
        if (el) el.style.display = 'none';
        showToast('Page Actions hidden for this session');
      } catch (err) {
        console.error('closeBtn click error', err);
      }
    });
    /* ====== END CLOSE BUTTON ====== */

    const panel = document.createElement('div');
    panel.id = 'page-actions-panel';
    Object.assign(panel.style, {
      display: 'none',
      position: 'absolute',
      right: '0',
      top: '44px',
      minWidth: '300px',
      background: '#fff',
      color: '#222',
      borderRadius: '8px',
      boxShadow: '0 6px 22px rgba(0,0,0,0.15)',
      padding: '10px',
      fontSize: '13px'
    });

    const toast = document.createElement('div');
    toast.id = 'page-actions-toast';
    Object.assign(toast.style, {
      position: 'fixed',
      right: '16px',
      top: '80px',
      zIndex: CONFIG.UI_ZINDEX,
      pointerEvents: 'none'
    });

    // ensure actions
    if (!Actions.getAction('unlink_images')) {
      Actions.addAction({
        key: 'unlink_images',
        name: 'Unlink image anchors',
        description: '移除包裹图片的 <a>（保留 <img> 和 figcaption），可撤销。',
        handler: async (scopeRoot) => { const res = processUnlinkImages(scopeRoot); showToast(`Unlinked ${res.count} anchor(s)`); return res; }
      });
    }
    if (!Actions.getAction('remove_lazy')) {
      Actions.addAction({
        key: 'remove_lazy',
        name: 'Remove lazyload (images)',
        description: '把常见 lazyload/data-src/data-srcset 应用到 img/src/srcset，并移除 lazy 属性与类。',
        handler: async (scopeRoot) => { const res = await removeLazyHandler(scopeRoot); showToast(`Lazy removed: ${res.count || 0}`); return res; }
      });
    }

    // build actions panel
    const actions = Actions.listActions();
    if (actions.length === 0) {
      const p = document.createElement('p'); p.textContent = 'No actions registered.'; panel.appendChild(p);
    } else {
      actions.forEach(act => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '8px';
        row.style.alignItems = 'center';
        row.style.marginBottom = '8px';

        const title = document.createElement('div');
        title.style.flex = '1';
        title.innerHTML = `<strong>${escapeHtml(act.name)}</strong><div style="font-size:12px;color:#666">${escapeHtml(act.description || '')}</div>`;

        const runBtn = document.createElement('button');
        runBtn.textContent = 'Run';
        Object.assign(runBtn.style, { padding: '6px 8px', borderRadius: '6px', background: '#2d8cff', color: '#fff', border: 'none', cursor: 'pointer' });
        runBtn.addEventListener('click', async () => {
          try {
            runBtn.disabled = true; runBtn.textContent = 'Running...';
            const res = await act.handler(document, { source: 'ui' });
            showToast(`Action "${act.name}" completed: ${res && res.count ? res.count : '0'}`);
          } catch (e) {
            console.error(e);
            showToast(`Action "${act.name}" failed: ${e.message || e}`);
          } finally {
            runBtn.disabled = false; runBtn.textContent = 'Run';
          }
        });

        row.appendChild(title);
        row.appendChild(runBtn);
        panel.appendChild(row);
      });
    }

    const hr = document.createElement('hr');
    hr.style.border = 'none';
    hr.style.height = '1px';
    hr.style.background = '#eee';
    hr.style.margin = '8px 0';

    const undoRow = document.createElement('div');
    undoRow.style.display = 'flex';
    undoRow.style.gap = '8px';
    undoRow.style.justifyContent = 'space-between';
    undoRow.style.alignItems = 'center';

    const undoBtn = document.createElement('button');
    undoBtn.textContent = 'Undo Last';
    Object.assign(undoBtn.style, { padding: '6px 8px', borderRadius: '6px', background: '#ff8c4b', color: '#fff', border: 'none', cursor: 'pointer' });
    undoBtn.addEventListener('click', () => { const ok = undoLast(); showToast(ok ? 'Undo succeeded' : 'Nothing to undo'); });

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear Undo';
    Object.assign(clearBtn.style, { padding: '6px 8px', borderRadius: '6px', background: '#999', color: '#fff', border: 'none', cursor: 'pointer' });
    clearBtn.addEventListener('click', () => { UndoStack.clear(); showToast('Undo stack cleared'); });

    undoRow.appendChild(undoBtn);
    undoRow.appendChild(clearBtn);

    panel.appendChild(hr);
    panel.appendChild(undoRow);

    // assemble wrapper and attach using safeAppend
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    // order: mainBtn, quickBtn, closeBtn
    wrapper.appendChild(mainBtn);
    if (quickBtn) wrapper.appendChild(quickBtn);
    wrapper.appendChild(closeBtn); // <-- close button included in UI

    safeAppend(root, wrapper, 'wrapper');
    safeAppend(root, panel, 'panel');
    safeAppend(document.body, root, 'root');
    safeAppend(document.body, toast, 'toast');

    // make draggable
    makeDraggable(root);

    // events
    mainBtn.addEventListener('click', (e) => { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; });

    if (quickBtn) {
      quickBtn.addEventListener('click', async (e) => {
        quickBtn.disabled = true;
        quickBtn.textContent = 'Running...';
        try {
          const act = Actions.getAction('remove_lazy');
          if (act) {
            const res = await act.handler(document, { source: 'quickbtn' });
            showToast(`Lazy removed: ${res && res.count ? res.count : 0}`);
          } else {
            showToast('No lazy-remove action registered');
          }
        } catch (err) {
          console.error(err);
          showToast('Lazy remove failed');
        } finally {
          quickBtn.disabled = false;
          quickBtn.innerHTML = CONFIG.QUICK_LAZY_BUTTON.icon || '🧹';
        }
      });
    }

    document.addEventListener('click', (e) => { if (!root.contains(e.target)) panel.style.display = 'none'; });
  }

  /* ========== Shortcuts & Observer ========== */
  function registerShortcut() {
    document.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === (CONFIG.SHORTCUT.key || 'u') &&
          !!e.altKey === !!CONFIG.SHORTCUT.alt &&
          !!e.ctrlKey === !!CONFIG.SHORTCUT.ctrl &&
          !!e.shiftKey === !!CONFIG.SHORTCUT.shift) {
        e.preventDefault();
        const act = Actions.getAction(CONFIG.DEFAULT_ACTION_KEY);
        if (act) act.handler(document, { source: 'shortcut' });
      }
      if (e.key.toLowerCase() === 'l' && e.altKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        const act = Actions.getAction('remove_lazy');
        if (act) act.handler(document, { source: 'shortcut' }).then(res => showToast(`Lazy removed: ${res.count || 0}`)).catch(err => showToast('Lazy remove failed'));
      }
    });
  }

  let mutationTimer = null;
  function setupObserver() {
    if (!CONFIG.SHOW_OBSERVER) return;
    const observer = new MutationObserver((mutations) => {
      let need = false;
      for (const m of mutations) {
        if (m.addedNodes && m.addedNodes.length) {
          for (const n of m.addedNodes) {
            if (!(n instanceof HTMLElement)) continue;
            if (n.querySelector && n.querySelector('img')) { need = true; break; }
          }
        }
        if (need) break;
      }
      if (need) {
        if (mutationTimer) clearTimeout(mutationTimer);
        mutationTimer = setTimeout(() => {
          const act = Actions.getAction(CONFIG.DEFAULT_ACTION_KEY);
          if (act) act.handler(document, { source: 'observer' });
        }, CONFIG.AUTO_DEBOUNCE_MS);
      }
    });
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
  }

  /* ========== Misc UI helpers ========== */
  function showToast(text, ms = 2200) {
    let t = document.getElementById('page-actions-toast');
    if (!t) return;
    const el = document.createElement('div');
    el.textContent = text;
    Object.assign(el.style, { margin: '6px 0', background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', pointerEvents: 'auto' });
    t.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity 300ms';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, ms);
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }

  /* ========== Init ========== */
  function init() {
    try {
      if (window.__page_actions_closed) return; // safety: respect in-memory close flag
      createUI();
      registerShortcut();
      setupObserver();
    } catch (e) {
      console.error('PageActions init error', e);
    }
  }

  init();

})();
