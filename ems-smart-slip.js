// ============================================================================
// EMS Smart Slip System — Phase 6 Sprint 1
// فیس چالان + رسید — برانڈڈ پرنٹ، QR تصدیق، اجتماعی پرنٹ
// ============================================================================
(function (global) {
  'use strict';

  var SETTINGS_KEY = 'ems_slip_settings';
  var TYPE_LABELS = { monthly: 'ماہانہ', admission: 'داخلہ', onetime: 'یک بار' };

  var DEFAULTS = {
    size: 'half-a4',
    copies: 1,
    showQr: true,
    showFooter: true,
    dueNote: 'براہ کرم مقررہ تاریخ تک فیس جمع کروائیں۔'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function fmtRs(n) {
    return 'Rs ' + Number(n || 0).toLocaleString('en-PK');
  }

  function readSettings() {
    try {
      var d = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      if (d && typeof d === 'object') return Object.assign({}, DEFAULTS, d);
    } catch (e) { /* ignore */ }
    return Object.assign({}, DEFAULTS);
  }

  function brandHeader() {
    if (typeof global.attBrandHeaderHTML === 'function') return global.attBrandHeaderHTML();
    return '<div style="text-align:center;border-bottom:2px solid #1e293b;padding-bottom:8px;margin-bottom:10px;"><strong>مدرسہ انتظامیہ</strong></div>';
  }

  function brandFooter() {
    if (typeof global.attSignFooterHTML === 'function') return global.attSignFooterHTML();
    return '';
  }

  function slipStyles(size) {
    var w = size === 'thermal-80' ? '72mm' : '100%';
    var maxW = size === 'thermal-80' ? '72mm' : '480px';
    return (
      '<style>' +
      '@media print{ .ems-slip-page-break{ page-break-after:always; break-after:page; height:0; margin:0; padding:0; border:0; } }' +
      '.ems-slip{ font-family:Arial,sans-serif; direction:rtl; width:' + w + '; max-width:' + maxW + '; margin:0 auto 16px; padding:14px; border:1px dashed #334155; background:#fff; box-sizing:border-box; }' +
      '.ems-slip-title{ text-align:center; font-family:\'Noto Nastaliq Urdu\',serif; font-size:20px; margin:0 0 10px; color:#0f172a; }' +
      '.ems-slip-body{ display:flex; gap:12px; align-items:flex-start; }' +
      '.ems-slip-meta{ flex:1; font-size:13px; line-height:1.65; }' +
      '.ems-slip-meta div{ margin-bottom:4px; }' +
      '.ems-slip-amt{ font-size:18px; font-weight:bold; color:#b45309; margin-top:8px; padding:8px; background:#fffbeb; border-radius:6px; text-align:center; }' +
      '.ems-slip-qr{ flex-shrink:0; width:82px; text-align:center; }' +
      '.ems-slip-qr small{ display:block; font-size:9px; color:#64748b; margin-top:4px; }' +
      '.ems-slip-note{ font-size:11px; color:#64748b; margin-top:10px; padding-top:8px; border-top:1px dotted #cbd5e1; }' +
      '</style>'
    );
  }

  function encodePayload(kind, data) {
    var parts = ['EMS', kind];
    if (kind === 'CH') {
      parts.push(data.id || '', data.studentId || '', data.month || '', String(data.amount || 0));
    } else if (kind === 'RC') {
      parts.push(data.id || '', data.studentId || '', String(data.amount || 0), data.date || '');
    }
    return parts.join('|');
  }

  function qrPlaceholder(text, id) {
    return '<div class="ems-slip-qr"><div class="ems-slip-qr-box" id="' + esc(id) + '" data-qr-text="' + esc(text) + '"></div><small>QR تصدیق</small></div>';
  }

  function buildChallanHTML(bill, finData, opts) {
    opts = opts || {};
    var settings = opts.settings || readSettings();
    var fin = finData || {};
    var typeLabel = TYPE_LABELS[bill.type] || bill.type || 'چالان';
    var qrText = encodePayload('CH', bill);
    var qrId = 'ems-qr-' + (bill.id || '').replace(/[^a-zA-Z0-9]/g, '') + '-' + Math.random().toString(36).slice(2, 5);
    var qrBlock = settings.showQr !== false ? qrPlaceholder(qrText, qrId) : '';

    return (
      '<div class="ems-slip">' +
      brandHeader() +
      '<h3 class="ems-slip-title">فیس چالان — ' + esc(typeLabel) + '</h3>' +
      '<div class="ems-slip-body">' +
      '<div class="ems-slip-meta">' +
      '<div><strong>چالان #:</strong> ' + esc(bill.id) + '</div>' +
      '<div><strong>مہینہ:</strong> ' + esc(bill.month) + '</div>' +
      '<div><strong>طالب علم:</strong> ' + esc(bill.studentName) + '</div>' +
      '<div><strong>آئی ڈی:</strong> ' + esc(bill.studentId) + '</div>' +
      '<div><strong>درجہ:</strong> ' + esc(bill.class || '—') + '</div>' +
      '<div class="ems-slip-amt">اس چالان: ' + fmtRs(bill.amount) + '</div>' +
      (fin.arrears != null ? '<div><strong>کل بقایا:</strong> <span style="color:#dc2626;">' + fmtRs(Math.max(0, fin.arrears)) + '</span></div>' : '') +
      '</div>' +
      qrBlock +
      '</div>' +
      (settings.dueNote ? '<div class="ems-slip-note">' + esc(settings.dueNote) + '</div>' : '') +
      (settings.showFooter !== false ? brandFooter() : '') +
      '</div>'
    );
  }

  function buildReceiptHTML(rec, finData, opts) {
    opts = opts || {};
    var settings = opts.settings || readSettings();
    var fin = finData || {};
    var qrText = encodePayload('RC', rec);
    var qrId = 'ems-qr-rc-' + (rec.id || '').replace(/[^a-zA-Z0-9]/g, '') + '-' + Math.random().toString(36).slice(2, 5);
    var qrBlock = settings.showQr !== false ? qrPlaceholder(qrText, qrId) : '';

    return (
      '<div class="ems-slip">' +
      brandHeader() +
      '<h3 class="ems-slip-title">رسید وصولی فیس</h3>' +
      '<div class="ems-slip-body">' +
      '<div class="ems-slip-meta">' +
      '<div><strong>رسید #:</strong> ' + esc(rec.id) + '</div>' +
      '<div><strong>تاریخ:</strong> ' + esc(rec.date) + (rec.time ? ' ' + esc(rec.time) : '') + '</div>' +
      '<div><strong>طالب علم:</strong> ' + esc(rec.studentName) + '</div>' +
      '<div><strong>درجہ:</strong> ' + esc(rec.class) + '</div>' +
      '<div><strong>آئی ڈی:</strong> ' + esc(rec.studentId) + '</div>' +
      '<div><strong>ادائیگی:</strong> ' + esc(rec.paymentType || 'مکمل') + '</div>' +
      '<div><strong>وصول کنندہ:</strong> ' + esc(rec.collectedBy || 'عملہ') + '</div>' +
      '<div class="ems-slip-amt" style="color:#16a34a;background:#f0fdf4;">وصول: ' + fmtRs(rec.amount) + '</div>' +
      (fin.remaining != null ? '<div><strong>بقایا:</strong> ' + fmtRs(Math.max(0, fin.remaining)) + '</div>' : '') +
      '</div>' +
      qrBlock +
      '</div>' +
      (settings.showFooter !== false ? brandFooter() : '') +
      '</div>'
    );
  }

  function injectQrCodes(rootEl) {
    if (!rootEl || !global.QRCode) return;
    rootEl.querySelectorAll('[data-qr-text]').forEach(function (box) {
      var text = box.getAttribute('data-qr-text');
      if (!text) return;
      box.innerHTML = '';
      try {
        new global.QRCode(box, {
          text: text,
          width: 76,
          height: 76,
          colorDark: '#0f172a',
          colorLight: '#ffffff',
          correctLevel: global.QRCode.CorrectLevel.M
        });
      } catch (e) { /* ignore */ }
    });
  }

  function printHtml(html, title) {
    var settings = readSettings();
    var wrap = document.createElement('div');
    wrap.id = 'ems-slip-print-wrap';
    wrap.style.cssText = 'background:#fff;padding:8px;';
    wrap.innerHTML = slipStyles(settings.size) + html;
    document.body.appendChild(wrap);
    injectQrCodes(wrap);
    if (typeof global.printDiv === 'function') {
      global.printDiv('ems-slip-print-wrap');
    } else {
      window.print();
    }
    setTimeout(function () {
      var t = document.getElementById('ems-slip-print-wrap');
      if (t) t.remove();
    }, 300);
  }

  function toast(msg, type) {
    if (typeof global.showToast === 'function') global.showToast(msg, type || 'success');
  }

  global.emsSlipGetSettings = readSettings;

  global.emsSlipSaveSettings = function (patch) {
    var next = Object.assign({}, readSettings(), patch || {});
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
    return next;
  };

  global.emsSlipEncodePayload = encodePayload;
  global.emsSlipBuildChallanHTML = buildChallanHTML;
  global.emsSlipBuildReceiptHTML = buildReceiptHTML;

  global.emsSlipPrintChallan = function (billId) {
    if (typeof global.finGetBills !== 'function') return toast('فنانس ماڈیول لوڈ نہیں', 'error');
    var bill = global.finGetBills().find(function (b) { return b.id === billId; });
    if (!bill) return toast('چالان نہیں ملا', 'error');
    var fin = typeof global.finComputeStudent === 'function' ? global.finComputeStudent(bill.studentId) : {};
    var settings = readSettings();
    var copies = Math.max(1, Math.min(3, Number(settings.copies) || 1));
    var html = '';
    for (var i = 0; i < copies; i++) html += buildChallanHTML(bill, fin) + '<div class="ems-slip-page-break"></div>';
    printHtml(html, 'چالان');
  };

  global.emsSlipPrintBatchChallans = function (bills) {
    if (!bills || !bills.length) return toast('پرنٹ کے لیے کوئی چالان نہیں', 'error');
    var settings = readSettings();
    var copies = Math.max(1, Math.min(3, Number(settings.copies) || 1));
    var html = '';
    bills.forEach(function (bill) {
      var fin = typeof global.finComputeStudent === 'function' ? global.finComputeStudent(bill.studentId) : {};
      for (var i = 0; i < copies; i++) {
        html += buildChallanHTML(bill, fin) + '<div class="ems-slip-page-break"></div>';
      }
    });
    printHtml(html, 'چالان');
    toast(bills.length * copies + ' سلپ پرنٹ ہو رہی ہیں', 'success');
  };

  global.emsSlipPrintReceipt = function (rec, finData) {
    if (!rec) return toast('رسید نہیں ملی', 'error');
    printHtml(buildReceiptHTML(rec, finData || {}), 'رسید');
  };

  global.emsSlipEnhanceReceiptDOM = function (rec) {
    if (!rec) return;
    var settings = readSettings();
    var host = document.getElementById('fin-receipt-qr-wrap');
    if (!host) return;
    if (settings.showQr === false) {
      host.style.display = 'none';
      host.innerHTML = '';
      return;
    }
    host.style.display = 'block';
    var qrText = encodePayload('RC', rec);
    host.innerHTML = '<div id="fin-receipt-qr" data-qr-text="' + esc(qrText) + '"></div><small style="display:block;text-align:center;color:#64748b;margin-top:4px;">QR تصدیق</small>';
    injectQrCodes(host);
  };

  global.emsSlipApplySettingsFromUI = function () {
    var sizeEl = document.getElementById('ems-slip-size');
    var copiesEl = document.getElementById('ems-slip-copies');
    var qrEl = document.getElementById('ems-slip-show-qr');
    var footerEl = document.getElementById('ems-slip-show-footer');
    var noteEl = document.getElementById('ems-slip-due-note');
    global.emsSlipSaveSettings({
      size: sizeEl ? sizeEl.value : DEFAULTS.size,
      copies: copiesEl ? Number(copiesEl.value) : DEFAULTS.copies,
      showQr: qrEl ? qrEl.checked : DEFAULTS.showQr,
      showFooter: footerEl ? footerEl.checked : DEFAULTS.showFooter,
      dueNote: noteEl ? noteEl.value : DEFAULTS.dueNote
    });
  };

  global.emsSlipLoadSettingsToUI = function () {
    var s = readSettings();
    var sizeEl = document.getElementById('ems-slip-size');
    var copiesEl = document.getElementById('ems-slip-copies');
    var qrEl = document.getElementById('ems-slip-show-qr');
    var footerEl = document.getElementById('ems-slip-show-footer');
    var noteEl = document.getElementById('ems-slip-due-note');
    if (sizeEl) sizeEl.value = s.size;
    if (copiesEl) copiesEl.value = String(s.copies);
    if (qrEl) qrEl.checked = s.showQr !== false;
    if (footerEl) footerEl.checked = s.showFooter !== false;
    if (noteEl) noteEl.value = s.dueNote || '';
  };

})(typeof window !== 'undefined' ? window : globalThis);
