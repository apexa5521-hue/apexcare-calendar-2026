// ══════════════════════════════════════════════════════════════════════════
// تقويم عيادات أبكس كير 2026 — Google Apps Script
// Deploy: Web App | Execute as: Me | Who has access: Anyone
// ══════════════════════════════════════════════════════════════════════════

function doGet(e) {
  var p      = (e && e.parameter) ? e.parameter : {};
  var cb     = p.callback || '';
  var result;
  try {
    var action = p.action || '';
    if      (action === 'getAll')   { result = getAllNotes(p);  }
    else if (action === 'save')     { result = saveNote(p);    }
    else if (action === 'delete')   { result = deleteNote(p);  }
    else if (action === 'share')    { result = shareNote(p);   }
    else if (action === 'setStatus'){ result = setStatus(p);   }
    else if (action === 'addReply') { result = addReply(p);    }
    else if (action === 'update')   { result = updateNote(p);  }
    else if (action === 'ping')   { result = { ok:true, msg:'متصل', t:new Date().toISOString() }; }
    else { result = { ok:false, error:'action غير معروف: '+action }; }
  } catch(err) {
    result = { ok:false, error:String(err) };
  }
  var json = JSON.stringify(result);
  if (cb) {
    return ContentService.createTextOutput(cb+'('+json+')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ── الشيت الذي نكتب إليه (الأحدث) ─────────────────────────────────────
function getWriteSheet() {
  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  // فضّل الشيت الموجود فعلياً بالإنتاج (الملاحظات ثم Notes) قبل إنشاء شيت جديد
  var s = ss.getSheetByName('الملاحظات') || ss.getSheetByName('Notes');
  if (!s) {
    s = ss.insertSheet('الملاحظات');
    s.appendRow(['id','date','title','text','link','from_role','to_role','color','shared','status','statusTs','replies','editLog','ts']);
    s.setFrozenRows(1);
    var h = s.getRange(1,1,1,13);
    h.setBackground('#1e293b'); h.setFontColor('#fff');
    h.setFontWeight('bold'); h.setHorizontalAlignment('center');
    s.setColumnWidths(1,13,[150,100,180,280,200,120,120,80,80,80,160,220,160]);
  } else {
    ensureTitleColumn(s);
    ensureLinkCol(s);
    ensureStatusReplyCols(s);
  }
  return s;
}

// ── اقرأ من كل الشيتات التي تحتوي بيانات ────────────────────────────────
// هذا يحل مشكلة البيانات في Notes بينما الكود يكتب في الملاحظات
function getAllSheets() {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var names   = ['الملاحظات','Notes','CalendarEvents'];
  var sheets  = [];
  var seen    = {};
  for (var i=0; i<names.length; i++) {
    var s = ss.getSheetByName(names[i]);
    if (s && !seen[s.getSheetId()]) {
      seen[s.getSheetId()] = true;
      sheets.push(s);
    }
  }
  return sheets;
}

// ── تنسيق التاريخ دائماً YYYY-MM-DD ────────────────────────────────────────
function fmtDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    var y  = val.getFullYear();
    var mo = String(val.getMonth()+1).padStart(2,'0');
    var dy = String(val.getDate()).padStart(2,'0');
    return y+'-'+mo+'-'+dy;
  }
  var s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // صيغة صحيحة
  try {
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      var y2  = d.getFullYear();
      var mo2 = String(d.getMonth()+1).padStart(2,'0');
      var dy2 = String(d.getDate()).padStart(2,'0');
      return y2+'-'+mo2+'-'+dy2;
    }
  } catch(e) {}
  return s;
}

// ── قراءة خلية بأمان ─────────────────────────────────────────────────────
function g(row, col) {
  if (col < 0 || col >= row.length) return '';
  return String(row[col] || '');
}

// ── تحديد أرقام الأعمدة ─────────────────────────────────────────────────
function getColMap(headers) {
  var map = {id:-1,date:-1,title:-1,text:-1,link:-1,from_role:-1,to_role:-1,color:-1,shared:-1,status:-1,statusTs:-1,replies:-1,editLog:-1,ts:-1};
  for (var i=0; i<headers.length; i++) {
    var h = String(headers[i]).toLowerCase().trim();
    if (h==='id'   || h==='المعرف')                          map.id        = i;
    if (h==='date' || h==='التاريخ')                         map.date      = i;
    if (h==='text' || h==='نص' || h==='نص الملاحظة')        map.text      = i;
    if (h==='title'|| h==='عنوان'|| h==='العنوان')          map.title     = i;
    if (h==='link' || h==='رابط')                            map.link      = i;
    if (h==='from_role'||h==='المرسل'||h==='المرسِل')       map.from_role = i;
    if (h==='to_role'  ||h==='المستقبل'||h==='المستقبِل')   map.to_role   = i;
    if (h==='color'||h==='اللون')                            map.color     = i;
    if (h==='shared'||h==='مشترك'||h==='مشترك (للجميع)')   map.shared    = i;
    if (h==='status'||h==='الحالة')                          map.status    = i;
    if (h==='statusts'||h==='وقت الحالة')                   map.statusTs  = i;
    if (h==='replies'||h==='الردود')                         map.replies   = i;
    if (h==='editlog'||h==='سجل التعديلات')                  map.editLog   = i;
    if (h==='ts'||h==='وقت الإنشاء'||h==='timestamp')       map.ts        = i;
  }
  return map;
}

// ── جلب كل الملاحظات من كل الشيتات ─────────────────────────────────────
function getAllNotes(p) {
  var viewer  = (p && p.viewer) ? p.viewer : 'general';
  var sheets  = getAllSheets();
  var allNotes = {};  // نستخدم id كمفتاح لتجنب التكرار
  var sheetNames = [];

  for (var s=0; s<sheets.length; s++) {
    var sheet = sheets[s];
    var data  = sheet.getDataRange().getValues();
    if (data.length <= 1) continue;

    sheetNames.push(sheet.getName() + '(' + (data.length-1) + ')');
    var cm = getColMap(data[0]);

    for (var r=1; r<data.length; r++) {
      var row = data[r];
      var id  = g(row, cm.id);
      if (!id || allNotes[id]) continue;  // تجاهل الفارغ والمكرر

      var rawDate = (cm.date >= 0 && cm.date < row.length) ? row[cm.date] : '';
      var fmtDate = '';
      if (rawDate instanceof Date) {
        // Date object — حوّله لـ YYYY-MM-DD
        var yr = rawDate.getFullYear();
        var mo = String(rawDate.getMonth()+1).padStart(2,'0');
        var dy = String(rawDate.getDate()).padStart(2,'0');
        fmtDate = yr + '-' + mo + '-' + dy;
      } else {
        fmtDate = String(rawDate || '').trim();
        // إذا كانت صيغة Date string — حوّلها
        if (fmtDate && !/^\d{4}-\d{2}-\d{2}$/.test(fmtDate)) {
          try {
            var d2 = new Date(fmtDate);
            if (!isNaN(d2.getTime())) {
              var yr2 = d2.getFullYear();
              var mo2 = String(d2.getMonth()+1).padStart(2,'0');
              var dy2 = String(d2.getDate()).padStart(2,'0');
              fmtDate = yr2 + '-' + mo2 + '-' + dy2;
            }
          } catch(ex) {}
        }
      }
      var repliesRaw = g(row, cm.replies);
      var repliesArr = [];
      if (repliesRaw) {
        try { repliesArr = JSON.parse(repliesRaw); } catch(pe) { repliesArr = []; }
      }
      var editLogRaw = g(row, cm.editLog);
      var editLogArr = [];
      if (editLogRaw) {
        try { editLogArr = JSON.parse(editLogRaw); } catch(pe2) { editLogArr = []; }
      }
      var n = {
        id:        id,
        date:      fmtDate,
        title:     g(row, cm.title),
        text:      g(row, cm.text),
        link:      g(row, cm.link),
        from_role: g(row, cm.from_role) || 'general',
        to_role:   g(row, cm.to_role)   || 'all',
        color:     g(row, cm.color)     || '#f59e0b',
        shared:    g(row, cm.shared)    || 'no',
        status:    g(row, cm.status)    || 'new',
        statusTs:  g(row, cm.statusTs)  || g(row, cm.ts),
        replies:   repliesArr,
        editLog:   editLogArr,
        ts:        g(row, cm.ts)
      };

      if (!n.date || !n.text) continue;

      // فلترة الصلاحية
      var show = false;
      if (viewer === 'ceo')            { show = true; }
      else if (n.from_role === viewer) { show = true; }
      else if (n.to_role   === viewer) { show = true; }
      else if (n.to_role   === 'all')  { show = true; }
      else if (n.shared    === 'yes')  { show = true; }

      if (show) allNotes[id] = n;
    }
  }

  var notes = Object.values(allNotes);
  return {
    ok: true,
    notes: notes,
    count: notes.length,
    sheets: sheetNames.join(', ')
  };
}

// ── تأكد من وجود عمود link ───────────────────────────────────────────────
function ensureTitleColumn(sheet) {
  if (!sheet) return;
  var lc = sheet.getLastColumn();
  if (lc < 1) return;
  var h2 = sheet.getRange(1,1,1,lc).getValues()[0];
  for (var i=0; i<h2.length; i++) {
    if (String(h2[i]).toLowerCase().trim()==='title') return;
  }
  sheet.insertColumnAfter(2);
  var c = sheet.getRange(1,3);
  c.setValue('title'); c.setBackground('#1e3a5f');
  c.setFontColor('#fff'); c.setFontWeight('bold');
  sheet.setColumnWidth(3,180);
  Logger.log(report.join(', '));
}

function ensureLinkCol(sheet) {
  if (!sheet) return;
  var lc = sheet.getLastColumn();
  if (lc < 1) return;
  var headers = sheet.getRange(1,1,1,lc).getValues()[0];
  for (var i=0; i<headers.length; i++) {
    if (String(headers[i]).toLowerCase().trim() === 'link') return;
  }
  // أضف بعد text
  var after = 3;
  for (var j=0; j<headers.length; j++) {
    var h = String(headers[j]).toLowerCase().trim();
    if (h==='text'||h==='نص'||h==='نص الملاحظة') { after=j+1; break; }
  }
  sheet.insertColumnAfter(after);
  var nc = after+1;
  var c  = sheet.getRange(1,nc);
  c.setValue('link');
  c.setBackground('#0f766e'); c.setFontColor('#fff');
  c.setFontWeight('bold'); c.setHorizontalAlignment('center');
  sheet.setColumnWidth(nc, 220);
}

// ── تشغيل يدوي لإضافة عمود link ─────────────────────────────────────────
function addLinkColumn() {
  var sheets = getAllSheets();
  for (var i=0; i<sheets.length; i++) ensureLinkCol(sheets[i]);
  Browser.msgBox('نتيجة الإعداد:\n\n' + report.join('\n'));
}

// ── تأكد من وجود أعمدة status / statusTs / replies ───────────────────────
function ensureStatusReplyCols(sheet) {
  if (!sheet) return;
  var need = [
    {key:'status',   label:'status',   color:'#1e293b', width:80},
    {key:'statusTs', label:'statusTs', color:'#1e293b', width:160},
    {key:'replies',  label:'replies',  color:'#0f766e', width:220},
    {key:'editLog',  label:'editLog',  color:'#0f766e', width:220}
  ];
  for (var n=0; n<need.length; n++) {
    var lc = sheet.getLastColumn();
    var headers = lc>0 ? sheet.getRange(1,1,1,lc).getValues()[0] : [];
    var found = false;
    for (var i=0; i<headers.length; i++) {
      if (String(headers[i]).toLowerCase().trim() === need[n].key.toLowerCase()) { found = true; break; }
    }
    if (!found) {
      var newCol = sheet.getLastColumn() + 1;
      var c = sheet.getRange(1, newCol);
      c.setValue(need[n].label);
      c.setBackground(need[n].color); c.setFontColor('#fff');
      c.setFontWeight('bold'); c.setHorizontalAlignment('center');
      sheet.setColumnWidth(newCol, need[n].width);
    }
  }
}

// ── حفظ ملاحظة ──────────────────────────────────────────────────────────
function saveNote(p) {
  if (!p || !p.id || !p.date || !p.text)
    return { ok:false, error:'id, date, text مطلوبة' };

  // تحقق من التكرار في كل الشيتات
  var sheets = getAllSheets();
  for (var s=0; s<sheets.length; s++) {
    var data = sheets[s].getDataRange().getValues();
    var cm   = getColMap(data[0]);
    for (var i=1; i<data.length; i++) {
      if (g(data[i],cm.id) === String(p.id))
        return { ok:true, msg:'موجودة مسبقاً', id:p.id };
    }
  }

  // احفظ في شيت الكتابة
  var sheet = getWriteSheet();
  var data  = sheet.getDataRange().getValues();
  var cm    = getColMap(data[0]);
  var lc    = sheet.getLastColumn();
  var row   = [];
  for (var c=0; c<lc; c++) row.push('');

  var ts = new Date().toLocaleString('ar-SA', {timeZone:'Asia/Riyadh'});
  if (cm.id        >= 0) row[cm.id]        = p.id;
  if (cm.date      >= 0) row[cm.date]      = p.date;
  if (cm.text      >= 0) row[cm.text]      = p.text;
  if (cm.title     >= 0) row[cm.title]     = p.title     || '';
  if (cm.link      >= 0) row[cm.link]      = p.link      || '';
  if (cm.from_role >= 0) row[cm.from_role] = p.from_role || 'general';
  if (cm.to_role   >= 0) row[cm.to_role]   = p.to_role   || 'all';
  if (cm.color     >= 0) row[cm.color]     = p.color     || '#f59e0b';
  if (cm.shared    >= 0) row[cm.shared]    = p.shared    || 'no';
  if (cm.status    >= 0) row[cm.status]    = p.status    || 'new';
  if (cm.statusTs  >= 0) row[cm.statusTs]  = ts;
  if (cm.replies   >= 0) row[cm.replies]   = '[]';
  if (cm.editLog   >= 0) row[cm.editLog]   = '[]';
  if (cm.ts        >= 0) row[cm.ts]        = ts;

  sheet.appendRow(row);

  var rowColors = {ceo:'#fee2e2',marketing:'#ede9fe',hr:'#dcfce7',ops:'#ffedd5',quality:'#e0f2fe',general:'#f8fafc'};
  sheet.getRange(sheet.getLastRow(),1,1,lc).setBackground(rowColors[p.from_role]||'#fff');

  if (p.link && cm.link >= 0) {
    try {
      sheet.getRange(sheet.getLastRow(), cm.link+1)
        .setFormula('=HYPERLINK("'+p.link+'","'+(p.link.length>35?p.link.slice(0,35)+'...':p.link)+'")');
    } catch(e) {
      sheet.getRange(sheet.getLastRow(), cm.link+1).setValue(p.link);
    }
  }

  return { ok:true, id:p.id };
}

// ── حذف ملاحظة ──────────────────────────────────────────────────────────
function deleteNote(p) {
  if (!p || !p.id) return { ok:false, error:'id مطلوب' };
  var sheets = getAllSheets();
  for (var s=0; s<sheets.length; s++) {
    var data = sheets[s].getDataRange().getValues();
    var cm   = getColMap(data[0]);
    for (var i=data.length-1; i>=1; i--) {
      if (g(data[i],cm.id) === String(p.id)) {
        sheets[s].deleteRow(i+1);
        return { ok:true };
      }
    }
  }
  return { ok:true, msg:'لم تُعثر على الملاحظة' };
}

// ── مشاركة ملاحظة ───────────────────────────────────────────────────────
function shareNote(p) {
  if (!p || !p.id) return { ok:false, error:'id مطلوب' };
  var sheets = getAllSheets();
  for (var s=0; s<sheets.length; s++) {
    var data = sheets[s].getDataRange().getValues();
    var cm   = getColMap(data[0]);
    if (cm.shared < 0) continue;
    for (var i=data.length-1; i>=1; i--) {
      if (g(data[i],cm.id) === String(p.id)) {
        sheets[s].getRange(i+1, cm.shared+1).setValue('yes');
        return { ok:true };
      }
    }
  }
  return { ok:false, error:'ملاحظة غير موجودة: '+p.id };
}

// ── تغيير حالة ملاحظة ──────────────────────────────────────────────────
function setStatus(p) {
  if (!p || !p.id || !p.status) return { ok:false, error:'id, status مطلوبة' };
  var sheets = getAllSheets();
  var ts = new Date().toLocaleString('ar-SA', {timeZone:'Asia/Riyadh'});
  for (var s=0; s<sheets.length; s++) {
    var data = sheets[s].getDataRange().getValues();
    var cm   = getColMap(data[0]);
    if (cm.status < 0) { ensureStatusReplyCols(sheets[s]); data = sheets[s].getDataRange().getValues(); cm = getColMap(data[0]); }
    for (var i=data.length-1; i>=1; i--) {
      if (g(data[i],cm.id) === String(p.id)) {
        sheets[s].getRange(i+1, cm.status+1).setValue(p.status);
        if (cm.statusTs >= 0) sheets[s].getRange(i+1, cm.statusTs+1).setValue(ts);
        return { ok:true };
      }
    }
  }
  return { ok:false, error:'ملاحظة غير موجودة: '+p.id };
}

// ── تعديل ملاحظة موجودة (مع تسجيل التعديل بسجل editLog) ──────────────────
function updateNote(p) {
  if (!p || !p.id) return { ok:false, error:'id مطلوب' };
  var sheets = getAllSheets();
  var ts = new Date().toLocaleString('ar-SA', {timeZone:'Asia/Riyadh'});
  for (var s=0; s<sheets.length; s++) {
    var data = sheets[s].getDataRange().getValues();
    var cm   = getColMap(data[0]);
    if (cm.editLog < 0) { ensureStatusReplyCols(sheets[s]); data = sheets[s].getDataRange().getValues(); cm = getColMap(data[0]); }
    for (var i=data.length-1; i>=1; i--) {
      if (g(data[i],cm.id) === String(p.id)) {
        var row = i+1;
        if (cm.date     >= 0 && p.date     !== undefined) sheets[s].getRange(row, cm.date+1).setValue(p.date);
        if (cm.title    >= 0 && p.title    !== undefined) sheets[s].getRange(row, cm.title+1).setValue(p.title);
        if (cm.text     >= 0 && p.text     !== undefined) sheets[s].getRange(row, cm.text+1).setValue(p.text);
        if (cm.link     >= 0 && p.link     !== undefined) sheets[s].getRange(row, cm.link+1).setValue(p.link);
        if (cm.to_role  >= 0 && p.to_role  !== undefined) sheets[s].getRange(row, cm.to_role+1).setValue(p.to_role);
        if (cm.color    >= 0 && p.color    !== undefined) sheets[s].getRange(row, cm.color+1).setValue(p.color);

        var existing = [];
        var raw = g(data[i], cm.editLog);
        if (raw) { try { existing = JSON.parse(raw); } catch(pe) { existing = []; } }
        existing.push({by:p.edited_by||'general', ts:new Date().toISOString(), summary:p.summary||'تعديل'});
        if (cm.editLog >= 0) sheets[s].getRange(row, cm.editLog+1).setValue(JSON.stringify(existing));

        return { ok:true, editLog: existing };
      }
    }
  }
  return { ok:false, error:'ملاحظة غير موجودة: '+p.id };
}

// ── إضافة رد على ملاحظة (Thread) ─────────────────────────────────────────
function addReply(p) {
  if (!p || !p.id || !p.reply) return { ok:false, error:'id, reply مطلوبة' };
  var sheets = getAllSheets();
  for (var s=0; s<sheets.length; s++) {
    var data = sheets[s].getDataRange().getValues();
    var cm   = getColMap(data[0]);
    if (cm.replies < 0) { ensureStatusReplyCols(sheets[s]); data = sheets[s].getDataRange().getValues(); cm = getColMap(data[0]); }
    for (var i=data.length-1; i>=1; i--) {
      if (g(data[i],cm.id) === String(p.id)) {
        var existing = [];
        var raw = g(data[i], cm.replies);
        if (raw) { try { existing = JSON.parse(raw); } catch(pe) { existing = []; } }
        var newReply;
        try { newReply = JSON.parse(p.reply); } catch(pe2) { newReply = {from_role:p.from_role||'general', text:String(p.reply), ts:new Date().toISOString()}; }
        existing.push(newReply);
        sheets[s].getRange(i+1, cm.replies+1).setValue(JSON.stringify(existing));
        return { ok:true, replies: existing };
      }
    }
  }
  return { ok:false, error:'ملاحظة غير موجودة: '+p.id };
}

// ══════════════════════════════════════════════════════════════════════════
// شغّل هذه الدالة مرة واحدة فقط لإعداد كل الأعمدة المطلوبة
// كيف: اختر setupAllColumns من القائمة ← اضغط Run
// ══════════════════════════════════════════════════════════════════════════
function setupAllColumns() {
  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var names  = ['الملاحظات', 'Notes', 'CalendarEvents'];
  var sheets = [];
  
  for (var i = 0; i < names.length; i++) {
    var s = ss.getSheetByName(names[i]);
    if (s) sheets.push(s);
  }
  
  if (!sheets.length) {
    // أنشئ شيت جديد إذا ما في شيء
    var s = ss.insertSheet('الملاحظات');
    sheets.push(s);
  }
  
  var report = [];
  
  for (var si = 0; si < sheets.length; si++) {
    var sheet = sheets[si];
    var name  = sheet.getName();
    var lc    = sheet.getLastColumn();
    
    // الأعمدة المطلوبة بالترتيب
    var required = ['id','date','title','text','link','from_role','to_role','color','shared','status','statusTs','replies','editLog','ts'];
    
    // اقرأ الرأس الحالي
    var currentHeaders = [];
    if (lc > 0) {
      currentHeaders = sheet.getRange(1,1,1,lc).getValues()[0].map(function(h){
        return String(h).toLowerCase().trim();
      });
    } else {
      // شيت فارغ — أنشئ رأس كامل
      sheet.appendRow(['id','date','title','text','link','from_role','to_role','color','shared','status','statusTs','replies','editLog','ts']);
      sheet.setFrozenRows(1);
      var hdr = sheet.getRange(1,1,1,13);
      hdr.setBackground('#1e293b');
      hdr.setFontColor('#ffffff');
      hdr.setFontWeight('bold');
      hdr.setHorizontalAlignment('center');
      sheet.setColumnWidths(1,13,[150,100,180,280,200,120,120,80,80,80,160,220,160]);
      report.push(name + ': تم إنشاء رأس الجدول كاملاً');
      continue;
    }
    
    var added = [];
    
    // تحقق من كل عمود مطلوب وأضفه إذا غير موجود
    for (var ci = 0; ci < required.length; ci++) {
      var col = required[ci];
      var found = false;
      for (var hi = 0; hi < currentHeaders.length; hi++) {
        if (currentHeaders[hi] === col || 
            currentHeaders[hi] === colArabic(col)) {
          found = true; break;
        }
      }
      
      if (!found) {
        // أضف العمود في نهاية الجدول
        var newCol = sheet.getLastColumn() + 1;
        var cell   = sheet.getRange(1, newCol);
        cell.setValue(col);
        cell.setBackground(colColor(col));
        cell.setFontColor('#ffffff');
        cell.setFontWeight('bold');
        cell.setHorizontalAlignment('center');
        sheet.setColumnWidth(newCol, colWidth(col));
        added.push(col);
        // حدّث currentHeaders
        currentHeaders.push(col);
      }
    }
    
    if (added.length) {
      report.push(name + ': تم إضافة → ' + added.join(', '));
    } else {
      report.push(name + ': كل الأعمدة موجودة ✓');
    }
  }
  
  Browser.msgBox('نتيجة الإعداد:\n\n' + report.join('\n'));
  Logger.log(report.join(', '));
}

// ترجمة اسم العمود للعربي للمقارنة
function colArabic(col) {
  var map = {
    'id':'المعرف', 'date':'التاريخ', 'title':'العنوان',
    'text':'نص الملاحظة', 'link':'رابط',
    'from_role':'المرسل', 'to_role':'المستقبل',
    'color':'اللون', 'shared':'مشترك',
    'status':'الحالة', 'statusTs':'وقت الحالة', 'replies':'الردود', 'editLog':'سجل التعديلات',
    'ts':'وقت الإنشاء'
  };
  return map[col] || col;
}

// لون رأس كل عمود
function colColor(col) {
  var map = {
    'id':'#1e293b', 'date':'#1e293b', 'title':'#1e3a5f',
    'text':'#1e293b', 'link':'#0f766e',
    'from_role':'#1e293b', 'to_role':'#1e293b',
    'color':'#1e293b', 'shared':'#1e293b',
    'status':'#1e293b', 'statusTs':'#1e293b', 'replies':'#0f766e', 'editLog':'#0f766e',
    'ts':'#334155'
  };
  return map[col] || '#1e293b';
}

// عرض كل عمود
function colWidth(col) {
  var map = {
    'id':150, 'date':100, 'title':180, 'text':280,
    'link':200, 'from_role':120, 'to_role':120,
    'color':80, 'shared':80,
    'status':80, 'statusTs':160, 'replies':220, 'editLog':220,
    'ts':160
  };
  return map[col] || 120;
}
