/**
 * ═══════════════════════════════════════════════════════════════
 *  ApexCare Calendar — Google Apps Script (Code.gs)
 *  يتوافق مع index.html — gasWrite / gasRead / JSONP
 * ═══════════════════════════════════════════════════════════════
 *
 *  خطوات النشر:
 *  1. افتح Google Sheets ثم Extensions → Apps Script
 *  2. الصق هذا الملف بالكامل واحفظ
 *  3. Deploy → New deployment → Web app
 *     • Execute as: Me
 *     • Who has access: Anyone
 *  4. انسخ رابط الـ Web App والصقه في GAS_URL داخل index.html
 *
 *  بنية الشيت (تتشكّل تلقائياً):
 *  Sheet "Notes" — أعمدة:
 *  id | date | text | from_role | to_role | color | shared | ts
 * ═══════════════════════════════════════════════════════════════
 */

/* ── الثوابت ── */
var SHEET_NAME = 'Notes';
var HEADERS    = ['id','date','text','from_role','to_role','color','shared','ts'];

/* ─────────────────────────────────────────────────────────────
   doGet — نقطة الدخول الوحيدة (JSONP)
   يستقبل ?action=getAll|save|delete|share&callback=__r_xxx
───────────────────────────────────────────────────────────── */
function doGet(e) {
  var p        = e.parameter || {};
  var action   = p.action   || '';
  var callback = p.callback || 'callback';
  var result;

  try {
    if      (action === 'getAll') result = actionGetAll(p);
    else if (action === 'save')   result = actionSave(p);
    else if (action === 'delete') result = actionDelete(p);
    else if (action === 'share')  result = actionShare(p);
    else                          result = {ok: false, error: 'unknown action: ' + action};
  } catch (err) {
    result = {ok: false, error: err.message};
    Logger.log('[ERROR] ' + action + ': ' + err.message);
  }

  var json = JSON.stringify(result);
  return ContentService
    .createTextOutput(callback + '(' + json + ')')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/* ─────────────────────────────────────────────────────────────
   getAll — يُرجع الملاحظات المرئية للدور المُرسِل
───────────────────────────────────────────────────────────── */
function actionGetAll(p) {
  var viewer = p.viewer || '';
  var sheet  = getSheet();
  var data   = sheet.getDataRange().getValues();

  if (data.length <= 1) {
    // لا توجد صفوف بيانات بعد الهيدر
    return {ok: true, notes: []};
  }

  var headers = data[0];
  var notes   = [];

  for (var i = 1; i < data.length; i++) {
    var row  = data[i];
    var note = rowToObj(headers, row);

    // تخطى الصفوف الفارغة
    if (!note.id || !note.date || !note.text) continue;

    // فلتر الصلاحية — نفس منطق الـ HTML
    if (canSee(viewer, note)) {
      notes.push(note);
    }
  }

  Logger.log('[getAll] viewer=' + viewer + ' → ' + notes.length + ' notes');
  return {ok: true, notes: notes};
}

/* ─────────────────────────────────────────────────────────────
   save — يضيف أو يُحدِّث ملاحظة
───────────────────────────────────────────────────────────── */
function actionSave(p) {
  var id        = (p.id        || '').trim();
  var date      = (p.date      || '').trim();
  var text      = (p.text      || '').trim();
  var from_role = (p.from_role || '').trim();
  var to_role   = (p.to_role   || 'all').trim();
  var color     = (p.color     || '#f59e0b').trim();
  var shared    = (p.shared    || 'no').trim();

  if (!id || !date || !text) {
    return {ok: false, error: 'missing required fields'};
  }

  var sheet   = getSheet();
  var rowIdx  = findRowById(sheet, id);
  var ts      = new Date().toISOString();

  if (rowIdx > 0) {
    // تحديث صف موجود
    var range = sheet.getRange(rowIdx, 1, 1, HEADERS.length);
    range.setValues([[id, date, text, from_role, to_role, color, shared, ts]]);
    Logger.log('[save] updated id=' + id);
  } else {
    // إضافة صف جديد
    sheet.appendRow([id, date, text, from_role, to_role, color, shared, ts]);
    Logger.log('[save] appended id=' + id);
  }

  return {ok: true, id: id};
}

/* ─────────────────────────────────────────────────────────────
   delete — يحذف ملاحظة بالـ id
───────────────────────────────────────────────────────────── */
function actionDelete(p) {
  var id = (p.id || '').trim();
  if (!id) return {ok: false, error: 'missing id'};

  var sheet  = getSheet();
  var rowIdx = findRowById(sheet, id);

  if (rowIdx > 0) {
    sheet.deleteRow(rowIdx);
    Logger.log('[delete] deleted id=' + id);
    return {ok: true, id: id};
  } else {
    Logger.log('[delete] id not found: ' + id);
    return {ok: false, error: 'not found'};
  }
}

/* ─────────────────────────────────────────────────────────────
   share — يضع shared='yes' على ملاحظة
───────────────────────────────────────────────────────────── */
function actionShare(p) {
  var id = (p.id || '').trim();
  if (!id) return {ok: false, error: 'missing id'};

  var sheet  = getSheet();
  var rowIdx = findRowById(sheet, id);

  if (rowIdx > 0) {
    var sharedCol = HEADERS.indexOf('shared') + 1; // 1-based
    sheet.getRange(rowIdx, sharedCol).setValue('yes');
    Logger.log('[share] shared id=' + id);
    return {ok: true, id: id};
  } else {
    return {ok: false, error: 'not found'};
  }
}

/* ═══════════════════════════════════════════════════════════
   مساعدات
═══════════════════════════════════════════════════════════ */

/**
 * يُحضر الشيت أو يُنشئه إن لم يكن موجوداً.
 */
function getSheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    // أضف صف العناوين
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    // تنسيق الهيدر
    var hRange = sheet.getRange(1, 1, 1, HEADERS.length);
    hRange.setBackground('#0f172a');
    hRange.setFontColor('#3DBDAD');
    hRange.setFontWeight('bold');
    sheet.setFrozenRows(1);
    // عرض الأعمدة
    sheet.setColumnWidth(1,  180); // id
    sheet.setColumnWidth(2,  100); // date
    sheet.setColumnWidth(3,  320); // text
    sheet.setColumnWidth(4,  100); // from_role
    sheet.setColumnWidth(5,  100); // to_role
    sheet.setColumnWidth(6,   80); // color
    sheet.setColumnWidth(7,   70); // shared
    sheet.setColumnWidth(8,  180); // ts
    Logger.log('[setup] sheet "' + SHEET_NAME + '" created with headers');
  }

  return sheet;
}

/**
 * يحوّل صف (array) إلى object باستخدام headers.
 */
function rowToObj(headers, row) {
  var obj = {};
  for (var j = 0; j < headers.length; j++) {
    var val = row[j];
    // حوّل Date إلى ISO string تلقائياً
    if (val instanceof Date) val = val.toISOString();
    obj[headers[j]] = val !== undefined && val !== null ? String(val) : '';
  }
  return obj;
}

/**
 * يبحث عن صف بـ id في العمود الأول.
 * يُرجع رقم الصف (1-based) أو -1 إن لم يجد.
 */
function findRowById(sheet, id) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === id) return i + 1; // +1 لأن getValues 0-based
  }
  return -1;
}

/**
 * منطق الرؤية — يطابق rebuildFromLocal في HTML
 *   ceo (seesAll) يرى كل شيء
 *   غيره يرى: ما أرسله، ما وُجِّه إليه، to_role=all، shared=yes
 */
function canSee(viewer, note) {
  if (!viewer) return false;
  var SEES_ALL = ['ceo']; // أدوار ترى كل شيء
  if (SEES_ALL.indexOf(viewer) !== -1) return true;
  if (note.from_role === viewer) return true;
  if (note.to_role   === viewer) return true;
  if (note.to_role   === 'all')  return true;
  if (note.shared    === 'yes')  return true;
  return false;
}

/* ─────────────────────────────────────────────────────────────
   دالة اختبار يدوي — شغّلها من محرر Apps Script
   لاختبار القراءة كـ CEO
───────────────────────────────────────────────────────────── */
function testGetAll() {
  var result = actionGetAll({viewer: 'ceo'});
  Logger.log(JSON.stringify(result));
}

/* دالة لإضافة ملاحظة تجريبية */
function testSave() {
  var result = actionSave({
    id:        'test_' + Date.now(),
    date:      '2026-05-21',
    text:      'ملاحظة تجريبية من Apps Script',
    from_role: 'ceo',
    to_role:   'all',
    color:     '#f59e0b',
    shared:    'no'
  });
  Logger.log(JSON.stringify(result));
}
