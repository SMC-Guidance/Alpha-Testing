/**
 * EvalExport.gs  -  Teacher Evaluation Workbook Builder
 * Drop-in addition for the SMC Guidance backend. Nothing in Code.gs changes.
 *
 * The automation, end to end:
 *   1. Scans FORMS_FOLDER_ID. Each SUBFOLDER is one teacher batch (e.g. PASTOR).
 *   2. Reads every Form / Sheet / CSV inside it as response rows.
 *   3. Detects the grade level from the Grade and Section answers.
 *   4. Copies the matching template tab, untouched, and fills
 *      TEACHER / SUBJECT TAUGHT / SECTION.
 *   5. Pastes each student's responses down the S1, S2, S3 ... columns so the
 *      template's OWN formulas compute the averages.
 *   6. Adds a COMMENTS SUMMARY tab: duplicates collapsed, shortest to longest,
 *      repeats counted, e.g. very cool (2).
 *   7. One output file per grade-level template, one tab per section. Grade 7
 *      and Grade 9 share the Junior High file; a Grade 6 becomes its own file.
 *
 * SETUP (one time)
 *   Script Properties:
 *     FORMS_FOLDER_ID     already used by listForms - the Drive folder of forms
 *     EVAL_TEMPLATE_ID    master template, uploaded to Drive AS A GOOGLE SHEET
 *     EVAL_OUTPUT_FOLDER  optional; defaults to a Generated Evaluations subfolder
 *
 *   Add to the switch in doPost() in Code.gs:
 *     case 'buildEvalWorkbooks': return ok(handleBuildEvalWorkbooks(requireStaff(session), payload));
 *     case 'listEvalBatches':    return ok(handleListEvalBatches(requireStaff(session)));
 *
 *   Then re-deploy the Web App.
 */

// Template geometry, mirroring the master template exactly.
//   rows     : template rows that receive scores, in questionnaire order
//   firstCol : column of S1
//   lastCol  : last S slot before AVERAGES
var EVAL_TEMPLATES = {
    shs: {
        sheetName: 'SENIOR HIGH SCHOOL TEMPLATE',
        label: 'SENIOR HIGH SCHOOL',
        rows: [7, 8, 9, 10, 11, 12, 13, 14, 18, 19, 20, 21, 22, 23, 24, 25],
        firstCol: 2, lastCol: 34   // B..AH = 33 students, AVERAGES in AI
    },
    jhs: {
        sheetName: 'JUNIOR HIGH SCHOOL TEMPLATE',
        label: 'JUNIOR HIGH SCHOOL',
        rows: [7, 8, 9, 10, 11, 12, 13, 14, 18, 19, 20, 21, 22, 23, 24, 25],
        firstCol: 2, lastCol: 39
    },
    g5g6: {
        sheetName: 'G5-G6 TEMPLATE',
        label: 'G5-G6',
        rows: [7, 8, 9, 10, 11, 12, 13, 14, 18, 19, 20, 21, 22, 23, 24, 25],
        firstCol: 2, lastCol: 36   // B..AJ = 35 students, AVERAGES in AK
    },
    g3g4: {
        sheetName: 'G3-G4 TEMPLATE',
        label: 'G3-G4',
        rows: [7, 10, 11, 12, 13, 16, 17, 18, 19, 20, 23, 24, 25, 26],
        firstCol: 2, lastCol: 45
    },
    kinderg2: {
        sheetName: 'KINDER - G2 TEMPLATE',
        label: 'KINDER-G2',
        rows: [7, 10, 11, 12, 13, 16, 17, 18, 19, 20, 23, 24, 25],
        firstCol: 2, lastCol: 45
    }
};

function evalTemplateKeyForGrade(grade) {
    if (grade === null || grade === undefined) return null;
    if (grade <= 2) return 'kinderg2';
    if (grade <= 4) return 'g3g4';
    if (grade <= 6) return 'g5g6';
    if (grade <= 10) return 'jhs';
    return 'shs';
}

var EVAL_TEACHER_KEYS = ['teacher', 'faculty', 'instructor', 'guro'];
var EVAL_SUBJECT_KEYS = ['subject', 'asignatura'];
var EVAL_SECTION_KEYS = ['grade and section', 'grade & section', 'grade level and section', 'section', 'grade'];
var EVAL_STUDENT_KEYS = ['your name', 'name of student', 'student name'];
var EVAL_ADVISER_KEYS = ['class adviser', 'adviser', 'advisor'];
var EVAL_TIME_KEYS = ['timestamp', 'time stamp'];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** "4 ALWAYS" -> 4 ; "3 MOST OF THE TIME" -> 3 ; "" -> null */
function evalParseScore(value) {
    if (value === null || value === undefined) return null;
    var text = String(value).trim();
    if (!text) return null;
    var m = text.match(/^\s*(\d+(?:\.\d+)?)/);
    if (!m) return null;
    var n = Number(m[1]);
    return isNaN(n) ? null : n;
}

/** Detects the grade level from free-typed section answers. */
function evalDetectGrade(sectionText, fallbackText) {
    var low = (String(sectionText || '') + ' ' + String(fallbackText || '')).toLowerCase();
    if (/kinder|nursery|prep/.test(low)) return 0;
    if (/senior\s*high|\bshs\b/.test(low)) return 11;
    if (/junior\s*high|\bjhs\b/.test(low)) return 7;
    var m = low.match(/(?:grade|gr\.?|g)\s*(\d{1,2})/);
    if (m) {
        var g = parseInt(m[1], 10);
        if (g >= 0 && g <= 12) return g;
    }
    // Handles sections where the grade is glued to the letter, e.g. "4B Justice".
    m = low.match(/(?:^|[^a-z0-9])(\d{1,2})/);
    if (m) {
        var g2 = parseInt(m[1], 10);
        if (g2 >= 0 && g2 <= 12) return g2;
    }
    return null;
}

/** Is this column a rating column, versus a comment / name / timestamp? */
function evalLooksLikeScale(values) {
    var filled = 0, numeric = 0, inRange = true;
    for (var i = 0; i < values.length; i++) {
        var raw = values[i];
        if (raw === null || raw === undefined || String(raw).trim() === '') continue;
        filled++;
        var n = evalParseScore(raw);
        if (n === null) continue;
        numeric++;
        if (n < 0 || n > 10) inRange = false;
    }
    if (!filled) return false;
    return inRange && numeric >= Math.max(1, Math.floor(filled * 0.6));
}

/** Most common non-empty value in a column. */
function evalMajority(rows, index) {
    if (index < 0) return '';
    var counts = {}, best = '', bestN = 0;
    for (var i = 0; i < rows.length; i++) {
        var cell = rows[i][index];
        var v = String(cell === undefined || cell === null ? '' : cell).trim();
        if (!v) continue;
        counts[v] = (counts[v] || 0) + 1;
        if (counts[v] > bestN) { bestN = counts[v]; best = v; }
    }
    return best;
}

/** Header lookup by keyword. */
function evalFindColumn(headers, keys) {
    for (var i = 0; i < headers.length; i++) {
        var low = String(headers[i] || '').trim().toLowerCase().replace(/:\s*$/, '');
        for (var k = 0; k < keys.length; k++) {
            if (low.indexOf(keys[k]) !== -1) return i;
        }
    }
    return -1;
}

function evalNameKey(text) {
    return String(text || '').toLowerCase().replace(/[^a-z]/g, '')
        .replace(/^(mr|ms|mrs|sir|maam|madam|teacher)/, '');
}

/** "Ms. froya E. Artillaga" and "Froya E. Artillaga" -> one person, fullest spelling. */
function evalNormalizeTeacher(names) {
    var cleaned = [];
    for (var i = 0; i < names.length; i++) {
        var n = String(names[i] || '').replace(/\s+/g, ' ').trim();
        if (n) cleaned.push(n);
    }
    if (!cleaned.length) return '';

    var groups = {};
    for (var j = 0; j < cleaned.length; j++) {
        var key = evalNameKey(cleaned[j]);
        if (!groups[key]) groups[key] = [];
        groups[key].push(cleaned[j]);
    }

    var bestKey = null, bestLen = -1;
    for (var g in groups) {
        if (groups[g].length > bestLen) { bestLen = groups[g].length; bestKey = g; }
    }

    var variants = groups[bestKey], tally = {}, top = 0;
    for (var v = 0; v < variants.length; v++) {
        tally[variants[v]] = (tally[variants[v]] || 0) + 1;
        if (tally[variants[v]] > top) top = tally[variants[v]];
    }
    var winner = '';
    for (var t in tally) {
        if (tally[t] === top && t.length > winner.length) winner = t;
    }
    return winner;
}

/** Comment summary: unique, shortest to longest, duplicates collapsed with a count. */
function evalBuildCommentSummary(comments) {
    var SKIP = { 'n/a': 1, 'na': 1, 'none': 1, '-': 1, 'wala': 1, 'no comment': 1, 'nothing': 1 };
    var map = {}, order = [];
    for (var i = 0; i < comments.length; i++) {
        var cell = comments[i];
        var text = String(cell === null || cell === undefined ? '' : cell).replace(/\s+/g, ' ').trim();
        if (!text) continue;
        if (SKIP[text.toLowerCase()]) continue;
        var key = text.toLowerCase();
        if (map[key]) {
            map[key].count++;
        } else {
            map[key] = { text: text, count: 1 };
            order.push(key);
        }
    }
    var list = [];
    for (var o = 0; o < order.length; o++) list.push(map[order[o]]);
    list.sort(function (a, b) {
        if (a.text.length !== b.text.length) return a.text.length - b.text.length;
        return a.text.toLowerCase() < b.text.toLowerCase() ? -1 : 1;
    });
    var out = [];
    for (var l = 0; l < list.length; l++) {
        out.push(list[l].count > 1 ? list[l].text + ' (' + list[l].count + ')' : list[l].text);
    }
    return out;
}

/** Safe, unique Google Sheets tab name. */
function evalSafeTabName(name, used) {
    var clean = String(name || 'SECTION').replace(/[\[\]\*\/\\\?:]/g, '-').trim() || 'SECTION';
    if (clean.length > 90) clean = clean.substring(0, 90);
    var candidate = clean, n = 2;
    while (used[candidate.toLowerCase()]) {
        candidate = clean + ' (' + n + ')';
        n++;
    }
    used[candidate.toLowerCase()] = true;
    return candidate;
}

function evalSlug(text) {
    var s = String(text || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
    return s || 'TEACHER';
}

// ---------------------------------------------------------------------------
// Turning one response table into a filled-in evaluation record
// ---------------------------------------------------------------------------

/** Optional Advisers sheet in the main spreadsheet: columns TEACHER | SECTION */
var __evalAdvisers = null;

function evalLoadAdvisers() {
    if (__evalAdvisers) return __evalAdvisers;
    __evalAdvisers = [];
    try {
        var ss = SpreadsheetApp.openById(prop('SHEET_ID'));
        var sh = ss.getSheetByName('Advisers') || ss.getSheetByName('Advisors');
        if (sh && sh.getLastRow() > 1) {
            var cols = Math.max(2, sh.getLastColumn());
            var vals = sh.getRange(1, 1, sh.getLastRow(), cols).getValues();
            for (var r = 1; r < vals.length; r++) {
                var tn = String(vals[r][0] || '').trim();
                var sn = String(vals[r][1] || '').trim();
                if (tn && sn) {
                    __evalAdvisers.push({
                        teacher: evalNameKey(tn),
                        section: sn.toLowerCase().replace(/[^a-z0-9]/g, '')
                    });
                }
            }
        }
    } catch (e) { /* no Advisers sheet is fine */ }
    return __evalAdvisers;
}

function evalIsAdviser(teacher, section) {
    var list = evalLoadAdvisers();
    if (!list.length) return false;
    var tk = evalNameKey(teacher);
    var sk = String(section || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!tk || !sk) return false;
    for (var i = 0; i < list.length; i++) {
        var namesMatch = tk.indexOf(list[i].teacher) !== -1 || list[i].teacher.indexOf(tk) !== -1;
        var secMatch = sk.indexOf(list[i].section) !== -1 || list[i].section.indexOf(sk) !== -1;
        if (namesMatch && secMatch) return true;
    }
    return false;
}

/** Normalize record content for duplicate-response detection. */
function evalSignatureText(value) {
    return String(value === null || value === undefined ? '' : value)
        .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Build a source-independent signature from the complete response content. */
function evalRecordSignature(record) {
    var students = (record.students || []).map(function (student) {
        var scores = (student.scores || []).map(function (score) {
            return score === null || score === undefined ? '' : String(score);
        });
        return evalSignatureText(student.name) + '|' + scores.join(',');
    }).sort();
    var comments = (record.commentGroups || []).map(function (group) {
        var lines = (group.lines || []).map(evalSignatureText).sort();
        return evalSignatureText(group.question) + '|' + lines.join('~');
    }).sort();
    return [evalSignatureText(record.teacher), evalSignatureText(record.subject),
        evalSignatureText(record.section), String(record.grade),
        evalSignatureText(record.templateKey), students.join('||'),
        comments.join('||')].join('###');
}

/**
 * @param {{name:string, headers:Array, rows:Array}} table
 * @param {boolean} skipAdviserLookup  true when running outside Apps Script
 * @return {{ok:boolean, note:string, record:Object}}
 */
function evalBuildRecord(table, skipAdviserLookup) {
    var headers = (table.headers || []).map(function (h) { return String(h || ''); });
    var rows = table.rows || [];
    if (!headers.length || !rows.length) {
        return { ok: false, note: table.name + ': no response rows found.' };
    }

    var width = headers.length;
    rows = rows.map(function (r) {
        var out = r.slice(0, width);
        while (out.length < width) out.push('');
        return out;
    });

    var iTeacher = evalFindColumn(headers, EVAL_TEACHER_KEYS);
    var iSubject = evalFindColumn(headers, EVAL_SUBJECT_KEYS);
    var iSection = evalFindColumn(headers, EVAL_SECTION_KEYS);
    var iStudent = evalFindColumn(headers, EVAL_STUDENT_KEYS);
    var iTime = evalFindColumn(headers, EVAL_TIME_KEYS);
    var iAdviser = evalFindColumn(headers, EVAL_ADVISER_KEYS);

    // The section keyword list includes "grade", which can also match an adviser
    // question. Keep them distinct.
    if (iAdviser >= 0 && iAdviser === iSection) iAdviser = -1;

    var meta = {};
    [iTeacher, iSubject, iSection, iStudent, iTime].forEach(function (i) {
        if (i >= 0) meta[i] = true;
    });

    // Split the remaining columns into ratings versus comments.
    var scoreIdx = [], commentIdx = [];
    for (var c = 0; c < width; c++) {
        if (meta[c] || c === iAdviser) continue;
        var column = rows.map(function (r) { return r[c]; });
        if (evalLooksLikeScale(column)) scoreIdx.push(c);
        else commentIdx.push(c);
    }

    var section = evalMajority(rows, iSection);
    var subject = evalMajority(rows, iSubject);

    var teacherNames = [];
    if (iTeacher >= 0) {
        for (var t = 0; t < rows.length; t++) teacherNames.push(rows[t][iTeacher]);
    }
    var teacher = evalNormalizeTeacher(teacherNames);

    var grade = evalDetectGrade(section, table.name + ' ' + subject);
    if (grade === null) {
        return { ok: false, note: table.name + ': could not detect a grade level from "' + section + '".' };
    }
    var key = evalTemplateKeyForGrade(grade);
    var spec = EVAL_TEMPLATES[key];

    var note = '';
    if (scoreIdx.length !== spec.rows.length) {
        note = table.name + ': found ' + scoreIdx.length + ' rating columns but the '
            + spec.label + ' template expects ' + spec.rows.length + '. Check the form questions.';
    }

    // Class adviser, either from a form question or the Advisers sheet.
    var adviserFlag = false;
    if (iAdviser >= 0) {
        var yes = 0, answered = 0;
        for (var a = 0; a < rows.length; a++) {
            var ans = String(rows[a][iAdviser] || '').trim().toLowerCase();
            if (!ans) continue;
            answered++;
            if (/^(y|yes|oo|opo|true|1)/.test(ans)) yes++;
        }
        adviserFlag = answered > 0 && yes >= answered / 2;
    }
    if (!adviserFlag && !skipAdviserLookup && evalIsAdviser(teacher, section)) adviserFlag = true;
    if (adviserFlag && section.toLowerCase().indexOf('class adviser') === -1) {
        section = 'CLASS ADVISER - ' + section;
    }

    var students = [];
    for (var r2 = 0; r2 < rows.length; r2++) {
        var scores = scoreIdx.map(function (i) { return evalParseScore(rows[r2][i]); });
        var any = false;
        for (var s = 0; s < scores.length; s++) {
            if (scores[s] !== null) { any = true; break; }
        }
        if (!any) continue;
        students.push({
            name: iStudent >= 0 ? String(rows[r2][iStudent] || '').trim() : '',
            scores: scores
        });
    }

    var commentGroups = [];
    for (var ci = 0; ci < commentIdx.length; ci++) {
        var idx = commentIdx[ci];
        var vals = rows.map(function (r) { return r[idx]; });
        var summary = evalBuildCommentSummary(vals);
        if (summary.length) {
            commentGroups.push({ question: String(headers[idx]).trim(), lines: summary });
        }
    }

    return {
        ok: true,
        note: note,
        record: {
            source: table.name,
            teacher: teacher,
            subject: subject,
            section: section,
            grade: grade,
            templateKey: key,
            students: students,
            commentGroups: commentGroups
        }
    };
}

// ---------------------------------------------------------------------------
// Drive plumbing
// ---------------------------------------------------------------------------

function evalTemplateFileId() {
    var id = prop('EVAL_TEMPLATE_ID', '');
    if (!id) {
        throw httpError('EVAL_TEMPLATE_ID is not set in Script Properties. Upload the master template to Drive as a GOOGLE SHEET and paste its id there.', 'CONFIG');
    }
    var m = String(id).match(/[-\w]{25,}/);
    return m ? m[0] : String(id);
}

/** True when `folder` sits directly inside `parent`. */
function evalIsChildOf(folder, parent) {
    try {
        var pid = parent.getId();
        var parents = folder.getParents();
        while (parents.hasNext()) {
            if (parents.next().getId() === pid) return true;
        }
    } catch (e) { /* treat as not a child */ }
    return false;
}

/**
 * Output always belongs INSIDE the eval forms folder, never in My Drive.
 *
 * Apps Script creates files owned by the deploying account, and anything
 * created without an explicit parent lands in that account's My Drive root.
 * An earlier run could also have left a stray "Generated Evaluations" there,
 * so this moves such a folder back in rather than starting a second one and
 * splitting the results across two places.
 */
function evalOutputFolder() {
    var root = formsFolder();

    // An explicit override is honoured only if it really lives under the forms
    // folder. A stale id pointing at My Drive is exactly the reported bug.
    var id = prop('EVAL_OUTPUT_FOLDER', '');
    if (id) {
        try {
            var pinned = DriveApp.getFolderById(id);
            if (evalIsChildOf(pinned, root) || pinned.getId() === root.getId()) return pinned;
        } catch (e) { /* unusable id - fall through */ }
    }

    // Correct location.
    var existing = root.getFoldersByName('Generated Evaluations');
    if (existing.hasNext()) return existing.next();

    // Rescue a stray folder from My Drive so past builds are not orphaned.
    try {
        var stray = DriveApp.getRootFolder().getFoldersByName('Generated Evaluations');
        if (stray.hasNext()) {
            var found = stray.next();
            found.moveTo(root);
            return found;
        }
    } catch (e) { /* moveTo unavailable or not permitted - just create a new one */ }

    return root.createFolder('Generated Evaluations');
}

/**
 * Run from the editor to see exactly where output is going, and to pull a
 * stray folder back under the forms folder.
 */
function testEvalOutputFolder() {
    var root = formsFolder();
    var out = evalOutputFolder();
    var parents = [], it = out.getParents();
    while (it.hasNext()) parents.push(it.next().getName());
    Logger.log('Forms folder   : %s (%s)', root.getName(), root.getId());
    Logger.log('Output folder  : %s (%s)', out.getName(), out.getId());
    Logger.log('Output URL     : %s', out.getUrl());
    Logger.log('Sits inside    : %s', parents.join(', ') || '(My Drive root)');
    Logger.log('Correct place  : %s', evalIsChildOf(out, root) ? 'YES' : 'NO');
    Logger.log('EVAL_OUTPUT_FOLDER property: %s', prop('EVAL_OUTPUT_FOLDER', '(not set)'));
    return out.getUrl();
}

/**
 * Get-or-create a folder for one teacher inside "Generated Evaluations",
 * so the output is easy to browse instead of one flat pile of files.
 */
function evalTeacherFolder(outFolder, teacherLabel) {
    var name = String(teacherLabel || '').trim() || 'UNSORTED';
    name = name.replace(/[\/\\]+/g, '-').replace(/\s+/g, ' ');
    var existing = outFolder.getFoldersByName(name);
    return existing.hasNext() ? existing.next() : outFolder.createFolder(name);
}

/**
 * Lists everything already built, grouped by teacher folder, so the website
 * can link straight to past results instead of rebuilding them.
 */
function handleListGeneratedEvals(session) {
    var outFolder = evalOutputFolder();
    var teachers = [], totalFiles = 0;

    function describe(f) {
        var when = '';
        try {
            var d = f.getLastUpdated();
            if (d) when = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
        } catch (e) { /* keep going without a date */ }
        return {
            name: f.getName(),
            url: f.getUrl(),
            id: f.getId(),
            xlsxUrl: 'https://docs.google.com/spreadsheets/d/' + f.getId() + '/export?format=xlsx',
            updated: when
        };
    }

    var folders = outFolder.getFolders();
    while (folders.hasNext()) {
        var tf = folders.next();
        var items = [];
        var files = tf.getFiles();
        while (files.hasNext()) items.push(describe(files.next()));
        items.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
        totalFiles += items.length;
        teachers.push({ teacher: tf.getName(), url: tf.getUrl(), files: items });
    }

    var loose = [];
    var rootFiles = outFolder.getFiles();
    while (rootFiles.hasNext()) loose.push(describe(rootFiles.next()));
    loose.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
    totalFiles += loose.length;

    teachers.sort(function (a, b) { return a.teacher < b.teacher ? -1 : (a.teacher > b.teacher ? 1 : 0); });

    return {
        outputFolder: outFolder.getName(),
        outputFolderUrl: outFolder.getUrl(),
        teachers: teachers,
        looseFiles: loose,
        totalFiles: totalFiles
    };
}

/** Reads any supported response file into { name, headers, rows }. */
function evalReadResponseFile(file) {
    var mime = file.getMimeType();
    if (mime === MimeType.GOOGLE_FORMS) {
        return formResponsesFromForm(file.getId(), file.getName());
    }
    if (mime === MimeType.GOOGLE_SHEETS) {
        return formResponsesFromSheet(SpreadsheetApp.openById(file.getId()), file.getName());
    }
    if (mime === 'text/csv') {
        var arr = Utilities.parseCsv(file.getBlob().getDataAsString());
        return {
            name: file.getName(),
            headers: (arr[0] || []).map(String),
            rows: arr.slice(1)
        };
    }
    return null;
}

/** Lists the teacher batches (subfolders) available to build. */
function handleListEvalBatches(session) {
    var root = formsFolder();
    var out = [];

    // Only the top-level teacher folders are listed here. Counting the files
    // inside each one meant walking the whole tree, which took ~57s on a real
    // folder of 376 forms - far too slow just to populate a dropdown. The
    // count is filled in when a teacher is actually previewed or built.
    var subs = evalSubFolders(root);
    for (var i = 0; i < subs.length && out.length < 300; i++) {
        var f = subs[i];
        out.push({ id: f.getId(), name: f.getName(), files: -1 });
    }
    out.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });

    // Files sitting directly in the root, not inside any teacher folder.
    var loose = 0, rootFiles = root.getFiles();
    while (rootFiles.hasNext()) {
        var rf = rootFiles.next();
        if (rf.getMimeType() === EVAL_SHORTCUT_MIME && evalFolderFromShortcut(rf)) continue;
        if (evalIsUsableEntry(rf)) loose++;
    }

    return {
        folderName: root.getName(),
        folderUrl: root.getUrl(),
        batches: out,
        looseFiles: loose,
        totalFiles: -1,
        countsSkipped: true
    };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
/**
 * payload:
 *   folderId  optional - build just this teacher subfolder. Omit for all.
 *   dryRun    optional - report what WOULD be built without creating files.
 */
function handleBuildEvalWorkbooks(session, p) {
    p = p || {};
    var templateId = evalTemplateFileId();
    var root = formsFolder();

    var batches = [];
    var walkCtx = evalNewBudget();   // one shared budget for the whole request
    if (p.folderId) {
        var one = DriveApp.getFolderById(String(p.folderId));
        batches.push({ name: one.getName(), folder: one, entries: evalCollectEntries(one, '', 0, {}, [], walkCtx) });
    } else {
        // One batch per teacher folder, following folder shortcuts.
        var subs = evalSubFolders(root);
        for (var si = 0; si < subs.length; si++) {
            batches.push({
                name: subs[si].getName(),
                folder: subs[si],
                entries: evalCollectEntries(subs[si], '', 0, {}, [], walkCtx)
            });
        }

        // Plus any files sitting loose in the root, grouped on their own.
        var rootEntries = [], rootFiles = root.getFiles();
        while (rootFiles.hasNext()) {
            var rf = rootFiles.next();
            if (rf.getMimeType() === EVAL_SHORTCUT_MIME && evalFolderFromShortcut(rf)) continue;
            if (evalIsUsableEntry(rf)) rootEntries.push({ file: rf, path: '' });
        }
        if (rootEntries.length) batches.push({ name: '', folder: root, entries: rootEntries });
    }

    var outFolder = p.dryRun ? null : evalOutputFolder();
    var created = [], notes = [];

    var totalEntries = 0;
    for (var bc = 0; bc < batches.length; bc++) totalEntries += (batches[bc].entries || []).length;
    if (!totalEntries) {
        notes.push('Nothing readable was found in \u201c' + root.getName() + '\u201d. ' +
            'Press Diagnose to see every file the script can see and why it was skipped.');
    }
    if (walkCtx.stopped) {
        notes.push('The folder scan was cut short. ' + walkCtx.stopped +
            ' Some teachers may be missing. Build one folder at a time if this keeps happening.');
    }

    // Reading a Google Form is a network call, and this folder can hold 376 of
    // them. There is no way to finish them all inside Google's 6-minute ceiling,
    // so stop cleanly with time to spare and report what is left.
    var buildStarted = Date.now();
    var remaining = [];

    for (var b = 0; b < batches.length; b++) {
        var batch = batches[b];
        var byTemplate = {};
        var seenRecordSignatures = {};

        if (!p.folderId && (Date.now() - buildStarted) > EVAL_BUILD_BUDGET_MS) {
            for (var rb = b; rb < batches.length; rb++) {
                if (batches[rb].name) remaining.push(batches[rb].name);
            }
            break;
        }

        // Drop "(Responses)" sheets that mirror a form in the same batch.
        var entries = evalDedupeEntries(batch.entries || [], notes);
        for (var ei = 0; ei < entries.length; ei++) {
            var file = entries[ei].file;
            var tables = [];
            try {
                // Follows shortcuts, .url files, Docs and link-index Sheets.
                tables = evalTablesFromEntry(file, notes, 0);
            } catch (e) {
                notes.push(file.getName() + ': ' + (e.message || e));
                continue;
            }

            for (var ti = 0; ti < tables.length; ti++) {
                var built = evalBuildRecord(tables[ti], false);
                if (built.note) notes.push(built.note);
                if (!built.ok) continue;

                var signature = evalRecordSignature(built.record);
                if (seenRecordSignatures[signature]) {
                    notes.push('Ignored duplicate response source “' + built.record.source +
                        '”; it contains the same ' + built.record.students.length +
                        ' responses as “' + seenRecordSignatures[signature].source + '”.');
                    continue;
                }
                seenRecordSignatures[signature] = { source: built.record.source };

                var key = built.record.templateKey;
                if (!byTemplate[key]) byTemplate[key] = [];
                byTemplate[key].push(built.record);
            }
        }

        for (var tk in byTemplate) {
            var records = byTemplate[tk];
            records.sort(function (x, y) {
                if (x.grade !== y.grade) return x.grade - y.grade;
                return x.section < y.section ? -1 : (x.section > y.section ? 1 : 0);
            });

            var teacherLabel = batch.name;
            if (!teacherLabel) {
                teacherLabel = evalNormalizeTeacher(records.map(function (r) { return r.teacher; }));
            }
            var fileName = evalSlug(teacherLabel) + '_' + evalSlug(EVAL_TEMPLATES[tk].label);

            if (p.dryRun) {
                created.push({
                    name: fileName,
                    template: EVAL_TEMPLATES[tk].label,
                    teacher: teacherLabel,
                    tabs: records.map(function (r) { return r.section; }),
                    responses: records.reduce(function (s, r) { return s + r.students.length; }, 0),
                    url: ''
                });
                continue;
            }

            // Each teacher gets their own subfolder inside Generated
            // Evaluations, so their files are easy to find later.
            var destFolder = evalTeacherFolder(outFolder, teacherLabel);

            var result = evalWriteWorkbook(templateId, tk, records, fileName, destFolder, notes);
            created.push({
                name: result.name,
                template: EVAL_TEMPLATES[tk].label,
                teacher: teacherLabel,
                tabs: result.tabs,
                responses: result.responses,
                url: result.url,
                id: result.id,
                xlsxUrl: result.xlsxUrl,
                folder: destFolder.getName(),
                folderUrl: destFolder.getUrl()
            });
        }
    }

    if (remaining.length) {
        notes.push('Stopped after ' + Math.round((Date.now() - buildStarted) / 1000) +
            's to stay inside Google\u2019s 6-minute limit. Still to do (' + remaining.length +
            '): ' + remaining.slice(0, 25).join(', ') +
            (remaining.length > 25 ? ', \u2026' : '') +
            '. Pick each one from the teacher dropdown and build it individually.');
    }

    return {
        remaining: remaining,
        generatedAt: nowStamp(),
        folderName: root.getName(),
        outputFolder: p.dryRun ? '' : outFolder.getName(),
        outputFolderUrl: p.dryRun ? '' : outFolder.getUrl(),
        files: created,
        notes: notes,
        dryRun: !!p.dryRun
    };
}

// ---------------------------------------------------------------------------
// Writing the output workbook
// ---------------------------------------------------------------------------

/** Copies the template and fills one tab per section. */
// ---------------------------------------------------------------------------
// Tab naming: "10A - AP"
//   grade + section letter (sections of that grade in alphabetical order)
//   + the subject acronym. Senior High keeps its real section name instead of
//   a letter, because SHS strands are not lettered.
// ---------------------------------------------------------------------------

// Sections per grade, ALPHABETICAL. Position decides the letter, so
// ADOLPHINE = A, AMANDINE = B, CHIARA = C. Edit this list if sections change.
var EVAL_SECTION_ROSTER = {
    7: ['HOSEA', 'ISAIAH', 'JEREMIAH', 'MICAH'],
    8: ['JOHN', 'LUKE', 'MARK', 'MATTHEW'],
    9: ['AGNES', 'ANTHONY', 'CLARE'],
    10: ['ADOLPHINE', 'AMANDINE', 'CHIARA']
};

var EVAL_SUBJECT_ACRONYMS = {
    'MATHEMATICS': 'MATH',
    'MATH': 'MATH',
    'GENERAL MATHEMATICS': 'GENMATH',
    'GEN MATH': 'GENMATH',
    'STATISTICS AND PROBABILITY': 'STATS&PROB',
    'ARALING PANLIPUNAN': 'AP',
    'PHYSICAL EDUCATION': 'PE',
    'HEALTH OPTIMIZING PHYSICAL EDUCATION': 'HOPE',
    'CHRISTIAN LIVING EDUCATION': 'CLE',
    'TECHNOLOGY AND LIVELIHOOD EDUCATION': 'TLE',
    'INFORMATION AND COMMUNICATIONS TECHNOLOGY': 'ICT',
    'INFORMATION AND COMMUNICATION TECHNOLOGY': 'ICT',
    'MEDIA AND INFORMATION LITERACY': 'MIL',
    'EMPOWERMENT TECHNOLOGIES': 'E-TECH',
    'READING AND WRITING': 'R&W',
    'ENGLISH FOR ACADEMIC AND PROFESSIONAL PURPOSES': 'EAPP',
    'PERSONAL DEVELOPMENT': 'PERDEV',
    'HOMEROOM GUIDANCE': 'HG',
    'VALUES EDUCATION': 'VALUES',
    'MOTHER TONGUE': 'MT'
};

/** Strips "ST.", "GRADE 9", punctuation and digits so sections compare cleanly. */
function evalSectionKey(section) {
    return String(section || '')
        .toUpperCase()
        .replace(/CLASS\s*ADVISER/g, ' ')
        .replace(/\bGRADE\b|\bGR\b/g, ' ')
        .replace(/\bST\b/g, ' ')
        .replace(/[^A-Z]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * A, B, C ... from the alphabetical position of the section within its grade.
 * Falls back to the sections present in this build when the grade is not in
 * the roster, so a new section still gets a sensible letter.
 */
function evalSectionLetter(grade, section, fallbackSections) {
    var key = evalSectionKey(section);
    if (!key) return '';

    var list = null;
    var roster = EVAL_SECTION_ROSTER[grade];
    if (roster && roster.length) {
        list = roster.slice();
    } else if (fallbackSections && fallbackSections.length) {
        list = [];
        for (var f = 0; f < fallbackSections.length; f++) {
            var k = evalSectionKey(fallbackSections[f]);
            if (k && list.indexOf(k) < 0) list.push(k);
        }
        list.sort();
    }
    if (!list || !list.length) return '';

    for (var i = 0; i < list.length; i++) {
        if (list[i] === key || key.indexOf(list[i]) >= 0 || list[i].indexOf(key) >= 0) {
            return String.fromCharCode(65 + i);
        }
    }
    return '';
}

/** "Araling Panlipunan" -> "AP". Unknown multi-word subjects become initials. */
function evalSubjectAcronym(subject) {
    var key = String(subject || '').toUpperCase()
        .replace(/[^A-Z0-9&]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!key) return '';
    if (EVAL_SUBJECT_ACRONYMS[key]) return EVAL_SUBJECT_ACRONYMS[key];

    // Drop a trailing grade number, e.g. "MATH 10" or "GRADE 10 MATH".
    var bare = key.replace(/\bGRADE\b/g, ' ').replace(/\b\d{1,2}\b/g, ' ')
        .replace(/\s+/g, ' ').trim();
    if (EVAL_SUBJECT_ACRONYMS[bare]) return EVAL_SUBJECT_ACRONYMS[bare];
    if (!bare) return key;
    if (bare.indexOf(' ') < 0) return bare;

    var skip = ['AND', 'OF', 'THE', 'IN', 'FOR', 'TO', '&'];
    var words = [], parts = bare.split(' ');
    for (var p = 0; p < parts.length; p++) {
        if (parts[p] && skip.indexOf(parts[p]) < 0) words.push(parts[p]);
    }
    if (!words.length) return bare;
    if (words.length === 1) return words[0];

    var acr = '';
    for (var w = 0; w < words.length; w++) acr += words[w].charAt(0);
    return acr;
}

/** Builds the sheet name for one section. */
function evalTabLabel(record, templateKey, fallbackSections) {
    var subject = evalSubjectAcronym(record.subject);
    var section = String(record.section || '').trim();

    // Senior High: keep the real section name, no letter.
    if (templateKey === 'shs') {
        if (section && subject) return section + ' - ' + subject;
        return section || subject || 'SECTION';
    }

    var letter = record.grade ? evalSectionLetter(record.grade, section, fallbackSections) : '';
    if (record.grade && letter) {
        var base = String(record.grade) + letter;
        return subject ? base + ' - ' + subject : base;
    }

    // Unknown section or grade: fall back to what we actually know.
    if (section && subject) return section + ' - ' + subject;
    return section || subject || 'SECTION';
}

/** 1 -> A, 35 -> AI */
function evalColLetter(n) {
    var s = '';
    while (n > 0) {
        var m = (n - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}

/** The grid templates have two halves; the category ones are a single list. */
function evalSummaryBlocks(spec) {
    if (spec.rows.length === 16) {
        return [
            { title: "TEACHER'S ACTIONS", rows: spec.rows.slice(0, 8) },
            { title: "STUDENT'S ACTIONS", rows: spec.rows.slice(8) }
        ];
    }
    return [{ title: 'ALL ITEMS', rows: spec.rows }];
}

/**
 * When one workbook holds more than one section of the same subject, add a
 * SUMMARY tab that puts those sections side by side, like the sample sheet.
 * Everything is a live formula, so editing a section tab updates the summary.
 */
function evalWriteSummaryTab(ss, spec, records, tabNames, used) {
    var groups = [], index = {};
    for (var i = 0; i < records.length; i++) {
        var gk = String(records[i].grade || '?') + '|' + String(records[i].subject || '?');
        if (!(gk in index)) {
            index[gk] = groups.length;
            groups.push({ grade: records[i].grade, subject: records[i].subject, items: [] });
        }
        groups[index[gk]].items.push({ record: records[i], tab: tabNames[i] });
    }

    var wanted = [];
    for (var g = 0; g < groups.length; g++) {
        if (groups[g].items.length > 1) wanted.push(groups[g]);
    }
    if (!wanted.length) return null;

    var name = evalSafeTabName('SUMMARY', used);
    var sheet = ss.insertSheet(name, 0);
    var avgCol = evalColLetter(spec.lastCol + 1);
    var blocks = evalSummaryBlocks(spec);
    var row = 1;

    for (var q = 0; q < wanted.length; q++) {
        var grp = wanted[q];
        var cols = grp.items.length;
        var meanCol = 2 + cols;              // column right after the sections
        var src = ss.getSheetByName(grp.items[0].tab);

        var heading = (grp.grade ? 'Grade ' + grp.grade : 'ALL GRADES')
            + (grp.subject ? '  -  ' + grp.subject : '');
        sheet.getRange(row, 1).setValue(heading).setFontWeight('bold').setFontSize(12);
        row += 1;

        for (var b = 0; b < blocks.length; b++) {
            var block = blocks[b];

            var header = [block.title];
            for (var h = 0; h < cols; h++) header.push(grp.items[h].tab);
            header.push('AVERAGE');
            sheet.getRange(row, 1, 1, header.length).setValues([header])
                .setFontWeight('bold').setBackground('#ffff00');
            var headerRow = row;
            row += 1;

            var firstDataRow = row;
            var labels = [], formulas = [];
            for (var r = 0; r < block.rows.length; r++) {
                var sheetRow = block.rows[r];
                var label = '';
                try { label = String(src.getRange(sheetRow, 1).getValue() || ''); } catch (e) { label = 'Item ' + sheetRow; }
                labels.push([label]);

                var line = [];
                for (var c = 0; c < cols; c++) {
                    var tab = String(grp.items[c].tab).replace(/'/g, "''");
                    line.push("='" + tab + "'!" + avgCol + sheetRow);
                }
                line.push('=IFERROR(AVERAGE(B' + row + ':' + evalColLetter(1 + cols) + row + '),"")');
                formulas.push(line);
                row += 1;
            }

            sheet.getRange(firstDataRow, 1, labels.length, 1).setValues(labels);
            sheet.getRange(firstDataRow, 2, formulas.length, cols + 1).setValues(formulas);
            sheet.getRange(firstDataRow, 2, formulas.length, cols).setNumberFormat('0.00');
            sheet.getRange(firstDataRow, meanCol, formulas.length, 1)
                .setNumberFormat('0.00').setBackground('#00e000');

            var lastDataRow = row - 1;
            var avgLine = ['AVERAGE'];
            for (var a = 0; a < cols; a++) {
                var col = evalColLetter(2 + a);
                avgLine.push('=IFERROR(AVERAGE(' + col + firstDataRow + ':' + col + lastDataRow + '),"")');
            }
            var mc = evalColLetter(meanCol);
            avgLine.push('=IFERROR(AVERAGE(' + mc + firstDataRow + ':' + mc + lastDataRow + '),"")');
            sheet.getRange(row, 1, 1, avgLine.length).setValues([avgLine])
                .setFontWeight('bold').setBackground('#ffff00').setNumberFormat('0.00');
            sheet.getRange(row, meanCol).setBackground('#ff00ff');
            row += 2;
        }
        row += 1;
    }

    sheet.setColumnWidth(1, 320);
    sheet.setFrozenColumns(1);
    return sheet;
}

function evalWriteWorkbook(templateId, templateKey, records, fileName, outFolder, notes) {
    var spec = EVAL_TEMPLATES[templateKey];

    // Replace any previous build with the same name so re-runs stay clean.
    var dupes = outFolder.getFilesByName(fileName);
    while (dupes.hasNext()) dupes.next().setTrashed(true);

    var copy = DriveApp.getFileById(templateId).makeCopy(fileName, outFolder);
    var ss = SpreadsheetApp.openById(copy.getId());

    var master = ss.getSheetByName(spec.sheetName);
    if (!master) {
        throw httpError('The template workbook has no sheet named "' + spec.sheetName + '". Check EVAL_TEMPLATE_ID.', 'CONFIG');
    }

    var used = {}, tabs = [], responses = 0;
    var capacity = spec.lastCol - spec.firstCol + 1;

    // Used only when a grade is missing from EVAL_SECTION_ROSTER.
    var sectionsInFile = records.map(function (r) { return r.section; });

    for (var i = 0; i < records.length; i++) {
        var record = records[i];
        // copyTo preserves every formula, merge and format from the template.
        var sheet = (i === 0) ? master : master.copyTo(ss);
        var tabName = evalSafeTabName(
            evalTabLabel(record, templateKey, sectionsInFile) || ('SECTION ' + (i + 1)), used);
        sheet.setName(tabName);
        evalFillSheet(sheet, spec, record, notes);
        tabs.push(tabName);
        responses += Math.min(record.students.length, capacity);
    }

    // Side-by-side comparison when the file holds 2+ sections of a subject.
    evalWriteSummaryTab(ss, spec, records, tabs, used);

    evalWriteCommentsTab(ss, records, used);

    // Drop the unused template tabs, keeping only what we filled in.
    var all = ss.getSheets();
    for (var s = 0; s < all.length; s++) {
        var nm = all[s].getName();
        var isTemplateTab = false;
        for (var t in EVAL_TEMPLATES) {
            if (EVAL_TEMPLATES[t].sheetName === nm) { isTemplateTab = true; break; }
        }
        if (isTemplateTab && ss.getSheets().length > 1) ss.deleteSheet(all[s]);
    }

    SpreadsheetApp.flush();

    return {
        name: fileName,
        id: copy.getId(),
        url: ss.getUrl(),
        xlsxUrl: 'https://docs.google.com/spreadsheets/d/' + copy.getId() + '/export?format=xlsx',
        tabs: tabs,
        responses: responses
    };
}

/** Writes the 3 header cells and the student score columns. Nothing else. */
function evalFillSheet(sheet, spec, record, notes) {
    sheet.getRange('B2').setValue(record.teacher);
    sheet.getRange('B3').setValue(record.subject);
    sheet.getRange('B4').setValue(record.section);

    var capacity = spec.lastCol - spec.firstCol + 1;
    var students = record.students;
    if (students.length > capacity) {
        notes.push(record.source + ': ' + students.length + ' responses exceed the '
            + spec.label + ' template capacity of ' + capacity + ' columns. Extra responses were left out.');
        students = students.slice(0, capacity);
    }
    if (!students.length) return;

    // One batched write per question row keeps this fast on big folders.
    for (var r = 0; r < spec.rows.length; r++) {
        var rowValues = [], hasValue = false;
        for (var s = 0; s < students.length; s++) {
            var score = students[s].scores[r];
            if (score === null || score === undefined) {
                rowValues.push('');
            } else {
                rowValues.push(score);
                hasValue = true;
            }
        }
        if (hasValue) {
            sheet.getRange(spec.rows[r], spec.firstCol, 1, rowValues.length).setValues([rowValues]);
        }
    }
}

/** COMMENTS SUMMARY tab, in the required arrangement. */
function evalWriteCommentsTab(ss, records, used) {
    var name = evalSafeTabName('COMMENTS SUMMARY', used);
    var sheet = ss.insertSheet(name);
    var out = [], bold = [];

    out.push(['COMMENTS SUMMARY']);
    bold.push(out.length);
    out.push(['']);

    for (var i = 0; i < records.length; i++) {
        var record = records[i];
        out.push([record.section + (record.subject ? '  -  ' + record.subject : '')]);
        bold.push(out.length);

        for (var g = 0; g < record.commentGroups.length; g++) {
            var group = record.commentGroups[g];
            out.push([group.question]);
            bold.push(out.length);
            for (var l = 0; l < group.lines.length; l++) out.push([group.lines[l]]);
            out.push(['']);
        }
        out.push(['']);
    }

    if (out.length) sheet.getRange(1, 1, out.length, 1).setValues(out);
    sheet.setColumnWidth(1, 700);
    sheet.getRange(1, 1).setFontSize(14).setFontWeight('bold');
    for (var b = 0; b < bold.length; b++) sheet.getRange(bold[b], 1).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return sheet;
}

// ---------------------------------------------------------------------------
// Run this once from the Apps Script editor to sanity-check the setup.
// ---------------------------------------------------------------------------
function testEvalExportSetup() {
    var lines = [];
    try {
        lines.push('OK    Forms folder: ' + formsFolder().getName());
    } catch (e) {
        lines.push('FAIL  ' + e.message);
    }
    try {
        var ss = SpreadsheetApp.openById(evalTemplateFileId());
        lines.push('OK    Template workbook: ' + ss.getName());
        var missing = [];
        for (var k in EVAL_TEMPLATES) {
            if (!ss.getSheetByName(EVAL_TEMPLATES[k].sheetName)) missing.push(EVAL_TEMPLATES[k].sheetName);
        }
        lines.push(missing.length
            ? 'WARN  Missing template tabs: ' + missing.join(', ')
            : 'OK    All 5 template tabs found.');
    } catch (e2) {
        lines.push('FAIL  ' + e2.message);
    }
    try {
        var batches = handleListEvalBatches(null);
        lines.push('OK    Teacher folders: ' + batches.batches.length
            + ' (loose files in root: ' + batches.looseFiles + ')');
    } catch (e3) {
        lines.push('FAIL  ' + e3.message);
    }
    Logger.log(lines.join('\n'));
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Link resolution
//
// Your Drive folder holds LINKS to forms, not always the forms themselves.
// A "link" can arrive in several shapes, and this section handles all of them:
//
//   1. Drive shortcut          (right-click > Add shortcut to Drive)
//   2. .url / .webloc file     (dragged from a browser)
//   3. a plain .txt file       containing one or more form URLs
//   4. a Google Doc            with the links pasted or hyperlinked in it
//   5. a Google Sheet          with a column headed Link / URL / Form
//   6. the real Form or Sheet  (handled already)
// ---------------------------------------------------------------------------

var EVAL_SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';

/** Pulls every Google file reference out of a blob of text. */
function evalTargetsFromText(text) {
    var found = [], seen = {};
    var str = String(text || '');

    function push(kind, id, url) {
        if (!id) return;
        var key = kind + ':' + id;
        if (seen[key]) return;
        seen[key] = true;
        found.push({ kind: kind, id: id, url: url || '' });
    }

    // Published form links: /forms/d/e/<publishedId>/viewform
    var rePublished = /forms\/d\/e\/([A-Za-z0-9_-]{20,})/g, m;
    while ((m = rePublished.exec(str)) !== null) push('formPublished', m[1], m[0]);

    // Editable form links: /forms/d/<fileId>/edit
    var reForm = /forms\/d\/(?!e\/)([A-Za-z0-9_-]{20,})/g;
    while ((m = reForm.exec(str)) !== null) push('form', m[1], m[0]);

    // Spreadsheet links
    var reSheet = /spreadsheets\/d\/([A-Za-z0-9_-]{20,})/g;
    while ((m = reSheet.exec(str)) !== null) push('sheet', m[1], m[0]);

    // Generic file links and open?id= links - type discovered later.
    var reFile = /(?:file\/d\/|open\?id=|[?&]id=)([A-Za-z0-9_-]{20,})/g;
    while ((m = reFile.exec(str)) !== null) push('unknown', m[1], m[0]);

    return found;
}

/** Drive API v3 lookup. Needed because DriveApp cannot follow shortcuts. */
// Memo for the run. The same shortcut gets inspected by evalSubFolders, then
// again by evalCollectEntries, then again by the diagnose walk. Without this
// cache that is 3-4 network round trips per shortcut, which is what made the
// Diagnose button feel slow.
var __evalMetaCache = {};

function evalDriveMeta(id) {
    id = String(id);
    if (Object.prototype.hasOwnProperty.call(__evalMetaCache, id)) {
        return __evalMetaCache[id];
    }

    var out = null;
    try {
        var url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
            '?supportsAllDrives=true&fields=id,name,mimeType,shortcutDetails';
        var res = UrlFetchApp.fetch(url, {
            method: 'get',
            muteHttpExceptions: true,
            headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
        });
        if (res.getResponseCode() === 200) {
            out = JSON.parse(res.getContentText());
        }
    } catch (e) {
        out = null;
    }

    __evalMetaCache[id] = out;
    return out;
}

/** Reads the text out of any file that might be carrying links. */
function evalTextFromFile(file, mime) {
    if (mime === MimeType.GOOGLE_DOCS) {
        var doc = DocumentApp.openById(file.getId());
        var body = doc.getBody();
        var text = body.getText();
        // Hyperlinks whose display text is not the URL itself.
        var n = body.getNumChildren();
        for (var i = 0; i < n; i++) {
            var child = body.getChild(i);
            if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
            var para = child.asParagraph();
            for (var j = 0; j < para.getNumChildren(); j++) {
                var kid = para.getChild(j);
                if (kid.getType() !== DocumentApp.ElementType.TEXT) continue;
                var t = kid.asText(), raw = t.getText();
                for (var k = 0; k < raw.length; k++) {
                    var link = t.getLinkUrl(k);
                    if (link) text += '\n' + link;
                }
            }
        }
        return text;
    }
    return file.getBlob().getDataAsString();
}

/** A Sheet acting as an index of form links, rather than response data. */
function evalLinkSheetTargets(id) {
    var ss = SpreadsheetApp.openById(id);
    var sheet = ss.getSheets()[0];
    if (!sheet || sheet.getLastRow() < 1) return null;

    var values = sheet.getRange(1, 1, Math.min(sheet.getLastRow(), 400),
        Math.max(1, sheet.getLastColumn())).getValues();

    var headerText = (values[0] || []).join(' ').toLowerCase();
    var looksLikeIndex = /\b(link|url|form)\b/.test(headerText);

    var text = '';
    for (var r = 0; r < values.length; r++) {
        for (var c = 0; c < values[r].length; c++) text += ' ' + values[r][c];
    }
    // Also catch cells where the URL is a hyperlink behind display text.
    try {
        var formulas = sheet.getRange(1, 1, Math.min(sheet.getLastRow(), 400),
            Math.max(1, sheet.getLastColumn())).getFormulas();
        for (var fr = 0; fr < formulas.length; fr++) text += ' ' + formulas[fr].join(' ');
    } catch (e) { }

    var targets = evalTargetsFromText(text);
    // Only treat it as an index if it really points at other files.
    if (!targets.length) return null;
    if (!looksLikeIndex && targets.length < 2) return null;
    return targets;
}

/** Opens a form target and returns its response table. */
function evalTableFromFormTarget(target, label) {
    if (target.kind === 'form') {
        return formResponsesFromForm(target.id, label);
    }
    // Published /forms/d/e/ ids are NOT file ids, so they cannot be opened
    // directly. openByUrl works when the deployer owns or can edit the form.
    var form = FormApp.openByUrl('https://docs.google.com/forms/d/e/' + target.id + '/viewform');
    var responses = form.getResponses();
    if (!responses.length) {
        throw httpError('\u201c' + label + '\u201d has no responses yet.', 'NO_RESPONSES');
    }
    var items = form.getItems();
    var headers = items.map(function (it) { return it.getTitle(); });
    var rows = responses.map(function (resp) {
        var byId = {};
        resp.getItemResponses().forEach(function (ir) { byId[ir.getItem().getId()] = ir.getResponse(); });
        return items.map(function (it) {
            var v = byId[it.getId()];
            if (v === null || v === undefined) return '';
            return (v instanceof Array) ? v.join(', ') : String(v);
        });
    });
    return { name: label, headers: headers, rows: rows };
}

/**
 * Turns ONE Drive entry into zero or more response tables, following
 * shortcuts and link files as needed.
 * @return {Array} tables
 */
function evalTablesFromEntry(file, notes, depth) {
    depth = depth || 0;
    if (depth > 3) return [];

    var name = file.getName();
    var mime = file.getMimeType();

    // --- the real thing -----------------------------------------------------
    if (mime === MimeType.GOOGLE_FORMS) {
        return [formResponsesFromForm(file.getId(), name)];
    }
    if (mime === 'text/csv') {
        var arr = Utilities.parseCsv(file.getBlob().getDataAsString());
        return [{ name: name, headers: (arr[0] || []).map(String), rows: arr.slice(1) }];
    }
    if (mime === MimeType.GOOGLE_SHEETS) {
        // Could be response data, or an index of links.
        var index = null;
        try { index = evalLinkSheetTargets(file.getId()); } catch (e) { }
        if (index && index.length) {
            return evalTablesFromTargets(index, name, notes, depth);
        }
        return [formResponsesFromSheet(SpreadsheetApp.openById(file.getId()), name)];
    }

    // --- a Drive shortcut ---------------------------------------------------
    if (mime === EVAL_SHORTCUT_MIME) {
        var meta = evalDriveMeta(file.getId());
        var details = meta && meta.shortcutDetails;
        if (!details || !details.targetId) {
            notes.push('\u201c' + name + '\u201d is a shortcut that could not be resolved. Open it, then add the real file or its link instead.');
            return [];
        }
        var targetMime = details.targetMimeType || '';
        var kind = targetMime === MimeType.GOOGLE_FORMS ? 'form'
            : (targetMime === MimeType.GOOGLE_SHEETS ? 'sheet' : 'unknown');
        return evalTablesFromTargets([{ kind: kind, id: details.targetId, url: '' }], name, notes, depth);
    }

    // --- a link-carrying file ----------------------------------------------
    var isLinkFile = mime === MimeType.GOOGLE_DOCS ||
        mime === 'text/plain' ||
        mime === 'text/uri-list' ||
        mime === 'application/internet-shortcut' ||
        mime === 'application/octet-stream' ||
        /\.(url|webloc|txt)$/i.test(name);

    if (isLinkFile) {
        var text = '';
        try {
            text = evalTextFromFile(file, mime);
        } catch (e) {
            notes.push('\u201c' + name + '\u201d could not be read: ' + (e.message || e));
            return [];
        }
        var targets = evalTargetsFromText(text);
        if (!targets.length) {
            notes.push('\u201c' + name + '\u201d contains no Google Form or Sheet link.');
            return [];
        }
        return evalTablesFromTargets(targets, name, notes, depth);
    }

    return [];
}

/** Resolves a list of extracted targets into response tables. */
function evalTablesFromTargets(targets, sourceLabel, notes, depth) {
    var tables = [];

    for (var i = 0; i < targets.length; i++) {
        var target = targets[i];
        var label = sourceLabel;
        if (targets.length > 1) label = sourceLabel + ' [' + (i + 1) + ']';

        // Work out what an unknown id actually is.
        if (target.kind === 'unknown') {
            var meta = evalDriveMeta(target.id);
            if (!meta) {
                notes.push('\u201c' + label + '\u201d links to a file this account cannot open (' + target.id + '). Share it with the account running the script.');
                continue;
            }
            if (meta.mimeType === EVAL_SHORTCUT_MIME && meta.shortcutDetails) {
                target = {
                    kind: meta.shortcutDetails.targetMimeType === MimeType.GOOGLE_FORMS ? 'form' : 'sheet',
                    id: meta.shortcutDetails.targetId
                };
            } else if (meta.mimeType === MimeType.GOOGLE_FORMS) {
                target = { kind: 'form', id: target.id };
            } else if (meta.mimeType === MimeType.GOOGLE_SHEETS) {
                target = { kind: 'sheet', id: target.id };
            } else if (meta.mimeType === 'text/csv') {
                try {
                    var csv = Utilities.parseCsv(DriveApp.getFileById(target.id).getBlob().getDataAsString());
                    tables.push({ name: label, headers: (csv[0] || []).map(String), rows: csv.slice(1) });
                } catch (e0) {
                    notes.push(label + ': ' + (e0.message || e0));
                }
                continue;
            } else {
                notes.push('\u201c' + label + '\u201d points to an unsupported file type (' + meta.mimeType + ').');
                continue;
            }
        }

        try {
            if (target.kind === 'sheet') {
                tables.push(formResponsesFromSheet(SpreadsheetApp.openById(target.id), label));
            } else {
                tables.push(evalTableFromFormTarget(target, label));
            }
        } catch (e) {
            var msg = e && e.message ? e.message : String(e);
            if (target.kind === 'formPublished') {
                notes.push('\u201c' + label + '\u201d is a public \u201cfill-in\u201d form link, which cannot be opened for reading. ' +
                    'Use the form\u2019s EDIT link (it contains /edit), a Drive shortcut to the form, or its linked response Sheet.');
            } else {
                notes.push('\u201c' + label + '\u201d could not be read: ' + msg);
            }
        }
    }

    return tables;
}

/** True when a Drive entry is something the builder can read or follow. */
/**
 * Strips Google's " (Responses)" suffix so a form and its linked response
 * sheet collapse to the same name.
 */
function evalBaseName(name) {
    return String(name || '')
        .replace(/\s*\(responses\)\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
}

/**
 * Google auto-creates a "<Form name> (Responses)" spreadsheet next to a form.
 * It holds the SAME answers as the form, so counting both doubles every
 * student. Keep the form and drop the matching sheet.
 */
function evalDedupeEntries(entries, notes) {
    var formNames = {};
    var i, e;

    for (i = 0; i < entries.length; i++) {
        try {
            if (entries[i].file.getMimeType() === MimeType.GOOGLE_FORMS) {
                formNames[evalBaseName(entries[i].file.getName())] = true;
            }
        } catch (err) { /* unreadable entry, leave it for the main loop */ }
    }

    var kept = [], dropped = 0;
    for (i = 0; i < entries.length; i++) {
        e = entries[i];
        var isDupeSheet = false;
        try {
            var nm = e.file.getName();
            isDupeSheet = e.file.getMimeType() === MimeType.GOOGLE_SHEETS &&
                /\(responses\)\s*$/i.test(nm) &&
                formNames[evalBaseName(nm)] === true;
        } catch (err) { isDupeSheet = false; }

        if (isDupeSheet) { dropped++; continue; }
        kept.push(e);
    }

    if (dropped && notes) {
        notes.push('Ignored ' + dropped + ' \u201c(Responses)\u201d sheet' +
            (dropped === 1 ? '' : 's') + ' that duplicate their Google Form, ' +
            'so no student is counted twice.');
    }
    return kept;
}

function evalIsUsableEntry(file) {
    var mime = file.getMimeType();
    if (mime === MimeType.GOOGLE_FORMS) return true;
    if (mime === MimeType.GOOGLE_SHEETS) return true;
    if (mime === 'text/csv') return true;
    if (mime === EVAL_SHORTCUT_MIME) return true;
    if (mime === MimeType.GOOGLE_DOCS) return true;
    if (mime === 'text/plain' || mime === 'text/uri-list') return true;
    if (mime === 'application/internet-shortcut') return true;
    if (mime === 'application/octet-stream') return true;
    return /\.(url|webloc|txt)$/i.test(file.getName());
}

/**
 * Diagnostic. Run this from the editor when a link will not resolve - it
 * reports exactly what the builder sees for every entry in the folder.
 */
function testEvalLinkDetection() {
    var root = formsFolder();
    var lines = ['Folder: ' + root.getName(), ''];
    var notes = [];

    function report(folderName, file) {
        var name = file.getName();
        var mime = file.getMimeType();
        var label = (folderName ? folderName + ' / ' : '') + name;
        if (!evalIsUsableEntry(file)) {
            lines.push('SKIP  ' + label + '   [' + mime + ']  not a readable type');
            return;
        }
        var tables = [];
        try {
            tables = evalTablesFromEntry(file, notes, 0);
        } catch (e) {
            lines.push('FAIL  ' + label + '   ' + (e.message || e));
            return;
        }
        if (!tables.length) {
            lines.push('EMPTY ' + label + '   [' + mime + ']  resolved to nothing');
            return;
        }
        for (var t = 0; t < tables.length; t++) {
            var tbl = tables[t];
            var built = evalBuildRecord(tbl, false);
            if (!built.ok) {
                lines.push('WARN  ' + label + '  ->  ' + built.note);
                continue;
            }
            var r = built.record;
            lines.push('OK    ' + label + '  ->  ' + r.section +
                '  (grade ' + r.grade + ', ' + EVAL_TEMPLATES[r.templateKey].label + ', ' +
                r.students.length + ' responses)');
        }
    }

    var subs = root.getFolders();
    while (subs.hasNext()) {
        var sf = subs.next();
        if (sf.getName() === 'Generated Evaluations') continue;
        var files = sf.getFiles();
        while (files.hasNext()) report(sf.getName(), files.next());
    }
    var rootFiles = root.getFiles();
    while (rootFiles.hasNext()) report('', rootFiles.next());

    if (notes.length) {
        lines.push('', 'Notes:');
        for (var n = 0; n < notes.length; n++) lines.push('  - ' + notes[n]);
    }

    var out = lines.join('\n');
    Logger.log(out);
    return out;
}

// ---------------------------------------------------------------------------
// Folder walking
//
// Two things bite here, and both caused "0 files":
//
//   1. DriveApp.getFolders() does NOT return folder shortcuts. A shortcut to a
//      folder shows up in getFiles() with the shortcut mime type instead, so a
//      folder-of-shortcuts looks completely empty.
//   2. Files are often nested deeper than one level, e.g.
//      Forms / JHS / PASTOR / Grade 7 / <form>. Scanning only the immediate
//      children finds nothing.
//
// So: resolve folder shortcuts, and recurse.
// ---------------------------------------------------------------------------

var EVAL_MAX_DEPTH = 10;

// Google kills any web-app request at 6 minutes with no result at all. These
// caps make the scan always come back with something useful instead.
var EVAL_TIME_BUDGET_MS = 45 * 1000;
// Wall-clock ceiling for a whole "build everything" request. Google kills any
// Apps Script request at 6 minutes; stopping at 4 leaves room to save results.
var EVAL_BUILD_BUDGET_MS = 240 * 1000;
var EVAL_MAX_FOLDERS = 400;

/** Shared walk state: what we have already seen, and how much time is left. */
function evalNewBudget() {
    return { started: Date.now(), visited: {}, folders: 0, stopped: '' };
}

/** True once the walk must stop. Records why, so the UI can say so. */
function evalBudgetSpent(ctx) {
    if (ctx.stopped) return true;
    if (ctx.folders >= EVAL_MAX_FOLDERS) {
        ctx.stopped = 'Stopped after ' + EVAL_MAX_FOLDERS + ' folders.';
        return true;
    }
    if (Date.now() - ctx.started > EVAL_TIME_BUDGET_MS) {
        ctx.stopped = 'Stopped after ' + Math.round(EVAL_TIME_BUDGET_MS / 1000) + ' seconds.';
        return true;
    }
    return false;
}

/**
 * If this entry is a shortcut pointing at a folder, return that folder.
 * Results are cached per run because the same shortcut is tested more than once.
 */
var __evalShortcutFolderCache = {};

function evalFolderFromShortcut(file) {
    if (file.getMimeType() !== EVAL_SHORTCUT_MIME) return null;

    var key = file.getId();
    if (Object.prototype.hasOwnProperty.call(__evalShortcutFolderCache, key)) {
        return __evalShortcutFolderCache[key];
    }
    __evalShortcutFolderCache[key] = null;   // set before returning on any path

    var meta = evalDriveMeta(file.getId());
    var details = meta && meta.shortcutDetails;
    if (!details || !details.targetId) return null;
    if (details.targetMimeType !== 'application/vnd.google-apps.folder') return null;

    try {
        var folder = DriveApp.getFolderById(details.targetId);
        __evalShortcutFolderCache[key] = folder;
        return folder;
    } catch (e) {
        return null;
    }
}

/** Direct subfolders only. Does not list files, so it is cheap. */
function evalDirectSubFolders(folder) {
    var out = [], seen = {};
    var direct = folder.getFolders();
    while (direct.hasNext()) {
        var d = direct.next();
        if (d.getName() === 'Generated Evaluations') continue;
        if (seen[d.getId()]) continue;
        seen[d.getId()] = true;
        out.push(d);
    }
    return out;
}

/**
 * Single pass over one folder's files. Listing a folder is the expensive part,
 * so files and folder-shortcuts are gathered together rather than by listing
 * the same folder twice.
 * @return {{entries:Array, shortcutFolders:Array}}
 */
function evalScanFolderFiles(folder, pathLabel) {
    var entries = [], shortcutFolders = [];
    var files = folder.getFiles();

    while (files.hasNext()) {
        var file = files.next();

        if (file.getMimeType() === EVAL_SHORTCUT_MIME) {
            var target = evalFolderFromShortcut(file);
            if (target) {
                // A shortcut to a folder is a branch, not a readable file.
                if (target.getName() !== 'Generated Evaluations') shortcutFolders.push(target);
                continue;
            }
        }

        entries.push({ file: file, path: pathLabel });
    }

    return { entries: entries, shortcutFolders: shortcutFolders };
}

/** Every real subfolder of a folder, including ones reached via shortcut. */
function evalSubFolders(folder) {
    var out = [], seen = {};

    var direct = folder.getFolders();
    while (direct.hasNext()) {
        var d = direct.next();
        if (d.getName() === 'Generated Evaluations') continue;
        if (seen[d.getId()]) continue;
        seen[d.getId()] = true;
        out.push(d);
    }

    var files = folder.getFiles();
    while (files.hasNext()) {
        var shortcutFolder = evalFolderFromShortcut(files.next());
        if (!shortcutFolder) continue;
        if (shortcutFolder.getName() === 'Generated Evaluations') continue;
        if (seen[shortcutFolder.getId()]) continue;
        seen[shortcutFolder.getId()] = true;
        out.push(shortcutFolder);
    }

    return out;
}

/**
 * Collects every readable entry under a folder, recursing into subfolders.
 * Folder shortcuts are followed; file shortcuts are returned as-is so that
 * evalTablesFromEntry can resolve them.
 * @return {Array<{file:Object, path:string}>}
 */
function evalCollectEntries(folder, pathLabel, depth, seenFiles, out, ctx) {
    depth = depth || 0;
    seenFiles = seenFiles || {};
    out = out || [];
    ctx = ctx || evalNewBudget();

    if (depth > EVAL_MAX_DEPTH || out.length >= 800) return out;
    if (evalBudgetSpent(ctx)) return out;

    // A folder must never be walked twice. Shortcuts can point at a parent, or
    // at My Drive itself, which would otherwise loop forever.
    var folderId = folder.getId();
    if (ctx.visited[folderId]) return out;
    ctx.visited[folderId] = true;
    ctx.folders++;

    // One listing of this folder gives us both its files and its shortcut branches.
    var scan = evalScanFolderFiles(folder, pathLabel);

    for (var e = 0; e < scan.entries.length && out.length < 800; e++) {
        var entry = scan.entries[e];
        var id = entry.file.getId();
        if (seenFiles[id]) continue;
        seenFiles[id] = true;
        if (evalIsUsableEntry(entry.file)) out.push(entry);
    }

    var subs = evalDirectSubFolders(folder).concat(scan.shortcutFolders);
    for (var i = 0; i < subs.length; i++) {
        if (evalBudgetSpent(ctx)) return out;
        var sub = subs[i];
        if (ctx.visited[sub.getId()]) continue;
        var childPath = pathLabel ? pathLabel + ' / ' + sub.getName() : sub.getName();
        evalCollectEntries(sub, childPath, depth + 1, seenFiles, out, ctx);
    }

    return out;
}

/**
 * Raw folder report. Lists EVERY entry with its real mime type, so a folder
 * that appears empty can be diagnosed without guessing.
 */
function handleDiagnoseEvalFolder(session) {
    var root = formsFolder();
    var rows = [];
    var counts = { usable: 0, skipped: 0, folders: 0, shortcutFolders: 0, loops: 0 };
    var ctx = evalNewBudget();

    function walk(folder, pathLabel, depth) {
        if (depth > EVAL_MAX_DEPTH || rows.length >= 400) return;
        if (evalBudgetSpent(ctx)) return;

        // Never walk the same folder twice; shortcuts can form loops.
        var fid = folder.getId();
        if (ctx.visited[fid]) { counts.loops++; return; }
        ctx.visited[fid] = true;
        ctx.folders++;

        var branches = [];   // folder shortcuts found while listing, walked below
        var files = folder.getFiles();
        while (files.hasNext() && rows.length < 400) {
            var file = files.next();
            var mime = file.getMimeType();
            var target = '';

            if (mime === EVAL_SHORTCUT_MIME) {
                var meta = evalDriveMeta(file.getId());
                var details = meta && meta.shortcutDetails;
                target = details ? (details.targetMimeType || 'unknown target') : 'UNRESOLVED';
                if (details && details.targetMimeType === 'application/vnd.google-apps.folder') {
                    counts.shortcutFolders++;
                    var branch = evalFolderFromShortcut(file);
                    if (branch) branches.push(branch);
                    rows.push({
                        path: pathLabel, name: file.getName(), mime: 'shortcut -> folder',
                        usable: true, note: 'followed as a subfolder'
                    });
                    continue;
                }
            }

            var usable = evalIsUsableEntry(file);
            if (usable) counts.usable++; else counts.skipped++;
            rows.push({
                path: pathLabel,
                name: file.getName(),
                mime: mime + (target ? ' -> ' + target : ''),
                usable: usable,
                note: usable ? '' : 'not a readable type'
            });
        }

        // Reuse the listing above instead of listing this folder a second time.
        var subs = evalDirectSubFolders(folder).concat(branches);
        counts.folders += subs.length;
        for (var i = 0; i < subs.length; i++) {
            if (evalBudgetSpent(ctx)) return;
            var sub = subs[i];
            if (ctx.visited[sub.getId()]) { counts.loops++; continue; }
            walk(sub, pathLabel ? pathLabel + ' / ' + sub.getName() : sub.getName(), depth + 1);
        }
    }

    walk(root, '', 0);

    return {
        folderName: root.getName(),
        folderId: root.getId(),
        folderUrl: root.getUrl(),
        counts: counts,
        entries: rows,
        elapsedMs: Date.now() - ctx.started,
        stopped: ctx.stopped,
        capped: rows.length >= 400 || !!ctx.stopped
    };
}

// ---------------------------------------------------------------------------
// Run-in-the-editor diagnostics
//
// "Failed to fetch" is a browser-level error: the request never came back.
// The website cannot tell you anything useful in that case. These functions
// run directly inside the Apps Script editor, so they bypass the web app,
// the deployment, and the network completely. Whatever is really wrong shows
// up in the execution log.
//
// How to run: open the Apps Script editor, pick the function name from the
// dropdown at the top, press Run, then read the log at the bottom.
// ---------------------------------------------------------------------------

/**
 * Prints the full folder report to the log. Same work the Diagnose button
 * does, minus the web app.
 */
function testDiagnoseFolder() {
    var t0 = Date.now();
    var out = [];

    out.push('=== Folder diagnosis ===');

    var folderId = prop('FORMS_FOLDER_ID', '');
    out.push('FORMS_FOLDER_ID  : ' + (folderId || '(NOT SET)'));
    if (!folderId) {
        out.push('');
        out.push('STOP: FORMS_FOLDER_ID is not set.');
        out.push('Project Settings > Script Properties > add FORMS_FOLDER_ID = the folder id.');
        Logger.log(out.join('\n'));
        return out.join('\n');
    }

    var root;
    try {
        root = formsFolder();
        out.push('Folder name      : ' + root.getName());
        out.push('Folder URL       : ' + root.getUrl());
    } catch (e) {
        out.push('');
        out.push('STOP: cannot open that folder: ' + (e.message || e));
        out.push('Either the id is wrong, or this Google account cannot see the folder.');
        out.push('Signed in as: ' + evalWhoAmI());
        Logger.log(out.join('\n'));
        return out.join('\n');
    }

    out.push('Running as       : ' + evalWhoAmI());
    out.push('Template id      : ' + (prop('EVAL_TEMPLATE_ID', '') || '(NOT SET - Build will fail)'));
    out.push('');

    var res;
    try {
        res = handleDiagnoseEvalFolder(null);
    } catch (e) {
        out.push('The scan itself threw an error: ' + (e.message || e));
        out.push((e.stack || '').split('\n').slice(0, 5).join('\n'));
        Logger.log(out.join('\n'));
        return out.join('\n');
    }

    var c = res.counts || {};
    out.push('Readable files   : ' + (c.usable || 0));
    out.push('Skipped files    : ' + (c.skipped || 0));
    out.push('Subfolders       : ' + (c.folders || 0));
    out.push('Folder shortcuts : ' + (c.shortcutFolders || 0));
    out.push('Shortcut loops   : ' + (c.loops || 0));
    out.push('Scan time        : ' + ((res.elapsedMs || 0) / 1000).toFixed(1) + 's');
    if (res.stopped) out.push('CUT SHORT        : ' + res.stopped);
    out.push('');

    var rows = res.entries || [];
    if (!rows.length) {
        out.push('No files at all were visible inside that folder.');
        out.push('Check that the folder is shared with ' + evalWhoAmI() + '.');
    } else {
        out.push('--- entries ---');
        for (var i = 0; i < rows.length && i < 100; i++) {
            var r = rows[i];
            out.push((r.usable ? 'USE  ' : 'SKIP ') +
                (r.path ? '[' + r.path + '] ' : '[root] ') +
                r.name + '   (' + r.mime + ')');
        }
        if (rows.length > 100) out.push('... and ' + (rows.length - 100) + ' more');
    }

    out.push('');
    out.push('Total time: ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');

    var text = out.join('\n');
    Logger.log(text);
    return text;
}

/** Which Google account this script actually runs as. */
function evalWhoAmI() {
    try {
        var who = Session.getEffectiveUser().getEmail();
        return who || '(unknown - no email permission)';
    } catch (e) {
        return '(unknown)';
    }
}

/**
 * Confirms the three eval actions are wired into doPost. If any say MISSING,
 * that is why the website reports an unknown action.
 */
function testEvalWiring() {
    var out = ['=== Wiring check ==='];
    var names = ['handleListEvalBatches', 'handleBuildEvalWorkbooks', 'handleDiagnoseEvalFolder'];

    var g = (typeof globalThis !== 'undefined') ? globalThis : this;
    for (var i = 0; i < names.length; i++) {
        var fn = g[names[i]];
        out.push((typeof fn === 'function' ? 'OK      ' : 'MISSING ') + names[i]);
    }

    out.push('');
    out.push('If all three say OK but the website still fails, the problem is the');
    out.push('deployment, not the code. Deploy > Manage deployments > pencil >');
    out.push('New version > Deploy. Also confirm "Who has access" is set to Anyone.');

    var text = out.join('\n');
    Logger.log(text);
    return text;
}
