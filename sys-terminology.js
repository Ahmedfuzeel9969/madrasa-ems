// ================= شعبۂ اصطلاحات — Phase B: Tree Terminology Engine =================
(function () {
  'use strict';

  var DICT_KEY = 'ems_sys_dict';
  var scanCache = {};
  var expanded = {};
  var selectedNodeId = null;
  var treeData = [];

  var SCOPE_NAMES = {
    global: 'پورا سافٹ ویئر',
    ribbon: 'مرکزی مینیو',
    dashboard: 'ڈیش بورڈ',
    admission: 'رجسٹریشن',
    attendance: 'حاضری',
    finance: 'فیس / مالیات',
    ledger: 'مالیات و تنخواہ',
    exams: 'امتحانات',
    complaints: 'شکایات',
    announcements: 'اعلانات',
    'sys-settings': 'سسٹم سیٹنگز',
    admin: 'ایڈمن پینل'
  };

  var COMMON_TERMS = [
    { id: 'term-student', label: 'طالب علم', defaultText: 'طالب علم', scope: 'global' },
    { id: 'term-students', label: 'طلباء', defaultText: 'طلباء', scope: 'global' },
    { id: 'term-teacher', label: 'استاد', defaultText: 'استاد', scope: 'global' },
    { id: 'term-teachers', label: 'اساتذہ', defaultText: 'اساتذہ', scope: 'global' },
    { id: 'term-staff', label: 'عملہ', defaultText: 'عملہ', scope: 'global' },
    { id: 'term-dept', label: 'شعبہ', defaultText: 'شعبہ', scope: 'global' },
    { id: 'term-class', label: 'درجہ', defaultText: 'درجہ', scope: 'global' },
    { id: 'term-attendance', label: 'حاضری', defaultText: 'حاضری', scope: 'global' },
    { id: 'term-exam', label: 'امتحان', defaultText: 'امتحان', scope: 'global' },
    { id: 'term-fee', label: 'فیس', defaultText: 'فیس', scope: 'global' },
    { id: 'term-registration', label: 'رجسٹریشن', defaultText: 'رجسٹریشن', scope: 'global' },
    { id: 'term-complaint', label: 'شکایت', defaultText: 'شکایت', scope: 'global' }
  ];

  var MODULE_ROOTS = [
    { id: 'root-common', label: 'عام اصطلاحات', icon: 'fa-book', scope: 'global', kind: 'common' },
    { id: 'root-ribbon', label: 'مرکزی مینیو (Ribbon)', icon: 'fa-bars', scope: 'ribbon', container: '.ribbon-tabs' },
    { id: 'root-dashboard', label: 'ڈیش بورڈ', icon: 'fa-chart-pie', scope: 'dashboard', container: '#module-dashboard' },
    { id: 'root-admission', label: 'رجسٹریشن / داخلہ', icon: 'fa-user-plus', scope: 'admission', container: '#module-admission' },
    { id: 'root-attendance', label: 'حاضری', icon: 'fa-calendar-check', scope: 'attendance', container: '#module-attendance' },
    { id: 'root-finance', label: 'فیس سسٹم', icon: 'fa-money-bill-wave', scope: 'finance', container: '#module-finance' },
    { id: 'root-ledger', label: 'مالیات و تنخواہ', icon: 'fa-wallet', scope: 'ledger', container: '#module-ledger' },
    { id: 'root-exams', label: 'امتحانات', icon: 'fa-graduation-cap', scope: 'exams', container: '#module-exams' },
    { id: 'root-complaints', label: 'شکایات', icon: 'fa-exclamation-triangle', scope: 'complaints', container: '#module-complaints' },
    { id: 'root-announcements', label: 'اعلانات و فیصلے', icon: 'fa-bullhorn', scope: 'announcements', container: '#module-announcements' },
    { id: 'root-sys-settings', label: 'سسٹم سیٹنگز', icon: 'fa-cogs', scope: 'sys-settings', container: '#module-sys-settings' }
  ];

  function readDict() {
    try { return JSON.parse(localStorage.getItem(DICT_KEY)) || []; } catch (e) { return []; }
  }

  function writeDict(dict) {
    if (window.emsSaveModuleData) return window.emsSaveModuleData(DICT_KEY, JSON.stringify(dict), { mutation: true, autoDelta: true });
    localStorage.setItem(DICT_KEY, JSON.stringify(dict));
    return Promise.resolve();
  }

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'success');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function hashText(s) {
    var h = 0;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0;
    return Math.abs(h).toString(36);
  }

  function extractBtnText(el) {
    if (!el) return '';
    var clone = el.cloneNode(true);
    clone.querySelectorAll('i, svg').forEach(function (n) { n.remove(); });
    return clone.textContent.replace(/\s+/g, ' ').trim();
  }

  function extractPanelId(btn) {
    var oc = btn.getAttribute('onclick') || '';
    var m = oc.match(/['"]([\w-]+)['"]\s*,/);
    return m ? m[1] : null;
  }

  function getScopeName(scope) {
    return SCOPE_NAMES[scope] || scope || '—';
  }

  function getDictEntry(nodeId) {
    return readDict().find(function (d) { return d.nodeId === nodeId; });
  }

  function getLiveText(node) {
    var entry = getDictEntry(node.id);
    if (entry && entry.newWord) return entry.newWord;
    if (node.domHint) {
      var el = resolveElement(node.domHint);
      if (el) return extractBtnText(el) || el.textContent.replace(/\s+/g, ' ').trim();
    }
    return node.oldWord || node.defaultText || node.label || '';
  }

  function resolveElement(hint) {
    if (!hint) return null;
    if (hint.selector) {
      try { return document.querySelector(hint.selector); } catch (e) { return null; }
    }
    var root = hint.panelId ? document.getElementById(hint.panelId) : (hint.container ? document.querySelector(hint.container) : null);
    if (!root && hint.container) root = document.querySelector(hint.container);
    if (!root) return null;
    var list = root.querySelectorAll(hint.tag || 'label');
    return list[hint.index] || null;
  }

  function buildDomHint(el, scope, panelId) {
    if (!el) return null;
    var root = panelId ? document.getElementById(panelId) : null;
    var mod = MODULE_ROOTS.find(function (m) { return m.scope === scope; });
    if (!root && mod && mod.container) root = document.querySelector(mod.container);
    if (!root) root = document.body;
    var tag = el.tagName;
    var list = root.querySelectorAll(tag);
    var index = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i] === el) { index = i; break; }
    }
    return {
      tag: tag,
      index: index,
      panelId: panelId || '',
      container: mod && mod.container ? mod.container : ''
    };
  }

  function scanLabels(panel, scope, path, panelId, limit) {
    limit = limit || 50;
    var seen = {};
    var out = [];
    panel.querySelectorAll('label, h2, h3, th').forEach(function (lab) {
      if (lab.closest('#sys-win-terminology, #sys-term-tree, #sys-audit-detail-modal')) return;
      var text = lab.textContent.replace(/\s+/g, ' ').trim();
      if (text.length < 2 || text.length > 80) return;
      if (seen[text]) return;
      seen[text] = 1;
      var id = scope + ':lbl:' + hashText(text) + ':' + hashText(panelId || path);
      lab.setAttribute('data-ems-term-id', id);
      out.push({
        id: id,
        label: text,
        type: 'label',
        scope: scope,
        path: path + ' › ' + text,
        oldWord: text,
        leaf: true,
        domHint: buildDomHint(lab, scope, panelId)
      });
    });
    return out.slice(0, limit);
  }

  function scanTabs(container, scope, pathPrefix) {
    var nodes = [];
    container.querySelectorAll('.reg-tab, .ribbon-tab, .fee-tab-content > h2, .ann-tab-content > h2').forEach(function (btn) {
      if (btn.closest('#module-sys-settings #sys-ribbon-menu')) return;
      var text = extractBtnText(btn);
      if (!text || text.length < 2) return;
      var panelId = extractPanelId(btn);
      var id = scope + ':tab:' + hashText(text);
      btn.setAttribute('data-ems-term-id', id);
      var node = {
        id: id,
        label: text,
        type: 'tab',
        scope: scope,
        path: pathPrefix + ' › ' + text,
        oldWord: text,
        leaf: !panelId,
        domHint: buildDomHint(btn, scope, panelId),
        children: []
      };
      if (panelId) {
        var panel = document.getElementById(panelId);
        if (panel) node.children = scanLabels(panel, scope, node.path, panelId);
        node.leaf = false;
      }
      nodes.push(node);
    });
    return nodes;
  }

  function scanModule(root) {
    if (root.kind === 'common') {
      return COMMON_TERMS.map(function (t) {
        return {
          id: t.id,
          label: t.label,
          type: 'term',
          scope: t.scope,
          path: 'عام اصطلاحات › ' + t.label,
          oldWord: t.defaultText,
          defaultText: t.defaultText,
          leaf: true
        };
      });
    }
    if (scanCache[root.id]) return scanCache[root.id];
    var container = root.container ? document.querySelector(root.container) : null;
    if (!container) { scanCache[root.id] = []; return []; }
    var children = scanTabs(container, root.scope, root.label);
    if (!children.length) children = scanLabels(container, root.scope, root.label, '', 60);
    scanCache[root.id] = children;
    return children;
  }

  function buildTreeData() {
    return MODULE_ROOTS.map(function (root) {
      return {
        id: root.id,
        label: root.label,
        icon: root.icon,
        scope: root.scope,
        path: root.label,
        kind: root.kind || 'module',
        leaf: false,
        children: expanded[root.id] ? scanModule(root) : []
      };
    });
  }

  function renderTreeNode(node, depth) {
    depth = depth || 0;
    var pad = depth * 16;
    var hasKids = node.children && node.children.length;
    var isFolder = !node.leaf;
    var isOpen = expanded[node.id];
    var isSel = selectedNodeId === node.id;
    var icon = node.icon ? node.icon : (isFolder ? (isOpen ? 'fa-folder-open' : 'fa-folder') : 'fa-tag');
    var override = getDictEntry(node.id);
    var badge = override && override.newWord ? ' <span class="sys-term-badge">✓</span>' : '';
    var html = '<div class="sys-term-node' + (isSel ? ' selected' : '') + '" style="padding-right:' + pad + 'px;">';
    if (isFolder || (node.children && node.children.length)) {
      html += '<button type="button" class="sys-term-toggle" data-id="' + esc(node.id) + '" title="کھولیں/بند"><i class="fas ' + (isOpen ? 'fa-chevron-down' : 'fa-chevron-left') + '"></i></button>';
    } else {
      html += '<span class="sys-term-toggle-spacer"></span>';
    }
    html += '<button type="button" class="sys-term-label' + (node.leaf ? ' leaf' : '') + '" data-id="' + esc(node.id) + '">';
    html += '<i class="fas ' + icon + '"></i> ' + esc(node.label) + badge + '</button></div>';
    if (hasKids && isOpen) {
      html += '<div class="sys-term-children">';
      node.children.forEach(function (ch) { html += renderTreeNode(ch, depth + 1); });
      html += '</div>';
    }
    return html;
  }

  function findNodeById(id, nodes) {
    nodes = nodes || treeData;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) return nodes[i];
      if (nodes[i].children) {
        var f = findNodeById(id, nodes[i].children);
        if (f) return f;
      }
    }
    return null;
  }

  function flattenForSearch(nodes, out, parentLabel) {
    out = out || [];
    (nodes || []).forEach(function (n) {
      var lbl = (parentLabel ? parentLabel + ' › ' : '') + n.label;
      out.push({ node: n, search: lbl.toLowerCase() });
      if (n.children && n.children.length) flattenForSearch(n.children, out, lbl);
    });
    return out;
  }

  window.sysTermRenderTree = function () {
    var box = document.getElementById('sys-term-tree');
    if (!box) return;
    treeData = buildTreeData();
    var q = (document.getElementById('sys-term-search') || {}).value || '';
    q = q.trim().toLowerCase();
    if (q) {
      var flat = [];
      MODULE_ROOTS.forEach(function (root) {
        var kids = scanModule(root);
        flattenForSearch(kids, flat, root.label);
      });
      var hits = flat.filter(function (x) { return x.search.indexOf(q) !== -1; }).slice(0, 40);
      if (!hits.length) {
        box.innerHTML = '<p class="sys-term-empty">کوئی نتیجہ نہیں</p>';
        return;
      }
      box.innerHTML = hits.map(function (h) {
        var ov = getDictEntry(h.node.id);
        return '<button type="button" class="sys-term-search-hit" data-id="' + esc(h.node.id) + '">' +
          '<small>' + esc(h.search) + '</small>' +
          (ov && ov.newWord ? ' <span class="sys-term-badge">→ ' + esc(ov.newWord) + '</span>' : '') + '</button>';
      }).join('');
      return;
    }
    box.innerHTML = treeData.map(function (n) { return renderTreeNode(n, 0); }).join('');
  };

  window.sysTermSelectNode = function (nodeId) {
    selectedNodeId = nodeId;
    var node = findNodeById(nodeId);
    if (!node) {
      MODULE_ROOTS.forEach(function (root) {
        if (!node) {
          scanModule(root).forEach(function walk(n) {
            if (n.id === nodeId) node = n;
            (n.children || []).forEach(walk);
          });
        }
      });
    }
    if (!node && nodeId.indexOf('term-') === 0) {
      node = COMMON_TERMS.filter(function (t) { return t.id === nodeId; }).map(function (t) {
        return { id: t.id, label: t.label, oldWord: t.defaultText, defaultText: t.defaultText, scope: t.scope, path: 'عام اصطلاحات › ' + t.label, leaf: true, type: 'term' };
      })[0];
    }
    if (!node) return;
    var entry = getDictEntry(nodeId);
    var pathEl = document.getElementById('sys-term-path');
    var curEl = document.getElementById('sys-term-current');
    var newEl = document.getElementById('sys-term-new');
    var typeEl = document.getElementById('sys-term-type');
    if (pathEl) pathEl.textContent = node.path || node.label;
    if (curEl) curEl.value = node.oldWord || node.defaultText || node.label;
    if (newEl) newEl.value = (entry && entry.newWord) ? entry.newWord : '';
    if (typeEl) typeEl.textContent = node.type === 'tab' ? 'ٹیب / مینو' : (node.type === 'label' ? 'لیبل / عنوان' : 'عام اصطلاح');
    var editor = document.getElementById('sys-term-editor');
    var hint = document.getElementById('sys-term-editor-hint');
    if (editor) editor.style.display = 'block';
    if (hint) hint.style.display = 'none';
    window.sysTermRenderTree();
  };

  window.sysTermSaveSelected = function () {
    if (!selectedNodeId) return toast('درخت سے کوئی اصطلاح منتخب کریں', 'error');
    var node = null;
    MODULE_ROOTS.forEach(function (root) {
      scanModule(root).forEach(function walk(n) {
        if (n.id === selectedNodeId) node = n;
        (n.children || []).forEach(walk);
      });
    });
    if (!node) {
      node = COMMON_TERMS.filter(function (t) { return t.id === selectedNodeId; }).map(function (t) {
        return { id: t.id, label: t.label, oldWord: t.defaultText, scope: t.scope, path: 'عام اصطلاحات › ' + t.label, type: 'term' };
      })[0];
    }
    if (!node) return;
    var newWord = (document.getElementById('sys-term-new') || {}).value.trim();
    var oldWord = node.oldWord || node.defaultText || node.label;
    var dict = readDict();
    var idx = dict.findIndex(function (d) { return d.nodeId === selectedNodeId; });
    var before = idx >= 0 ? dict[idx] : null;
    if (!newWord || newWord === oldWord) {
      if (idx >= 0) dict.splice(idx, 1);
      writeDict(dict);
      if (typeof window.sysAuditLog === 'function') window.sysAuditLog('delete', 'terminology', oldWord);
      toast('اصطلاح بحال (اصل نام)', 'warning');
    } else {
      var entry = {
        id: (before && before.id) || ('DICT-' + Date.now()),
        nodeId: selectedNodeId,
        path: node.path,
        scope: node.scope,
        scopeName: getScopeName(node.scope),
        oldWord: oldWord,
        newWord: newWord,
        type: node.type || 'label',
        domHint: node.domHint || null
      };
      if (idx >= 0) dict[idx] = entry; else dict.push(entry);
      writeDict(dict);
      if (typeof window.sysAuditLog === 'function') window.sysAuditLog('update', 'terminology', oldWord + ' → ' + newWord, before, entry);
      toast('محفوظ — فوراً لاگو', 'success');
    }
    if (typeof window.applyCustomDictionary === 'function') window.applyCustomDictionary();
    if (typeof window.renderDictionaryTable === 'function') window.renderDictionaryTable();
    window.sysTermRenderTree();
  };

  window.sysTermResetSelected = function () {
    var newEl = document.getElementById('sys-term-new');
    if (newEl) newEl.value = '';
    window.sysTermSaveSelected();
  };

  window.sysTermApplyPrecise = function () {
    var dict = readDict();
    dict.forEach(function (item) {
      if (!item.newWord) return;
      if (item.nodeId) {
        var els = document.querySelectorAll('[data-ems-term-id="' + item.nodeId + '"]');
        if (els.length) {
          els.forEach(function (el) { applyTextToElement(el, item.oldWord, item.newWord); });
          return;
        }
        if (item.domHint) {
          var el2 = resolveElement(item.domHint);
          if (el2) {
            el2.setAttribute('data-ems-term-id', item.nodeId);
            applyTextToElement(el2, item.oldWord, item.newWord);
            return;
          }
        }
      }
    });
  };

  function applyTextToElement(el, oldWord, newWord) {
    if (!el || !newWord) return;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      if (el.placeholder && el.placeholder.indexOf(oldWord) !== -1) el.placeholder = el.placeholder.split(oldWord).join(newWord);
      return;
    }
    if (el.querySelector('i')) {
      var icons = el.querySelectorAll('i');
      var clone = el.cloneNode(true);
      clone.querySelectorAll('i').forEach(function (n) { n.remove(); });
      var txt = clone.textContent.replace(/\s+/g, ' ').trim();
      if (txt === oldWord || txt.indexOf(oldWord) !== -1) {
        var iconHtml = '';
        icons.forEach(function (ic) { iconHtml += ic.outerHTML; });
        el.innerHTML = iconHtml + ' ' + newWord;
      }
      return;
    }
    if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
      el.textContent = newWord;
    } else {
      el.textContent = el.textContent.split(oldWord).join(newWord);
    }
  }

  window.sysTermRetagFromDict = function () {
    readDict().forEach(function (item) {
      if (!item.nodeId || !item.domHint) return;
      var el = resolveElement(item.domHint);
      if (el) el.setAttribute('data-ems-term-id', item.nodeId);
    });
  };

  window.sysTermInitTree = function () {
    scanCache = {};
    if (!expanded['root-common']) expanded['root-common'] = true;
    window.sysTermRenderTree();
    window.sysTermRetagFromDict();
  };

  window.sysTermToggleFolder = function (id) {
    expanded[id] = !expanded[id];
    if (expanded[id]) scanCache = {};
    window.sysTermRenderTree();
  };

  window.renderDictionaryTable = function () {
    var tbody = document.getElementById('sys-dict-tbody');
    if (!tbody) return;
    var dict = readDict();
    var thead = document.querySelector('#sys-dict-table thead tr');
    if (thead) thead.innerHTML = '<th>راستہ / شعبہ</th><th>اصل</th><th>نیا نام</th><th style="width:50px;">حذف</th>';
    if (!dict.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">کوئی تبدیلی نہیں</td></tr>';
      return;
    }
    tbody.innerHTML = dict.map(function (item) {
      return '<tr><td style="font-size:11px;color:#64748b;">' + esc(item.path || item.scopeName || getScopeName(item.scope)) +
        '</td><td style="color:var(--danger);font-weight:bold;">' + esc(item.oldWord) +
        '</td><td style="color:var(--success);font-weight:bold;">' + esc(item.newWord) +
        '</td><td><button class="icon-btn delete" onclick="window.deleteDictWord(\'' + esc(item.id) + '\')"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
  };

  window.deleteDictWord = function (id) {
    var dict = readDict().filter(function (item) { return item.id !== id; });
    writeDict(dict);
    window.renderDictionaryTable();
    if (typeof window.applyCustomDictionary === 'function') window.applyCustomDictionary();
    toast('لفظ ہٹا دیا گیا', 'warning');
  };

  document.addEventListener('click', function (e) {
    var toggle = e.target && e.target.closest('.sys-term-toggle');
    if (toggle) {
      e.preventDefault();
      window.sysTermToggleFolder(toggle.getAttribute('data-id'));
      return;
    }
    var lbl = e.target && e.target.closest('.sys-term-label, .sys-term-search-hit');
    if (lbl) {
      e.preventDefault();
      var nid = lbl.getAttribute('data-id');
      if (lbl.classList.contains('sys-term-label') && nid && nid.indexOf('root-') === 0 && !lbl.classList.contains('leaf')) {
        window.sysTermToggleFolder(nid);
        return;
      }
      window.sysTermSelectNode(nid);
      return;
    }
    if (e.target && e.target.closest('#sys-term-btn-save')) {
      e.preventDefault();
      window.sysTermSaveSelected();
    }
    if (e.target && e.target.closest('#sys-term-btn-reset')) {
      e.preventDefault();
      window.sysTermResetSelected();
    }
    if (e.target && e.target.closest('#btn-add-dict-word')) {
      var scope = document.getElementById('dict-scope').value;
      var oldWord = document.getElementById('dict-old-word').value.trim();
      var newWord = document.getElementById('dict-new-word').value.trim();
      if (!oldWord || !newWord) { toast('پرانا اور نیا نام لکھیں', 'error'); return; }
      var dict = readDict();
      var idx = dict.findIndex(function (d) { return d.oldWord === oldWord && d.scope === scope && !d.nodeId; });
      var entry = {
        id: 'DICT-' + Date.now(),
        scope: scope,
        scopeName: getScopeName(scope),
        oldWord: oldWord,
        newWord: newWord,
        path: getScopeName(scope) + ' (فوری)',
        type: 'manual'
      };
      if (idx >= 0) dict[idx] = Object.assign(dict[idx], entry);
      else dict.push(entry);
      writeDict(dict);
      document.getElementById('dict-old-word').value = '';
      document.getElementById('dict-new-word').value = '';
      window.renderDictionaryTable();
      if (typeof window.applyCustomDictionary === 'function') window.applyCustomDictionary();
      if (typeof window.sysAuditLog === 'function') window.sysAuditLog('create', 'terminology', oldWord + ' → ' + newWord);
      toast('فوری تبدیلی شامل', 'success');
      e.stopImmediatePropagation();
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'sys-term-search') {
      clearTimeout(window._sysTermSearchT);
      window._sysTermSearchT = setTimeout(window.sysTermRenderTree, 250);
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () {
      window.sysTermRetagFromDict();
    }, 800);
  });

})();
