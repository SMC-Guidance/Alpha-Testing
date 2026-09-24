"use strict";
/* ============================================================================
 *  SMC GUIDANCE - BACKEND (Code.gs)
 *  Patched build: security fixes (issues 1-5) + non-technical admin helpers.
 *
 *  NEW ADMIN, NOT A PROGRAMMER? READ THIS FIRST:
 *  You almost never touch this file. Everyday admin work (adding/removing
 *  counselors, unlocking the site, maintenance mode, share links, etc.) is
 *  ALL done from the website itself - see ADMIN-HANDOVER.md in the download.
 *
 *  You only open this file for three rare jobs:
 *    1) First-time setup on a new Google account -> run  oneClickSetup()
 *    2) Checking everything is healthy           -> run  healthCheck()
 *    3) Resetting a lost admin password          -> run  resetAdmin()
 *  AFTER ANY CHANGE HERE YOU MUST REDEPLOY:
 *  Deploy > Manage deployments > edit the Web app > Version: New version > Deploy.
 *  (Full steps: HOW-TO-FIX-ONLINE-SAVING.md)
 *
 *  SCRIPT PROPERTIES used (Project Settings > Script properties):
 *    SHEET_ID        (required) the private Google Sheet's id
 *    REG_CODE        (required) staff registration code
 *    SESSION_SECRET  (required) auto-created by oneClickSetup() - signs logins
 *    PEPPER          (required) auto-created by oneClickSetup() - password pepper
 *    SESSION_TTL_H   (optional) login length in hours (default 4)
 *    MAX_ATTEMPTS    (optional) failed logins before the site locks (default 10)
 *    UNLOCK_CODE     (optional) code to lift a site lock (falls back to REG_CODE)
 *    MAINT_CODE      (optional) maintenance passcode (falls back to UNLOCK/REG)
 *    FORMS_FOLDER_ID (optional) Drive folder scanned for evaluation forms
 *    MAIL_FROM / MAIL_FROM_NAME / MAIL_REPLY_TO (optional) outgoing email identity
 *    SHARE_TTL_DAYS  (optional) how long share links live (default 7)
 *  NEVER share PEPPER or SESSION_SECRET. They live only here.
 * ========================================================================== */
// One-click first-time setup for a NEW admin on a NEW Google account.
// Safe to run repeatedly: it only fills in what is MISSING and will NOT
// overwrite existing secrets (changing PEPPER/SESSION_SECRET would log
// everyone out and invalidate stored passwords). Run it, then read View > Logs.
function oneClickSetup() {
    var p = props();
    var made = [];
    if (!p.getProperty('SESSION_SECRET')) { p.setProperty('SESSION_SECRET', bootstrapRandomHex(32)); made.push('SESSION_SECRET'); }
    if (!p.getProperty('PEPPER')) { p.setProperty('PEPPER', bootstrapRandomHex(32)); made.push('PEPPER'); }
    if (!p.getProperty('SESSION_TTL_H')) { p.setProperty('SESSION_TTL_H', '4'); made.push('SESSION_TTL_H'); }
    if (!p.getProperty('MAX_ATTEMPTS')) { p.setProperty('MAX_ATTEMPTS', '10'); made.push('MAX_ATTEMPTS'); }
    if (!p.getProperty('SHARE_TTL_DAYS')) { p.setProperty('SHARE_TTL_DAYS', '7'); made.push('SHARE_TTL_DAYS'); }
    Logger.log(made.length ? ('Created defaults for: ' + made.join(', ')) : 'All secrets already existed - nothing changed.');
    Logger.log('STILL REQUIRED (set these yourself in Script Properties if missing):');
    Logger.log('  SHEET_ID = ' + (p.getProperty('SHEET_ID') ? 'set' : '>>> MISSING - paste your Google Sheet id'));
    Logger.log('  REG_CODE = ' + (p.getProperty('REG_CODE') ? 'set' : '>>> MISSING - choose a staff registration code'));
    Logger.log('Next: run healthCheck(), then seed the admin with resetAdmin().');
    return 'Setup done. Open View > Logs to read the results.';
}
// Plain-language health report. Run it, then read View > Logs.
function healthCheck() {
    var p = props();
    function yn(k) { return p.getProperty(k) ? 'OK' : 'MISSING'; }
    Logger.log('=== SMC Guidance health check ===');
    Logger.log('SHEET_ID ........ ' + yn('SHEET_ID'));
    Logger.log('REG_CODE ........ ' + yn('REG_CODE'));
    Logger.log('SESSION_SECRET .. ' + yn('SESSION_SECRET'));
    Logger.log('PEPPER .......... ' + yn('PEPPER'));
    Logger.log('UNLOCK_CODE ..... ' + (p.getProperty('UNLOCK_CODE') ? 'set' : 'not set (will use REG_CODE)'));
    Logger.log('Site locked? .... ' + (secIsLocked() ? 'YES - lift it with the unlock code' : 'no'));
    Logger.log('Maintenance? .... ' + (siteMaintOn() ? 'ON' : 'off'));
    try {
        var users = readUsers();
        Logger.log('User accounts ... ' + users.length);
        var admin = findUser('admin');
        Logger.log('admin account ... ' + (admin ? ('OK (role ' + admin.role + ')') : '>>> MISSING - run resetAdmin()'));
    } catch (e) {
        Logger.log('>>> Could not read the Users sheet: ' + e.message);
    }
    return 'Health check complete. Open View > Logs.';
}
var FIELD_MAP = {
    name: 1, grade: 2, age: 3, sex: 4, referralSource: 5, teacherReferral: 6,
    modality: 7, date: 8, recordNo: 9, sessionNo: 10, issueCategory: 11,
    issueDescription: 12, grooming: 13, eyeContact: 14, speech: 15,
    verbalComprehension: 16, grossMotor: 17, fineMotor: 18, compliance: 19,
    emotionalTone: 20, emotionalManagement: 21, observationRemarks: 22,
    studentReport: 23, actionsTaken: 24, progressEvaluation: 25, designate: 26
};
function doPost(e) {
    try {
        var req = JSON.parse(e.postData.contents || '{}');
        assertCoreConfig();
        var action = req.action;
        var payload = req.payload || {};
        var session = verifyToken(req.token);
        // Revalidate every token against the live account so deletions, role changes,
        // and account locks take effect immediately instead of surviving in a token.
        if (session) {
            var liveUser = findUser(session.username);
            if (!liveUser) session = null;
            else session = { username: liveUser.username, name: liveUser.name, role: liveUser.role, expiresAt: session.expiresAt };
        }
        // Sliding session: if the caller's token is more than halfway to expiry,
        // mint a fresh one and return it (via ok()) so active users stay signed
        // in instead of being logged out at the hard TTL.
        __renewToken = null;
        if (session && session.expiresAt) {
            var _ttlMs = (parseInt(prop('SESSION_TTL_H', '4'), 10) || 4) * 3600 * 1000;
            if ((session.expiresAt - Date.now()) < _ttlMs / 2) {
                __renewToken = makeToken({ username: session.username, name: session.name, role: session.role });
            }
        }
        // Site-wide maintenance gate. Admins keep FULL access so they can work
        // (and lift maintenance) during downtime, and the sign-in handshake is
        // allowed through so an admin can log IN while maintenance is on. The
        // escape hatch (maintOff) and status check (getSiteMaint) are always
        // allowed. Guests and non-admin sessions get the maintenance notice.
        if (siteMaintOn()) {
            var _maintAlways = { maintOff: true, getSiteMaint: true };
            var _maintAuth = { login: true, verify2fa: true, set2faEmail: true, resend2fa: true };
            var _isAdmin = session && session.role === 'admin';
            if (!_maintAlways[action] && !_maintAuth[action] && !_isAdmin) {
                var _mm = handleGetSiteMaint();
                throw httpError(_mm.message || 'The site is temporarily down for maintenance. Please check back soon.', 'MAINTENANCE');
            }
        }
        switch (action) {
            case 'login': return ok(handleLogin(payload));
            case 'register': return ok(handleRegister(payload));
            case 'verify2fa': return ok(handleVerify2fa(payload));
            case 'set2faEmail': return ok(handleSet2faEmail(payload));
            case 'resend2fa': return ok(handleResend2fa(payload));
            case 'publicStats': return ok(handlePublicStats());
            case 'me': return ok(requireAuth(session));
            case 'records': return ok(handleRecords(requireAuth(session)));
            case 'listUsers': return ok(handleListUsers(requireStaff(session)));
            case 'deleteUser': return ok(handleDeleteUser(requireAdmin(session), payload));
            case 'setRole': return ok(handleSetRole(requireAdmin(session), payload));
            case 'listEvaluations': return ok(handleListEvaluations(requireAuth(session)));
            case 'saveEvaluation': return ok(handleSaveEvaluation(requireAuth(session), payload));
            case 'deleteEvaluation': return ok(handleDeleteEvaluation(requireStaff(session), payload));
            case 'evalTemplates': return ok(handleEvalTemplates());
            case 'evalSheetColumns': return ok(handleEvalSheetColumns(requireStaff(session), payload));
            case 'listEvalConfigs': return ok(handleListEvalConfigs(requireStaff(session)));
            case 'saveEvalConfig': return ok(handleSaveEvalConfig(requireStaff(session), payload));
            case 'deleteEvalConfig': return ok(handleDeleteEvalConfig(requireStaff(session), payload));
            case 'processEval': return ok(handleProcessEval(requireStaff(session), payload));
            case 'quickProcessEval': return ok(handleQuickProcess(requireStaff(session), payload));
            case 'listForms': return ok(handleListForms(requireStaff(session)));
            case 'listEvalBatches': return ok(handleListEvalBatches(requireStaff(session)));
            case 'buildEvalWorkbooks': return ok(handleBuildEvalWorkbooks(requireStaff(session), payload));
            case 'diagnoseEvalFolder': return ok(handleDiagnoseEvalFolder(requireStaff(session)));
            case 'listGeneratedEvals': return ok(handleListGeneratedEvals(requireStaff(session)));
            case 'getFormResponses': return ok(handleGetFormResponses(requireStaff(session), payload));
            case 'getMaintenance': return ok(handleGetMaintenance(session));
            case 'setMaintenance': return ok(handleSetMaintenance(requireAdmin(session), payload));
            case 'getProfile': return ok(handleGetProfile(requireAuth(session)));
            case 'saveProfile': return ok(handleSaveProfile(requireAuth(session), payload));
            case 'saveReport': return ok(handleSaveReport(requireAuth(session), payload));
            case 'listReports': return ok(handleListReports(requireAdmin(session)));
            case 'setReportStatus': return ok(handleSetReportStatus(requireAdmin(session), payload));
            case 'listIncidents': return ok(handleListIncidents(requireAuth(session)));
            case 'listClassLists': return ok(handleListClassLists(requireAuth(session)));
            case 'listClassFlags': return ok(handleListClassFlags(requireAuth(session)));
            case 'saveClassFlag': return ok(handleSaveClassFlag(requireStaff(session), payload));
            case 'saveIncident': return ok(handleSaveIncident(requireAuth(session), payload));
            case 'deleteIncident': return ok(handleDeleteIncident(requireStaff(session), payload));
            case 'securityStatus': return ok(handleSecurityStatus());
            case 'unlockSite': return ok(handleUnlockSite(payload));
            case 'getSecurity': return ok(handleGetSecurity(requireAdmin(session)));
            case 'setSecurity': return ok(handleSetSecurity(requireAdmin(session), payload));
            case 'getClassColors': return ok(handleGetClassColors(session));
            case 'setClassColor': return ok(handleSetClassColor(requireAuth(session), payload));
            case 'listRoutine': return ok(handleListRoutine(requireAuth(session)));
            case 'listSchedules': return ok(handleListSchedules(requireAuth(session)));
            case 'saveRoutine': return ok(handleSaveRoutine(requireAuth(session), payload));
            case 'chatPoll': return ok(handleChatPoll(requireAuth(session)));
            case 'getThread': return ok(handleGetThread(requireAuth(session), payload));
            case 'sendMessage': return ok(handleSendMessage(requireAuth(session), payload));
            case 'chatDirectory': return ok(handleChatDirectory(requireAuth(session)));
            case 'chatBroadcast': return ok(handleChatBroadcast(requireStaff(session), payload));
            case 'deleteMessage': return ok(handleDeleteMessage(requireStaff(session), payload));
            case 'setChatMute': return ok(handleSetChatMute(requireStaff(session), payload));
            case 'setPresenceMode': return ok(handleSetPresenceMode(requireStaff(session), payload));
            case 'setPublicKey': return ok(handleSetPublicKey(requireAuth(session), payload));
            case 'getPublicKey': return ok(handleGetPublicKey(requireAuth(session), payload));
            case 'unsendMessage': return ok(handleUnsendMessage(requireAuth(session), payload));
            case 'getSiteMaint': return ok(handleGetSiteMaint());
            case 'setSiteMaint': return ok(handleSetSiteMaint(requireAdmin(session), payload));
            case 'maintOff': return ok(handleMaintOff(payload));
            case 'clearMessages': return ok(handleClearMessages(requireAdmin(session)));
            case 'createShare': return ok(handleCreateShare(requireStaff(session), payload));
            case 'getShared': return ok(handleGetShared(payload));
            case 'listShares': return ok(handleListShares(requireStaff(session)));
            case 'revokeShare': return ok(handleRevokeShare(requireStaff(session), payload));
            default: return fail('Unknown action.', 'BAD_REQUEST');
        }
    }
    catch (err) {
        return fail(err.message || 'Server error.', err.code || 'ERROR');
    }
}
function handleGetMaintenance(session) {
    var raw = prop('MAINTENANCE', '{}');
    var map;
    try {
        map = JSON.parse(raw) || {};
    }
    catch (e) {
        map = {};
    }
    return { maintenance: map };
}
function handleSetMaintenance(session, p) {
    var view = String(p && p.view || '').trim();
    if (!view)
        throw httpError('A view key is required.', 'BAD_REQUEST');
    var raw = prop('MAINTENANCE', '{}');
    var map;
    try {
        map = JSON.parse(raw) || {};
    }
    catch (e) {
        map = {};
    }
    if (p.on)
        map[view] = true;
    else
        delete map[view];
    props().setProperty('MAINTENANCE', JSON.stringify(map));
    return { maintenance: map };
}
function handleGetSiteMaint() {
    var raw = prop('SITE_MAINT', '{}');
    var m;
    try { m = JSON.parse(raw) || {}; } catch (e) { m = {}; }
    return { on: !!m.on, message: String(m.message || ''), by: String(m.by || ''), ts: String(m.ts || '') };
}
function handleSetSiteMaint(session, p) {
    var on = !!(p && p.on);
    // Safety check: never let an admin lock the whole site if there is no
    // passcode configured, or they would be unable to get back in.
    if (on && !maintCode())
        throw httpError('Set a maintenance passcode first. Add MAINT_CODE (or UNLOCK_CODE / REG_CODE) in Apps Script \u2192 Project Settings \u2192 Script Properties before turning maintenance on.', 'CONFIG');
    var message = String(p && p.message || '').trim();
    if (message.length > 500) message = message.slice(0, 500);
    var m = { on: on, message: message, by: session.username, ts: new Date().toISOString() };
    props().setProperty('SITE_MAINT', JSON.stringify(m));
    return { on: m.on, message: m.message, by: m.by, ts: m.ts };
}
// Returns true when the whole site is in maintenance mode.
function siteMaintOn() {
    var raw = prop('SITE_MAINT', '{}');
    try { return !!(JSON.parse(raw) || {}).on; } catch (e) { return false; }
}
// The secret maintenance passcode. Prefers MAINT_CODE, then falls back to the
// existing UNLOCK_CODE / REG_CODE so you can reuse a code you already have.
function maintCode() {
    var c = prop('MAINT_CODE', '');
    if (!c) c = prop('UNLOCK_CODE', '');
    if (!c) c = prop('REG_CODE', '');
    return c;
}
// Escape hatch: turn maintenance OFF with the passcode, WITHOUT a session.
// This is what lets an admin back in while the force-block is active.
function handleMaintOff(p) {
    var code = String(p && p.code || '');
    var expected = maintCode();
    if (!expected)
        throw httpError('No maintenance passcode is configured. An administrator must set MAINT_CODE (or UNLOCK_CODE / REG_CODE) in Script Properties.', 'CONFIG');
    if (!constantTimeEquals(code, expected))
        throw httpError('Incorrect maintenance passcode.', 'AUTH');
    var m = { on: false, message: '', by: 'passcode', ts: new Date().toISOString() };
    props().setProperty('SITE_MAINT', JSON.stringify(m));
    return { on: false };
}
function handleClearMessages(session) {
    var sh = messageSheet();
    var last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent();
    return { cleared: true };
}
var PROFILE_HEADERS = ['username', 'name', 'role', 'notes', 'photo', 'updatedAt'];
function profileSheet() { return sheetOrCreate('Profiles', PROFILE_HEADERS); }
function profileCols(values) {
    var head = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
    return {
        username: head.indexOf('username'), name: head.indexOf('name'), role: head.indexOf('role'),
        notes: head.indexOf('notes'), photo: head.indexOf('photo'), updatedAt: head.indexOf('updatedat')
    };
}
function handleGetProfile(session) {
    var sh = profileSheet();
    var values = sh.getDataRange().getValues();
    var c = profileCols(values);
    var uname = String(session.username).trim().toLowerCase();
    for (var r = 1; r < values.length; r++) {
        if (String(values[r][c.username]).trim().toLowerCase() === uname) {
            return { profile: {
                    name: String(values[r][c.name] || ''), role: String(values[r][c.role] || ''),
                    notes: String(values[r][c.notes] || ''), photo: String(values[r][c.photo] || ''),
                    updatedAt: String(values[r][c.updatedAt] || '')
                } };
        }
    }
    return { profile: { name: '', role: '', notes: '', photo: '', updatedAt: '' } };
}
function handleSaveProfile(session, p) {
    var name = String(p && p.name || '').slice(0, 120);
    var role = String(p && p.role || '').slice(0, 120);
    var notes = String(p && p.notes || '').slice(0, 4000);
    var photo = String(p && p.photo || '');
    if (photo.length > 48000)
        throw httpError('Photo is too large even after compression. Please pick a smaller image.', 'BAD_REQUEST');
    var sh = profileSheet();
    var values = sh.getDataRange().getValues();
    var c = profileCols(values);
    var uname = String(session.username).trim().toLowerCase();
    var now = new Date().toISOString();
    for (var r = 1; r < values.length; r++) {
        if (String(values[r][c.username]).trim().toLowerCase() === uname) {
            sh.getRange(r + 1, c.name + 1).setValue(name);
            sh.getRange(r + 1, c.role + 1).setValue(role);
            sh.getRange(r + 1, c.notes + 1).setValue(notes);
            sh.getRange(r + 1, c.photo + 1).setValue(photo);
            sh.getRange(r + 1, c.updatedAt + 1).setValue(now);
            return { profile: { name: name, role: role, notes: notes, photo: photo, updatedAt: now } };
        }
    }
    sh.appendRow([session.username, name, role, notes, photo, now]);
    return { profile: { name: name, role: role, notes: notes, photo: photo, updatedAt: now } };
}
var REPORT_HEADERS = ['id', 'username', 'name', 'role', 'message', 'status', 'createdAt'];
function reportSheet() { return sheetOrCreate('Reports', REPORT_HEADERS); }
function reportCols(values) {
    var head = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
    return {
        id: head.indexOf('id'), username: head.indexOf('username'), name: head.indexOf('name'),
        role: head.indexOf('role'), message: head.indexOf('message'),
        status: head.indexOf('status'), createdAt: head.indexOf('createdat')
    };
}
function handleSaveReport(session, p) {
    var message = String(p && p.message || '').trim().slice(0, 4000);
    if (!message)
        throw httpError('Report message is required.', 'BAD_REQUEST');
    var sh = reportSheet();
    var id = 'r' + Date.now() + Math.floor(Math.random() * 1000);
    var now = new Date().toISOString();
    sh.appendRow([id, session.username, session.name || '', session.role || '', message, 'Open', now]);
    return { id: id, message: message, status: 'Open', createdAt: now };
}
function handleListReports(session) {
    var sh = reportSheet();
    var values = sh.getDataRange().getValues();
    var c = reportCols(values);
    var out = [];
    for (var r = 1; r < values.length; r++) {
        if (!values[r][c.id] && !values[r][c.message]) continue;
        out.push({
            id: String(values[r][c.id] || ''), username: String(values[r][c.username] || ''),
            name: String(values[r][c.name] || ''), role: String(values[r][c.role] || ''),
            message: String(values[r][c.message] || ''), status: String(values[r][c.status] || 'Open'),
            createdAt: String(values[r][c.createdAt] || '')
        });
    }
    out.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    return out;
}
function handleSetReportStatus(session, p) {
    var id = String(p && p.id || '');
    var status = String(p && p.status || '').slice(0, 40) || 'Open';
    if (!id)
        throw httpError('Report id is required.', 'BAD_REQUEST');
    var sh = reportSheet();
    var values = sh.getDataRange().getValues();
    var c = reportCols(values);
    for (var r = 1; r < values.length; r++) {
        if (String(values[r][c.id]) === id) {
            sh.getRange(r + 1, c.status + 1).setValue(status);
            return { updated: true };
        }
    }
    throw httpError('Report not found.', 'NOT_FOUND');
}
var CLASSLIST_HEADERS = ['level','section','adviser','room','sex','studentNumber','status','name','concern','note'];
var CLASSFLAG_HEADERS = ['studentNumber','flag','note','updatedBy','updatedAt'];
function classListSheet() { return sheetOrCreate('ClassLists', CLASSLIST_HEADERS); }
function classFlagSheet() { return sheetOrCreate('ClassFlags', CLASSFLAG_HEADERS); }
function readClassFlagMap() {
    var vals = classFlagSheet().getDataRange().getValues(), map = {};
    for (var r = 1; r < vals.length; r++) {
        var id = String(vals[r][0] || '').trim();
        if (id) map[id] = { flag: String(vals[r][1] || ''), note: String(vals[r][2] || '') };
    }
    return map;
}
function handleListClassLists(session) {
    var vals = classListSheet().getDataRange().getValues();
    if (vals.length < 2) return { sections: [] };
    var h = vals[0].map(function (x) { return String(x || '').trim().toLowerCase(); });
    function col(n) { return h.indexOf(n.toLowerCase()); }
    var c = { level:col('level'), section:col('section'), adviser:col('adviser'), room:col('room'), sex:col('sex'), id:col('studentNumber'), status:col('status'), name:col('name'), concern:col('concern'), note:col('note') };
    if (c.level < 0 || c.section < 0 || c.id < 0 || c.name < 0) throw httpError('ClassLists sheet headers are invalid. Import the supplied private CSV.', 'CONFIG');
    var flags = readClassFlagMap(), by = {}, out = [];
    for (var r = 1; r < vals.length; r++) {
        var row = vals[r], id = String(row[c.id] || '').trim(), name = String(row[c.name] || '').trim();
        if (!id && !name) continue;
        var level = String(row[c.level] || ''), section = String(row[c.section] || ''), key = level + '||' + section;
        if (!by[key]) { by[key] = { level:level, section:section, adviser:c.adviser >= 0 ? String(row[c.adviser] || '') : '', room:c.room >= 0 ? String(row[c.room] || '') : '', students:[] }; out.push(by[key]); }
        var override = flags[id] || {};
        by[key].students.push({ sex:c.sex >= 0 ? String(row[c.sex] || '') : '', lrn:id, status:c.status >= 0 ? String(row[c.status] || '') : '', name:name, flag:override.flag != null ? override.flag : (c.concern >= 0 ? String(row[c.concern] || '') : ''), note:override.note != null ? override.note : (c.note >= 0 ? String(row[c.note] || '') : '') });
    }
    return { sections: out };
}
function handleListClassFlags(session) { return { flags: readClassFlagMap() }; }
function handleSaveClassFlag(session, p) {
    var id = String(p && (p.lrn || p.studentNumber) || '').trim().slice(0, 40);
    var flag = String(p && p.flag || '').trim();
    var note = String(p && p.note || '').trim().slice(0, 2000);
    if (!id) throw httpError('Student number is required.', 'BAD_REQUEST');
    if (flag && ['Behavior','Academic','Close Monitoring'].indexOf(flag) === -1) throw httpError('Invalid concern type.', 'BAD_REQUEST');
    var sh = classFlagSheet(), vals = sh.getDataRange().getValues(), now = new Date().toISOString();
    for (var r = 1; r < vals.length; r++) if (String(vals[r][0] || '').trim() === id) {
        if (!flag && !note) sh.deleteRow(r + 1); else sh.getRange(r + 1, 2, 1, 4).setValues([[flag,note,session.username,now]]);
        return { saved:true };
    }
    if (flag || note) sh.appendRow([id,flag,note,session.username,now]);
    return { saved:true };
}

var CLASSCOLOR_HEADERS = ['key', 'color', 'updatedBy', 'updatedAt'];
function classColorSheet() { return sheetOrCreate('ClassColors', CLASSCOLOR_HEADERS); }
function handleGetClassColors(session) {
    var sh = classColorSheet();
    var values = sh.getDataRange().getValues();
    var map = {};
    for (var r = 1; r < values.length; r++) {
        var key = String(values[r][0] || '').trim();
        var color = String(values[r][1] || '').trim();
        if (key && color) map[key] = color;
    }
    return { colors: map };
}
function handleSetClassColor(session, p) {
    var key = String(p && p.key || '').trim().slice(0, 120);
    var color = String(p && p.color || '').trim().slice(0, 9);
    if (!key)
        throw httpError('A colour key is required.', 'BAD_REQUEST');
    if (color && !/^#[0-9a-fA-F]{6}$/.test(color))
        throw httpError('Invalid colour.', 'BAD_REQUEST');
    var sh = classColorSheet();
    var values = sh.getDataRange().getValues();
    var now = new Date().toISOString();
    for (var r = 1; r < values.length; r++) {
        if (String(values[r][0] || '').trim() === key) {
            if (color) {
                sh.getRange(r + 1, 2).setValue(color);
                sh.getRange(r + 1, 3).setValue(session.username || '');
                sh.getRange(r + 1, 4).setValue(now);
            } else {
                sh.deleteRow(r + 1);
            }
            return { key: key, color: color };
        }
    }
    if (color)
        sh.appendRow([key, color, session.username || '', now]);
    return { key: key, color: color };
}
var ROUTINE_HEADERS = ['lrn', 'status', 'date', 'notes', 'dropout', 'updatedBy', 'updatedAt'];
function routineSheet() { return sheetOrCreate('RoutineInterviews', ROUTINE_HEADERS); }
function riDateStr(v) {
    if (v instanceof Date)
        return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var s = String(v == null ? '' : v).trim();
    if (s.charAt(0) === "'") s = s.slice(1);
    return s;
}
function handleListRoutine(session) {
    var sh = routineSheet();
    var values = sh.getDataRange().getValues();
    var map = {};
    for (var r = 1; r < values.length; r++) {
        var lrn = String(values[r][0] || '').trim();
        if (!lrn) continue;
        map[lrn] = {
            status: String(values[r][1] || 'Pending').trim() || 'Pending',
            date: riDateStr(values[r][2]),
            notes: String(values[r][3] == null ? '' : values[r][3]),
            dropout: values[r][4] === true || String(values[r][4]).toLowerCase() === 'true' || String(values[r][4]).toLowerCase() === 'yes'
        };
    }
    return { records: map };
}
function handleSaveRoutine(session, p) {
    var lrn = String(p && p.lrn || '').trim().slice(0, 40);
    if (!lrn)
        throw httpError('A student is required.', 'BAD_REQUEST');
    var status = String(p && p.status || 'Pending').trim();
    if (['Pending', 'Scheduled', 'Done'].indexOf(status) === -1) status = 'Pending';
    var date = String(p && p.date || '').trim().slice(0, 20);
    var notes = String((p && p.notes) == null ? '' : p.notes).slice(0, 2000);
    var dropout = (p && p.dropout) === true;
    var sh = routineSheet();
    var values = sh.getDataRange().getValues();
    var now = new Date().toISOString();
    for (var r = 1; r < values.length; r++) {
        if (String(values[r][0] || '').trim() === lrn) {
            sh.getRange(r + 1, 2, 1, 6).setValues([[status, date, notes, dropout, session.username || '', now]]);
            return { lrn: lrn, status: status, date: date, notes: notes, dropout: dropout };
        }
    }
    sh.appendRow([lrn, status, date, notes, dropout, session.username || '', now]);
    return { lrn: lrn, status: status, date: date, notes: notes, dropout: dropout };
}
var SCHEDULE_HEADERS = ['id','type','label','full','grade','gnum','adviser','section','gridJson'];
function scheduleSheet() { return sheetOrCreate('Schedules', SCHEDULE_HEADERS); }
function handleListSchedules(session) {
    var vals = scheduleSheet().getDataRange().getValues();
    if (vals.length < 2) return { schedules: [] };
    var h = vals[0].map(function (x) { return String(x || '').trim().toLowerCase(); });
    function c(n) { return h.indexOf(n.toLowerCase()); }
    var ci = { id:c('id'), type:c('type'), label:c('label'), full:c('full'), grade:c('grade'), gnum:c('gnum'), adviser:c('adviser'), section:c('section'), grid:c('gridJson') };
    if (ci.id < 0 || ci.type < 0 || ci.label < 0 || ci.grid < 0) throw httpError('Schedules sheet headers are invalid. Import the supplied private CSV.', 'CONFIG');
    var out = [];
    for (var r = 1; r < vals.length; r++) {
        if (!String(vals[r][ci.id] || '').trim()) continue;
        var grid = [];
        try { grid = JSON.parse(String(vals[r][ci.grid] || '[]')); } catch (e) { grid = []; }
        out.push({ id:String(vals[r][ci.id] || ''), type:String(vals[r][ci.type] || ''), label:String(vals[r][ci.label] || ''), full:ci.full >= 0 ? String(vals[r][ci.full] || '') : '', grade:ci.grade >= 0 ? String(vals[r][ci.grade] || '') : '', gnum:ci.gnum >= 0 ? Number(vals[r][ci.gnum] || 0) : 0, adviser:ci.adviser >= 0 ? String(vals[r][ci.adviser] || '') : '', section:ci.section >= 0 ? String(vals[r][ci.section] || '') : '', grid:grid });
    }
    return { schedules: out };
}

var PRESENCE_HEADERS = ['username', 'lastSeen'];
var MESSAGE_HEADERS = ['id', 'from', 'to', 'text', 'ts', 'readAt', 'kind'];
function presenceSheet() { return sheetOrCreate('Presence', PRESENCE_HEADERS); }
function messageSheet() { return sheetOrCreate('Messages', MESSAGE_HEADERS); }
function isStaffRoleName(role) { return role === 'admin' || role === 'co-admin'; }
function presenceMillis(v) {
    if (v instanceof Date) return v.getTime();
    if (v === 0 || v) {
        var s = String(v).trim();
        if (!s) return 0;
        if (/^\d+$/.test(s)) return Number(s);
        var t = new Date(s).getTime();
        return isNaN(t) ? 0 : t;
    }
    return 0;
}
function touchPresence(username) {
    var sh = presenceSheet();
    var vals = sh.getDataRange().getValues();
    var now = Date.now();
    for (var r = 1; r < vals.length; r++) {
        if (String(vals[r][0] || '').toLowerCase() === String(username).toLowerCase()) {
            sh.getRange(r + 1, 2).setValue(now);
            return;
        }
    }
    sh.appendRow([username, now]);
}
function readPresence() {
    var sh = presenceSheet();
    var vals = sh.getDataRange().getValues();
    var map = {};
    for (var r = 1; r < vals.length; r++) {
        var u = String(vals[r][0] || '').trim();
        if (u) map[u.toLowerCase()] = presenceMillis(vals[r][1]);
    }
    return map;
}
function handleChatPoll(session) {
    var me = session.username;
    touchPresence(me);
    var meIsStaff = isStaffRole(session.role);
    var users = readUsers();
    var pres = readPresence();
    var flags = readChatFlags();
    var msgs = messageSheet().getDataRange().getValues();
    var now = Date.now();
    var contacts = [];
    var totalUnread = 0;
    for (var i = 0; i < users.length; i++) {
        var u = users[i];
        if (String(u.username).toLowerCase() === String(me).toLowerCase()) continue;
        if (!meIsStaff && isStaffRole(u.role)) continue;
        var unread = 0, lastTs = '', lastText = '';
        for (var r = 1; r < msgs.length; r++) {
            var f = String(msgs[r][1] || ''), t = String(msgs[r][2] || '');
            var involves = (f === me && t === u.username) || (f === u.username && t === me);
            if (!involves) continue;
            var ts = String(msgs[r][4] || '');
            if (ts > lastTs) { lastTs = ts; lastText = String(msgs[r][3] || ''); }
            if (f === u.username && t === me && !String(msgs[r][5] || '').trim()) unread++;
        }
        totalUnread += unread;
        var ms = pres[String(u.username).toLowerCase()] || 0;
        var online = ms ? (now - ms < 120000) : false;
        var lastSeenIso = ms ? new Date(ms).toISOString() : '';
        var fl = flags[String(u.username).toLowerCase()] || {};
        var cmode = fl.mode || (isStaffRole(u.role) ? 'invisible' : 'normal');
        if (cmode === 'invisible') { online = false; lastSeenIso = ''; }
        else if (cmode === 'always') { online = true; }
        contacts.push({ username: u.username, name: u.name, role: u.role, online: !!online, lastSeen: lastSeenIso, unread: unread, lastTs: lastTs, lastText: lastText, muted: !!fl.muted });
    }
    contacts.sort(function (a, b) { return String(b.lastTs || '').localeCompare(String(a.lastTs || '')); });
    var ann = null;
    for (var ar = 1; ar < msgs.length; ar++) {
        if (String(msgs[ar][2] || '') === me && String(msgs[ar][6] || '') === 'announcement') {
            var atext = String(msgs[ar][3] || '');
            if (!atext) continue;
            var ats = String(msgs[ar][4] || '');
            if (!ann || ats > ann.ts) ann = { id: String(msgs[ar][0] || ''), from: String(msgs[ar][1] || ''), text: atext, ts: ats };
        }
    }
    var myFlags = flags[String(me).toLowerCase()] || {};
    var myMode = myFlags.mode || (isStaffRole(session.role) ? 'invisible' : 'normal');
    return { me: me, myRole: session.role, myName: session.name || me, myMode: myMode, contacts: contacts, totalUnread: totalUnread, announcement: ann };
}
function handleGetThread(session, p) {
    var me = session.username;
    touchPresence(me);
    var withUser = String(p && p.withUser || '').trim();
    if (!withUser) throw httpError('A conversation partner is required.', 'BAD_REQUEST');
    var sh = messageSheet();
    var vals = sh.getDataRange().getValues();
    var out = [];
    var toMark = [];
    var now = new Date().toISOString();
    for (var r = 1; r < vals.length; r++) {
        var f = String(vals[r][1] || ''), t = String(vals[r][2] || '');
        var involves = (f === me && t === withUser) || (f === withUser && t === me);
        if (!involves) continue;
        out.push({ id: String(vals[r][0] || ''), from: f, to: t, text: String(vals[r][3] || ''), ts: String(vals[r][4] || ''), mine: f === me, kind: String(vals[r][6] || '') });
        if (f === withUser && t === me && !String(vals[r][5] || '').trim()) toMark.push(r + 1);
    }
    for (var k = 0; k < toMark.length; k++) { sh.getRange(toMark[k], 6).setValue(now); }
    out.sort(function (a, b) { return String(a.ts || '').localeCompare(String(b.ts || '')); });
    return { withUser: withUser, messages: out };
}
function handleSendMessage(session, p) {
    var me = session.username;
    touchPresence(me);
    var to = String(p && p.to || '').trim();
    var text = String(p && p.text || '').trim();
    if (!to) throw httpError('Recipient required.', 'BAD_REQUEST');
    if (!text) throw httpError('Message cannot be empty.', 'BAD_REQUEST');
    if (text.length > 8000) text = text.slice(0, 8000);
    var target = findUser(to);
    if (!target) throw httpError('That person could not be found.', 'NOT_FOUND');
    if (String(target.username).toLowerCase() === String(me).toLowerCase()) throw httpError('You cannot message yourself.', 'BAD_REQUEST');
    var myFlags = readChatFlags()[String(me).toLowerCase()] || {};
    if (myFlags.muted) throw httpError('You have been muted by an administrator and cannot send messages.', 'FORBIDDEN');
    var sh = messageSheet();
    var id = 'm' + Date.now() + Math.floor(Math.random() * 1000);
    var ts = new Date().toISOString();
    sh.appendRow([id, me, target.username, text, ts, '', '']);
    return { id: id, from: me, to: target.username, text: text, ts: ts, mine: true };
}
function readProfilePhotos() {
    var sh = profileSheet();
    var vals = sh.getDataRange().getValues();
    if (vals.length < 2) return {};
    var c = profileCols(vals);
    var map = {};
    for (var r = 1; r < vals.length; r++) {
        var u = String(vals[r][c.username] || '').trim();
        if (u) map[u.toLowerCase()] = String(vals[r][c.photo] || '');
    }
    return map;
}
function handleChatDirectory(session) {
    var me = session.username;
    var photos = readProfilePhotos();
    var keys = readChatKeys();
    var users = readUsers();
    var out = [];
    for (var i = 0; i < users.length; i++) {
        var u = users[i];
        if (String(u.username).toLowerCase() === String(me).toLowerCase()) continue;
        out.push({ username: u.username, name: u.name, role: u.role, photo: photos[String(u.username).toLowerCase()] || '', pubKey: keys[String(u.username).toLowerCase()] || '' });
    }
    return { users: out, mePhoto: photos[String(me).toLowerCase()] || '', myKey: keys[String(me).toLowerCase()] || '' };
}
var CHATFLAG_HEADERS = ['username', 'muted', 'presenceMode', 'updatedAt'];
function chatFlagSheet() { return sheetOrCreate('ChatFlags', CHATFLAG_HEADERS); }
function readChatFlags() {
    var sh = chatFlagSheet();
    var vals = sh.getDataRange().getValues();
    var map = {};
    for (var r = 1; r < vals.length; r++) {
        var u = String(vals[r][0] || '').trim();
        if (!u) continue;
        map[u.toLowerCase()] = { muted: String(vals[r][1] || '').toUpperCase() === 'YES', mode: String(vals[r][2] || '').trim() };
    }
    return map;
}
function setChatFlag(username, patch) {
    var sh = chatFlagSheet();
    var vals = sh.getDataRange().getValues();
    var now = new Date().toISOString();
    for (var r = 1; r < vals.length; r++) {
        if (String(vals[r][0] || '').toLowerCase() === String(username).toLowerCase()) {
            if (patch.hasOwnProperty('muted')) sh.getRange(r + 1, 2).setValue(patch.muted ? 'YES' : '');
            if (patch.hasOwnProperty('mode')) sh.getRange(r + 1, 3).setValue(patch.mode);
            sh.getRange(r + 1, 4).setValue(now);
            return;
        }
    }
    sh.appendRow([username, patch.muted ? 'YES' : '', patch.mode || 'normal', now]);
}
function handleChatBroadcast(session, p) {
    var me = session.username;
    var text = String(p && p.text || '').trim();
    if (!text) throw httpError('Announcement cannot be empty.', 'BAD_REQUEST');
    if (text.length > 2000) text = text.slice(0, 2000);
    var to = String(p && p.to || '').trim();
    var sh = messageSheet();
    var now = new Date().toISOString();
    var base = Date.now();
    var sent = 0;
    if (to) {
        var target = findUser(to);
        if (!target) throw httpError('That person could not be found.', 'NOT_FOUND');
        sh.appendRow(['a' + base + '_0', me, target.username, text, now, '', 'announcement']);
        sent = 1;
    } else {
        var users = readUsers();
        for (var i = 0; i < users.length; i++) {
            var u = users[i];
            if (String(u.username).toLowerCase() === String(me).toLowerCase()) continue;
            sh.appendRow(['a' + base + '_' + i, me, u.username, text, now, '', 'announcement']);
            sent++;
        }
    }
    return { sent: sent };
}
function handleDeleteMessage(session, p) {
    var id = String(p && p.id || '').trim();
    if (!id) throw httpError('Message id required.', 'BAD_REQUEST');
    var sh = messageSheet();
    var vals = sh.getDataRange().getValues();
    for (var r = 1; r < vals.length; r++) {
        if (String(vals[r][0] || '') === id) {
            sh.getRange(r + 1, 4).setValue('');
            sh.getRange(r + 1, 7).setValue('removed');
            return { ok: true, id: id };
        }
    }
    throw httpError('Message not found.', 'NOT_FOUND');
}
function handleUnsendMessage(session, p) {
    var id = String(p && p.id || '').trim();
    if (!id) throw httpError('Message id required.', 'BAD_REQUEST');
    var me = String(session.username || '').toLowerCase();
    var sh = messageSheet();
    var vals = sh.getDataRange().getValues();
    for (var r = 1; r < vals.length; r++) {
        if (String(vals[r][0] || '') === id) {
            if (String(vals[r][1] || '').toLowerCase() !== me) throw httpError('You can only unsend your own messages.', 'FORBIDDEN');
            sh.getRange(r + 1, 4).setValue('');
            sh.getRange(r + 1, 7).setValue('removed');
            return { ok: true, id: id };
        }
    }
    throw httpError('Message not found.', 'NOT_FOUND');
}
function handleSetChatMute(session, p) {
    var username = String(p && p.username || '').trim();
    if (!username) throw httpError('Username required.', 'BAD_REQUEST');
    var target = findUser(username);
    if (!target) throw httpError('User not found.', 'NOT_FOUND');
    if (isStaffRole(target.role)) throw httpError('You cannot mute a staff member.', 'BAD_REQUEST');
    var muted = !!(p && p.muted);
    setChatFlag(target.username, { muted: muted });
    return { username: target.username, muted: muted };
}
function handleAdminThread(session, p) {
    var a = String(p && p.userA || '').trim();
    var b = String(p && p.userB || '').trim();
    if (!a || !b) throw httpError('Two people are required.', 'BAD_REQUEST');
    if (a.toLowerCase() === b.toLowerCase()) throw httpError('Pick two different people.', 'BAD_REQUEST');
    var sh = messageSheet();
    var vals = sh.getDataRange().getValues();
    var out = [];
    for (var r = 1; r < vals.length; r++) {
        var f = String(vals[r][1] || ''), t = String(vals[r][2] || '');
        var fl = f.toLowerCase(), tl = t.toLowerCase(), al = a.toLowerCase(), bl = b.toLowerCase();
        var involves = (fl === al && tl === bl) || (fl === bl && tl === al);
        if (!involves) continue;
        out.push({ id: String(vals[r][0] || ''), from: f, to: t, text: String(vals[r][3] || ''), ts: String(vals[r][4] || ''), kind: String(vals[r][6] || '') });
    }
    out.sort(function (x, y) { return String(x.ts || '').localeCompare(String(y.ts || '')); });
    return { userA: a, userB: b, messages: out };
}
function handleSetPresenceMode(session, p) {
    var mode = String(p && p.mode || 'normal').trim();
    if (mode !== 'normal' && mode !== 'invisible' && mode !== 'always') mode = 'normal';
    setChatFlag(session.username, { mode: mode });
    return { mode: mode };
}
var CHATKEY_HEADERS = ['username', 'publicKey', 'updatedAt'];
function chatKeySheet() { return sheetOrCreate('ChatKeys', CHATKEY_HEADERS); }
function readChatKeys() {
    var sh = chatKeySheet();
    var vals = sh.getDataRange().getValues();
    var map = {};
    for (var r = 1; r < vals.length; r++) {
        var u = String(vals[r][0] || '').trim();
        if (u) map[u.toLowerCase()] = String(vals[r][1] || '');
    }
    return map;
}
function setChatKey(username, publicKey) {
    var sh = chatKeySheet();
    var vals = sh.getDataRange().getValues();
    var now = new Date().toISOString();
    for (var r = 1; r < vals.length; r++) {
        if (String(vals[r][0] || '').toLowerCase() === String(username).toLowerCase()) {
            sh.getRange(r + 1, 2).setValue(publicKey);
            sh.getRange(r + 1, 3).setValue(now);
            return;
        }
    }
    sh.appendRow([username, publicKey, now]);
}
function handleSetPublicKey(session, p) {
    var key = String(p && p.publicKey || '').trim();
    if (!key) throw httpError('Public key required.', 'BAD_REQUEST');
    if (key.length > 4000) throw httpError('Public key too large.', 'BAD_REQUEST');
    setChatKey(session.username, key);
    return { ok: true };
}
function handleGetPublicKey(session, p) {
    var username = String(p && p.username || '').trim();
    if (!username) throw httpError('Username required.', 'BAD_REQUEST');
    var keys = readChatKeys();
    return { username: username, publicKey: keys[username.toLowerCase()] || '' };
}
function doGet() {
    return ContentService.createTextOutput('SMC Guidance API is running.')
        .setMimeType(ContentService.MimeType.TEXT);
}
var __renewToken = null;
function ok(data) { return json({ ok: true, data: data, token: __renewToken || undefined }); }
function fail(msg, code) { return json({ ok: false, error: msg, code: code || 'ERROR' }); }
function json(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
}
function httpError(msg, code) { var e = new Error(msg); e.code = code; return e; }
function props() { return PropertiesService.getScriptProperties(); }
function prop(k, d) { var v = props().getProperty(k); return v == null ? d : v; }
function sheet(name) {
    var id = prop('SHEET_ID');
    if (!id)
        throw httpError('SHEET_ID not configured.', 'CONFIG');
    var sh = SpreadsheetApp.openById(id).getSheetByName(name);
    if (!sh)
        throw httpError('Sheet "' + name + '" not found.', 'CONFIG');
    return sh;
}
function toHex(bytes) {
    return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function hmacHex(message, key) {
    return toHex(Utilities.computeHmacSha256Signature(message, key));
}
function bootstrapRandomHex(nBytes) {
    nBytes = nBytes || 32;
    var out = '';
    while (out.length < nBytes * 2) {
        out += toHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + ':' + new Date().getTime() + ':' + Utilities.getUuid()));
    }
    return out.slice(0, nBytes * 2);
}
function sessionSecret() {
    var v = prop('SESSION_SECRET', '');
    if (!v || v.length < 32) throw httpError('SESSION_SECRET is missing or too short. Run oneClickSetup() and redeploy.', 'CONFIG');
    return v;
}
function pepperSecret() {
    var v = prop('PEPPER', '');
    if (!v || v.length < 32) throw httpError('PEPPER is missing or too short. Run oneClickSetup() and reseed passwords.', 'CONFIG');
    return v;
}
function assertCoreConfig() {
    if (!prop('SHEET_ID', '')) throw httpError('SHEET_ID is not configured.', 'CONFIG');
    sessionSecret();
    pepperSecret();
    var reg = prop('REG_CODE', '');
    if (!reg || reg.length < 8) throw httpError('REG_CODE is missing or too short.', 'CONFIG');
}
// Cryptographic-strength random hex WITHOUT relying on Math.random().
// Apps Script has no crypto.getRandomValues, so we mix several platform UUIDs
// (type-4, randomly generated) through a keyed HMAC. Suitable for salts,
// session/share tokens, and 2FA codes.
function secureRandomHex(nBytes) {
    nBytes = nBytes || 24;
    var seed = '';
    for (var i = 0; i < 6; i++)
        seed += Utilities.getUuid() + ':';
    var key = sessionSecret() + ':' + Utilities.getUuid();
    var out = '';
    var counter = 0;
    while (out.length < nBytes * 2) {
        out += hmacHex(seed + counter, key);
        counter++;
    }
    return out.slice(0, nBytes * 2);
}
function randomToken(len) {
    return secureRandomHex(len || 24);
}
// Unpredictable 6-digit code for 2FA (no Math.random()).
function secureCode6() {
    var n = parseInt(secureRandomHex(4).slice(0, 8), 16);
    return String(100000 + (n % 900000));
}
function hashPassword(password, salt) {
    var pepper = pepperSecret();
    var data = salt + ':' + password + ':' + pepper;
    var h = data;
    for (var i = 0; i < 12000; i++) {
        h = hmacHex(h, pepper + salt);
    }
    return h;
}
function constantTimeEquals(a, b) {
    a = String(a);
    b = String(b);
    if (a.length !== b.length)
        return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++)
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}
function makeToken(user) {
    var ttlH = parseInt(prop('SESSION_TTL_H', '4'), 10) || 4;
    var payload = {
        u: user.username, n: user.name, r: user.role,
        exp: Date.now() + ttlH * 3600 * 1000
    };
    var body = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
    var sig = hmacHex(body, sessionSecret());
    return body + '.' + sig;
}
function verifyToken(token) {
    if (!token || token.indexOf('.') === -1)
        return null;
    var parts = token.split('.');
    var body = parts[0], sig = parts[1];
    var expected = hmacHex(body, sessionSecret());
    if (!constantTimeEquals(sig, expected))
        return null;
    var payload;
    try {
        payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(body)).getDataAsString());
    }
    catch (e) {
        return null;
    }
    if (!payload || !payload.exp || Date.now() > payload.exp)
        return null;
    return { username: payload.u, name: payload.n, role: payload.r, expiresAt: payload.exp };
}
function requireAuth(session) {
    if (!session)
        throw httpError('Please sign in again.', 'AUTH');
    return session;
}
function requireAdmin(session) {
    requireAuth(session);
    if (session.role !== 'admin')
        throw httpError('Administrator access required.', 'FORBIDDEN');
    return session;
}
function requireStaff(session) {
    requireAuth(session);
    if (session.role !== 'admin' && session.role !== 'co-admin')
        throw httpError('Staff access required.', 'FORBIDDEN');
    return session;
}
function isStaffRole(role) { return role === 'admin' || role === 'co-admin'; }
function readUsers() {
    var sh = sheet('Users');
    var values = sh.getDataRange().getValues();
    if (values.length < 2)
        return [];
    var head = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
    var col = function (name) { return head.indexOf(name); };
    var iU = col('username'), iN = col('name'), iR = col('role'), iS = col('salt'), iH = col('hash'), iD = col('designate'), iE = col('email');
    var out = [];
    for (var r = 1; r < values.length; r++) {
        var row = values[r];
        if (!row[iU])
            continue;
        out.push({
            rowIndex: r + 1,
            username: String(row[iU]).trim(),
            name: iN >= 0 ? String(row[iN]).trim() : '',
            role: iR >= 0 ? String(row[iR]).trim() : 'counselor',
            salt: iS >= 0 ? String(row[iS]) : '',
            hash: iH >= 0 ? String(row[iH]) : '',
            designate: iD >= 0 ? String(row[iD]).trim() : '',
            email: iE >= 0 ? String(row[iE]).trim() : ''
        });
    }
    return out;
}
// Exact, normalized matching against a delimited list of names/usernames.
// Replaces loose substring matching (indexOf), which could leak rows across
// people with overlapping names (e.g. "Ann" inside "Joanna"). The field may
// hold several designates separated by comma, semicolon, slash, pipe, or newline.
// Normalize a name for tolerant matching: lowercases, strips common titles
// (Mr/Mrs/Ms/Dr/etc.), turns punctuation into spaces, and collapses spaces.
function normalizeName(s) {
    s = String(s || '').toLowerCase();
    s = s.replace(/[.,;\/|_\-]+/g, ' ');
    s = s.replace(/\b(mr|mrs|ms|miss|sir|madam|maam|ma am|dr|prof|professor|teacher|engr|atty|rev|fr)\b/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
}
// Tolerant matcher used for per-counselor record/evaluation/report visibility.
// A key matches a field entry when either the whole normalized strings are
// equal, OR every word of the key's full name appears in that entry (so
// "Ms. Jane A. Cruz" still matches the user "Jane Cruz"). Single-word keys
// (e.g. a username) must match a whole entry exactly to avoid over-sharing.
function fieldMatchesAny(fieldValue, keys) {
    var parts = String(fieldValue || '')
        .split(/[,;\/|\n]+/)
        .map(function (s) { return normalizeName(s); })
        .filter(function (s) { return s; });
    if (!parts.length)
        return false;
    return keys.some(function (k) {
        var nk = normalizeName(k);
        if (!nk)
            return false;
        if (parts.indexOf(nk) !== -1)
            return true;
        var kt = nk.split(' ').filter(function (t) { return t.length > 1; });
        if (kt.length >= 2) {
            return parts.some(function (part) {
                var pset = part.split(' ');
                return kt.every(function (t) { return pset.indexOf(t) !== -1; });
            });
        }
        return false;
    });
}
function findUser(username) {
    username = String(username || '').trim().toLowerCase();
    var users = readUsers();
    for (var i = 0; i < users.length; i++) {
        if (users[i].username.toLowerCase() === username)
            return users[i];
    }
    return null;
}
function loginAttemptKey(username) {
    return 'LOGIN_' + String(username || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
}
function loginAttemptState(username) {
    var raw = CacheService.getScriptCache().get(loginAttemptKey(username));
    var n = parseInt(raw || '0', 10);
    return isNaN(n) ? 0 : n;
}
function recordLoginFailure(username) {
    var n = loginAttemptState(username) + 1;
    CacheService.getScriptCache().put(loginAttemptKey(username), String(n), 900);
    return n;
}
function clearLoginFailures(username) { CacheService.getScriptCache().remove(loginAttemptKey(username)); }
function handleLogin(p) {
    if (secIsLocked())
        throw httpError('The website has been locked by an administrator.', 'LOCKED');
    var username = String(p.username || '').trim();
    var max = Math.max(3, Math.min(secMaxAttempts(), 20));
    var prior = loginAttemptState(username);
    if (prior >= max)
        throw httpError('Too many attempts for this account. Wait 15 minutes and try again.', 'RATE_LIMIT');
    var u = findUser(username);
    var candidate = hashPassword(String(p.password || ''), u ? u.salt : 'nosalt');
    if (!u || !constantTimeEquals(candidate, u.hash)) {
        var fails = recordLoginFailure(username);
        var left = Math.max(0, max - fails);
        throw httpError(left ? ('Incorrect username or password. ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left temporarily.') : 'Too many attempts for this account. Wait 15 minutes and try again.', left ? 'AUTH' : 'RATE_LIMIT');
    }
    clearLoginFailures(username);
    var deviceId = String(p.deviceId || '').trim();
    if (deviceId && isTrustedDevice(u.username, deviceId)) {
        var trustedSession = issueSession(u);
        trustedSession.remembered = true;
        return trustedSession;
    }
    if (!u.email)
        return { twofa: 'email_required' };
    sendTwoFactorCode(u, deviceId);
    return { twofa: 'code_sent', emailMasked: maskEmail(u.email) };
}
function issueSession(u) {
    var safe = { username: u.username, name: u.name, role: u.role };
    var token = makeToken(safe);
    safe.expiresAt = verifyToken(token).expiresAt;
    return { token: token, user: safe };
}
function readTrustedDevices(username) {
    var raw = prop('DEV_' + String(username).toLowerCase(), '');
    if (!raw) return [];
    try {
        var a = JSON.parse(raw);
        if (!Array.isArray(a)) return [];
        var now = Date.now();
        return a.map(function (x) { return typeof x === 'string' ? { id: x, exp: 0 } : x; })
            .filter(function (x) { return x && x.id && x.exp && x.exp > now; });
    } catch (e) { return []; }
}
function isTrustedDevice(username, deviceId) {
    if (!deviceId) return false;
    return readTrustedDevices(username).some(function (x) { return constantTimeEquals(x.id, deviceId); });
}
function trustDevice(username, deviceId) {
    if (!deviceId) return;
    var list = readTrustedDevices(username).filter(function (x) { return x.id !== deviceId; });
    list.push({ id: deviceId, exp: Date.now() + 30 * 86400000 });
    while (list.length > 10) list.shift();
    props().setProperty('DEV_' + String(username).toLowerCase(), JSON.stringify(list));
}
function maskEmail(e) {
    e = String(e || '');
    var at = e.indexOf('@');
    if (at < 1)
        return e;
    var name = e.slice(0, at), dom = e.slice(at);
    return name.charAt(0) + (name.length > 2 ? '***' : '*') + dom;
}
function sendTwoFactorCode(u, deviceId) {
    var throttleKey = 'TFA_SEND_' + String(u.username).toLowerCase();
    var cache = CacheService.getScriptCache();
    if (cache.get(throttleKey)) throw httpError('Please wait one minute before requesting another code.', 'RATE_LIMIT');
    cache.put(throttleKey, '1', 60);
    var code = secureCode6();
    var rec = {
        h: hmacHex(code, sessionSecret()),
        exp: Date.now() + 10 * 60 * 1000,
        dev: String(deviceId || ''),
        tries: 0
    };
    props().setProperty('TFA_' + u.username.toLowerCase(), JSON.stringify(rec));
    var subject = 'Your SMC Guidance sign-in code';
    var body = 'Your SMC Guidance verification code is ' + code + '. It expires in 10 minutes. If you did not try to sign in, you can ignore this email.\n\nThis is an automated message. Please do not reply.';
    sendAppEmail(u.email, subject, body);
}
// Central mailer for all app emails (2FA codes, auth test).
// - MAIL_FROM      : optional "Send mail as" alias to send FROM (hides your
//                    personal Gmail). Only used if it is a verified alias.
// - MAIL_FROM_NAME : display name (default "SMC Guidance (no-reply)").
// - MAIL_REPLY_TO  : optional reply-to address.
function sendAppEmail(to, subject, body) {
    var fromName = prop('MAIL_FROM_NAME', 'SMC Guidance (no-reply)');
    var fromAlias = prop('MAIL_FROM', '');
    var replyTo = prop('MAIL_REPLY_TO', '');
    // Preferred path: GmailApp can send FROM a verified alias (MailApp cannot),
    // so the recipient never sees the personal address running the script.
    if (fromAlias) {
        var aliases = [];
        try { aliases = GmailApp.getAliases(); } catch (e) { aliases = []; }
        if (aliases.indexOf(fromAlias) !== -1) {
            var gOpts = { from: fromAlias, name: fromName };
            if (replyTo) gOpts.replyTo = replyTo;
            GmailApp.sendEmail(to, subject, body, gOpts);
            return;
        }
    }
    // Fallback: MailApp (sends from the script owner's address). noReply becomes
    // a true no-reply on Google Workspace; on consumer Gmail only the name shows.
    var options = { name: fromName, noReply: true };
    if (replyTo) { options.replyTo = replyTo; options.noReply = false; }
    MailApp.sendEmail(to, subject, body, options);
}
function handleVerify2fa(p) {
    if (secIsLocked())
        throw httpError('The website is locked due to suspicious activity. An administrator must unlock it with the unlock code.', 'LOCKED');
    var u = findUser(p.username);
    var candidate = hashPassword(String(p.password || ''), u ? u.salt : 'nosalt');
    if (!u || !constantTimeEquals(candidate, u.hash))
        throw httpError('Incorrect username or password.', 'AUTH');
    var key = 'TFA_' + u.username.toLowerCase();
    var raw = prop(key, '');
    if (!raw)
        throw httpError('No verification in progress. Please sign in again.', 'AUTH');
    var rec;
    try {
        rec = JSON.parse(raw);
    }
    catch (e) {
        props().deleteProperty(key);
        throw httpError('Please sign in again.', 'AUTH');
    }
    if (!rec || Date.now() > rec.exp) {
        props().deleteProperty(key);
        throw httpError('That code has expired. Please request a new one.', 'AUTH');
    }
    if ((rec.tries || 0) >= 5) {
        props().deleteProperty(key);
        throw httpError('Too many incorrect codes. Please sign in again.', 'AUTH');
    }
    var code = String(p.code || '').trim();
    if (!constantTimeEquals(hmacHex(code, sessionSecret()), rec.h)) {
        rec.tries = (rec.tries || 0) + 1;
        props().setProperty(key, JSON.stringify(rec));
        throw httpError('Incorrect code. Please try again.', 'AUTH');
    }
    props().deleteProperty(key);
    var deviceId = String(p.deviceId || '').trim();
    if (p.remember && deviceId)
        trustDevice(u.username, deviceId);
    return issueSession(u);
}
function handleSet2faEmail(p) {
    if (secIsLocked())
        throw httpError('The website is locked due to suspicious activity. An administrator must unlock it with the unlock code.', 'LOCKED');
    var u = findUser(p.username);
    var candidate = hashPassword(String(p.password || ''), u ? u.salt : 'nosalt');
    if (!u || !constantTimeEquals(candidate, u.hash))
        throw httpError('Incorrect username or password.', 'AUTH');
    if (u.email)
        throw httpError('An email is already registered. Sign in and ask an administrator to change it.', 'FORBIDDEN');
    var email = String(p.email || '').trim();
    if (!email || email.indexOf('@') < 1 || email.indexOf('.') === -1)
        throw httpError('Please enter a valid email address.', 'BAD_REQUEST');
    setUserEmail(u.username, email);
    u.email = email;
    sendTwoFactorCode(u, String(p.deviceId || ''));
    return { twofa: 'code_sent', emailMasked: maskEmail(email) };
}
function handleResend2fa(p) {
    var u = findUser(p.username);
    var candidate = hashPassword(String(p.password || ''), u ? u.salt : 'nosalt');
    if (!u || !constantTimeEquals(candidate, u.hash))
        throw httpError('Incorrect username or password.', 'AUTH');
    if (!u.email)
        throw httpError('No email address on file.', 'BAD_REQUEST');
    sendTwoFactorCode(u, String(p.deviceId || ''));
    return { twofa: 'code_sent', emailMasked: maskEmail(u.email) };
}
function setUserEmail(username, email) {
    var sh = sheet('Users');
    var values = sh.getDataRange().getValues();
    var head = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
    var iEmail = head.indexOf('email');
    if (iEmail === -1) {
        iEmail = head.length;
        sh.getRange(1, iEmail + 1).setValue('email');
    }
    var iU = head.indexOf('username');
    var uname = String(username).trim().toLowerCase();
    for (var r = 1; r < values.length; r++) {
        if (String(values[r][iU]).trim().toLowerCase() === uname) {
            sh.getRange(r + 1, iEmail + 1).setValue(email);
            return;
        }
    }
}
function handleRegister(p) {
    var name = String(p.name || '').trim();
    var username = String(p.username || '').trim();
    var password = String(p.password || '');
    var code = String(p.code || '');
    if (!name || !username || !password || !code)
        throw httpError('Please fill in all fields.', 'BAD_REQUEST');
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username))
        throw httpError('Invalid username format.', 'BAD_REQUEST');
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password))
        throw httpError('Password needs 8+ characters, 1 uppercase letter, and 1 number.', 'BAD_REQUEST');
    var expected = prop('REG_CODE', '');
    if (!expected || !constantTimeEquals(code, expected))
        throw httpError('Invalid registration code.', 'AUTH');
    if (findUser(username))
        throw httpError('That username is already taken.', 'CONFLICT');
    var email = String(p.email || '').trim();
    if (!email || email.indexOf('@') < 1 || email.indexOf('.') === -1)
        throw httpError('Please enter a valid email address.', 'BAD_REQUEST');
    var salt = randomToken(16);
    var hash = hashPassword(password, salt);
    var sh = sheet('Users');
    sh.appendRow([username, name, 'counselor', salt, hash, '']);
    setUserEmail(username, email);
    return { created: true };
}
function autoNumberRecords(sh, rows) {
    if (!rows || !rows.length)
        return;
    var recCol = FIELD_MAP.recordNo + 1;   // 1-based sheet column for Record No.
    var sesCol = FIELD_MAP.sessionNo + 1;   // 1-based sheet column for Session No.
    // Number rows by the session DATE (earliest first), tie-broken by sheet row.
    // Record No. is the overall chronological position; Session No. is the
    // per-student visit count in date order.
    var order = rows.slice().sort(function (a, b) {
        var da = Date.parse(a.date) || 0, db = Date.parse(b.date) || 0;
        if (da !== db) return da - db;
        return (a.__row || 0) - (b.__row || 0);
    });
    var writes = [];
    var recCounter = 0;
    var perStudent = {};
    order.forEach(function (o) {
        recCounter++;
        var key = normalizeName(o.name);
        perStudent[key] = (perStudent[key] || 0) + 1;
        // Always (re)assign from date order so the numbers self-correct whenever
        // rows are added or session dates change. Only write cells that actually
        // changed, to avoid needless sheet updates.
        var recVal = String(recCounter);
        if (String(o.recordNo == null ? '' : o.recordNo).trim() !== recVal)
            writes.push({ row: o.__row, col: recCol, val: recCounter });
        o.recordNo = recVal;
        var sesVal = String(perStudent[key]);
        if (String(o.sessionNo == null ? '' : o.sessionNo).trim() !== sesVal)
            writes.push({ row: o.__row, col: sesCol, val: perStudent[key] });
        o.sessionNo = sesVal;
    });
    // Persist newly assigned numbers. Best-effort: never let a write failure
    // block the dashboard from loading records.
    if (writes.length) {
        try {
            writes.forEach(function (w) {
                if (w.row) sh.getRange(w.row, w.col).setValue(w.val);
            });
        } catch (e) {
            Logger.log('autoNumberRecords: could not write numbers - ' + e.message);
        }
    }
}

function handleRecords(session) {
    var sh = sheet('Records');
    var values = sh.getDataRange().getValues();
    if (values.length < 2)
        return [];
    var rows = [];
    for (var r = 1; r < values.length; r++) {
        var raw = values[r];
        if (!raw || raw.join('').trim() === '')
            continue;
        var obj = {};
        Object.keys(FIELD_MAP).forEach(function (k) {
            var v = raw[FIELD_MAP[k]];
            obj[k] = (v == null) ? '' : (v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(v));
        });
        obj.__row = r + 1; // 1-based sheet row, used for auto-numbering
        rows.push(obj);
    }
    // Auto-generate Record No. (overall sequential) and Session No. (per-student
    // visit count) for any blank cells, and persist them back to the sheet so
    // staff no longer have to fill these in by hand.
    autoNumberRecords(sh, rows);
    rows.forEach(function (o) { delete o.__row; });
    if (session.role !== 'admin') {
        var me = findUser(session.username) || {};
        var keys = [String(session.name || '').toLowerCase(), String(session.username || '').toLowerCase()];
        if (me.designate)
            keys.push(me.designate.toLowerCase());
        rows = rows.filter(function (o) {
            return fieldMatchesAny(o.designate, keys);
        });
    }
    return rows;
}
function handlePublicStats() {
    var sh = sheet('Records');
    var values = sh.getDataRange().getValues();
    var total = 0, names = {};
    for (var r = 1; r < values.length; r++) {
        var raw = values[r];
        if (!raw || raw.join('').trim() === '')
            continue;
        total++;
        var nm = raw[FIELD_MAP.name];
        if (nm)
            names[String(nm)] = 1;
    }
    return { totalSessions: total, totalStudents: Object.keys(names).length };
}
function handleListUsers() {
    return readUsers().map(function (u) {
        return { username: u.username, name: u.name, role: u.role, designate: u.designate };
    });
}
function handleSetRole(session, p) {
    var username = String(p.username || '').trim();
    var role = String(p.role || '').trim();
    if (!username)
        throw httpError('Username required.', 'BAD_REQUEST');
    if (role !== 'counselor' && role !== 'co-admin')
        throw httpError('Role must be "counselor" or "co-admin".', 'BAD_REQUEST');
    var target = findUser(username);
    if (!target)
        throw httpError('Account not found.', 'NOT_FOUND');
    if (target.role === 'admin')
        throw httpError('The administrator role cannot be changed here.', 'FORBIDDEN');
    var sh = sheet('Users');
    var head = sh.getDataRange().getValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
    var iR = head.indexOf('role');
    if (iR < 0)
        throw httpError('Users sheet is missing a "role" column.', 'CONFIG');
    sh.getRange(target.rowIndex, iR + 1).setValue(role);
    return { username: target.username, role: role };
}
function handleDeleteUser(session, p) {
    var username = String(p.username || '').trim();
    if (!username)
        throw httpError('Username required.', 'BAD_REQUEST');
    if (username.toLowerCase() === session.username.toLowerCase())
        throw httpError('You cannot remove your own account.', 'FORBIDDEN');
    var target = findUser(username);
    if (!target)
        throw httpError('Account not found.', 'NOT_FOUND');
    if (target.role === 'admin')
        throw httpError('Administrator accounts cannot be removed here.', 'FORBIDDEN');
    sheet('Users').deleteRow(target.rowIndex);
    return { removed: true };
}
var EVAL_HEADERS = ['id', 'title', 'teacher', 'period', 'status', 'assignedTo', 'checkedBy', 'dueDate', 'notes', 'createdBy', 'createdAt', 'updatedAt'];
function sheetOrCreate(name, headers) {
    var id = prop('SHEET_ID');
    if (!id)
        throw httpError('SHEET_ID not configured.', 'CONFIG');
    var ss = SpreadsheetApp.openById(id);
    var sh = ss.getSheetByName(name);
    if (!sh) {
        sh = ss.insertSheet(name);
        sh.appendRow(headers);
    }
    else if (sh.getLastRow() === 0) {
        sh.appendRow(headers);
    }
    return sh;
}
function evalCols(values) {
    var head = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
    return {
        id: head.indexOf('id'), title: head.indexOf('title'), teacher: head.indexOf('teacher'),
        period: head.indexOf('period'), status: head.indexOf('status'),
        assignedTo: head.indexOf('assignedto'), checkedBy: head.indexOf('checkedby'),
        dueDate: head.indexOf('duedate'), notes: head.indexOf('notes'),
        createdBy: head.indexOf('createdby'), createdAt: head.indexOf('createdat'), updatedAt: head.indexOf('updatedat')
    };
}
function evalCell(row, idx) {
    var v = idx >= 0 ? row[idx] : '';
    if (v == null)
        return '';
    return (v instanceof Date) ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(v);
}
function involvesMe(session, assignedTo, checkedBy) {
    var me = [String(session.name || '').toLowerCase(), String(session.username || '').toLowerCase()];
    return fieldMatchesAny(assignedTo, me) || fieldMatchesAny(checkedBy, me);
}
function handleListEvaluations(session) {
    var sh = sheetOrCreate('Evaluations', EVAL_HEADERS);
    var values = sh.getDataRange().getValues();
    if (values.length < 2)
        return [];
    var c = evalCols(values);
    var out = [];
    for (var r = 1; r < values.length; r++) {
        var row = values[r];
        if (c.id >= 0 && !String(row[c.id]).trim())
            continue;
        out.push({
            id: evalCell(row, c.id), title: evalCell(row, c.title), teacher: evalCell(row, c.teacher),
            period: evalCell(row, c.period), status: evalCell(row, c.status) || 'Pending',
            assignedTo: evalCell(row, c.assignedTo), checkedBy: evalCell(row, c.checkedBy),
            dueDate: evalCell(row, c.dueDate), notes: evalCell(row, c.notes),
            createdBy: evalCell(row, c.createdBy), createdAt: evalCell(row, c.createdAt), updatedAt: evalCell(row, c.updatedAt)
        });
    }
    if (!isStaffRole(session.role)) {
        out = out.filter(function (o) { return involvesMe(session, o.assignedTo, o.checkedBy); });
    }
    return out;
}
function handleSaveEvaluation(session, p) {
    var sh = sheetOrCreate('Evaluations', EVAL_HEADERS);
    var values = sh.getDataRange().getValues();
    var c = evalCols(values);
    var width = values[0].length;
    var staff = isStaffRole(session.role);
    var now = new Date();
    var nowStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    var id = String(p.id || '').trim();
    if (!id) {
        if (!staff)
            throw httpError('Only admins or co-admins can create evaluations.', 'FORBIDDEN');
        if (!String(p.title || '').trim())
            throw httpError('An evaluation title is required.', 'BAD_REQUEST');
        var newId = 'EV' + now.getTime();
        var row = [];
        for (var i = 0; i < width; i++)
            row[i] = '';
        function setNew(idx, val) { if (idx >= 0)
            row[idx] = val == null ? '' : val; }
        setNew(c.id, newId);
        setNew(c.title, p.title);
        setNew(c.teacher, p.teacher);
        setNew(c.period, p.period);
        setNew(c.status, p.status || 'Pending');
        setNew(c.assignedTo, p.assignedTo);
        setNew(c.checkedBy, p.checkedBy);
        setNew(c.dueDate, p.dueDate);
        setNew(c.notes, p.notes);
        setNew(c.createdBy, session.name || session.username);
        setNew(c.createdAt, nowStr);
        setNew(c.updatedAt, nowStr);
        sh.appendRow(row);
        return { id: newId };
    }
    var target = -1;
    for (var rr = 1; rr < values.length; rr++) {
        if (String(values[rr][c.id]).trim() === id) {
            target = rr + 1;
            break;
        }
    }
    if (target < 0)
        throw httpError('Evaluation not found.', 'NOT_FOUND');
    if (!staff) {
        var existing = values[target - 1];
        if (!involvesMe(session, existing[c.assignedTo], existing[c.checkedBy]))
            throw httpError('You can only update evaluations assigned to or checked by you.', 'FORBIDDEN');
        if (p.status != null && c.status >= 0)
            sh.getRange(target, c.status + 1).setValue(p.status);
        if (p.notes != null && c.notes >= 0)
            sh.getRange(target, c.notes + 1).setValue(p.notes);
        if (c.updatedAt >= 0)
            sh.getRange(target, c.updatedAt + 1).setValue(nowStr);
        return { id: id };
    }
    function upd(idx, key) { if (idx >= 0 && p[key] != null)
        sh.getRange(target, idx + 1).setValue(p[key]); }
    upd(c.title, 'title');
    upd(c.teacher, 'teacher');
    upd(c.period, 'period');
    upd(c.status, 'status');
    upd(c.assignedTo, 'assignedTo');
    upd(c.checkedBy, 'checkedBy');
    upd(c.dueDate, 'dueDate');
    upd(c.notes, 'notes');
    if (c.updatedAt >= 0)
        sh.getRange(target, c.updatedAt + 1).setValue(nowStr);
    return { id: id };
}
function handleDeleteEvaluation(session, p) {
    var id = String(p.id || '').trim();
    if (!id)
        throw httpError('Evaluation id required.', 'BAD_REQUEST');
    var sh = sheetOrCreate('Evaluations', EVAL_HEADERS);
    var values = sh.getDataRange().getValues();
    var c = evalCols(values);
    for (var r = 1; r < values.length; r++) {
        if (String(values[r][c.id]).trim() === id) {
            sh.deleteRow(r + 1);
            return { removed: true };
        }
    }
    throw httpError('Evaluation not found.', 'NOT_FOUND');
}
function setupAdmin() {
    var ADMIN_USERNAME = 'admin';
    var ADMIN_NAME = 'Administrator';
    var ADMIN_PASSWORD = '';
    if (!ADMIN_PASSWORD)
        throw new Error('Set ADMIN_PASSWORD, run once, then clear it.');
    if (findUser(ADMIN_USERNAME)) {
        Logger.log('Admin already exists; nothing to do.');
        return;
    }
    var salt = randomToken(16);
    var hash = hashPassword(ADMIN_PASSWORD, salt);
    sheet('Users').appendRow([ADMIN_USERNAME, ADMIN_NAME, 'admin', salt, hash, '']);
    Logger.log('Admin seeded. Now clear ADMIN_PASSWORD and re-save.');
}
function resetAdmin() {
    var ADMIN_USERNAME = 'admin';
    var ADMIN_NAME = 'Administrator';
    var ADMIN_PASSWORD = '';
    if (!ADMIN_PASSWORD)
        throw new Error('Set ADMIN_PASSWORD, run once, then clear it.');
    var existing = findUser(ADMIN_USERNAME);
    if (existing)
        sheet('Users').deleteRow(existing.rowIndex);
    var salt = randomToken(16);
    var hash = hashPassword(ADMIN_PASSWORD, salt);
    sheet('Users').appendRow([ADMIN_USERNAME, ADMIN_NAME, 'admin', salt, hash, '']);
    Logger.log('Admin reset OK. Sign in with username "admin" and the password you typed. Now clear ADMIN_PASSWORD and re-save.');
}
function debugCheck() {
    Logger.log('SHEET_ID set?       ' + (prop('SHEET_ID') != null));
    Logger.log('REG_CODE set?       ' + (prop('REG_CODE') != null));
    Logger.log('SESSION_SECRET set? ' + (prop('SESSION_SECRET') != null));
    Logger.log('PEPPER set?         ' + (prop('PEPPER') != null));
    try {
        var users = readUsers();
        Logger.log('Users rows found:   ' + users.length);
        var a = findUser('admin');
        if (!a) {
            Logger.log('>> No "admin" row in the Users sheet. Run resetAdmin().');
            return;
        }
        Logger.log('admin row index:    ' + a.rowIndex);
        Logger.log('admin role:         ' + a.role + '  (should be "admin")');
        Logger.log('admin salt length:  ' + (a.salt || '').length + '  (should be 32)');
        Logger.log('admin hash length:  ' + (a.hash || '').length + '  (should be 64)');
        if ((a.salt || '').length !== 32 || (a.hash || '').length !== 64)
            Logger.log('>> Salt/hash look wrong (maybe the sheet mangled them). Run resetAdmin().');
    }
    catch (e) {
        Logger.log('>> ERROR reading Users sheet: ' + e.message);
    }
}
function testPassword() {
    var PASSWORD = '';
    if (!PASSWORD)
        throw new Error('Type the password you want to test, then Run.');
    var a = findUser('admin');
    if (!a) {
        Logger.log('No "admin" row. Run resetAdmin() first.');
        return;
    }
    var candidate = hashPassword(PASSWORD, a.salt);
    if (candidate === a.hash)
        Logger.log('MATCH \u2713  This password is correct.');
    else
        Logger.log('NO MATCH \u2717  Wrong password, OR the PEPPER property changed since the admin was seeded. Fix: run resetAdmin() with the password you want.');
}
var EVAL_CONFIG_HEADERS = ['id', 'gradeLevel', 'templateType', 'sheetId', 'tabName', 'mapping', 'updatedAt'];
var EVAL_SUMMARY_HEADERS = ['gradeLevel', 'teacher', 'subject', 'docType', 'responses', 'sectionAverages', 'overall', 'updatedAt'];
function nowStamp() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'); }
function round2(n) { return Math.round(n * 100) / 100; }
function handleEvalTemplates() {
    return {
        scale: { min: 1, max: 4 },
        templates: [
            { key: 'shs', name: 'Senior High School', family: 'score-grid', sections: ['Teacher\u2019s Actions', 'Student\u2019s Actions'] },
            { key: 'jhs', name: 'Junior High School', family: 'score-grid', sections: ['Teacher\u2019s Actions', 'Student\u2019s Actions'] },
            { key: 'g5g6', name: 'Grade 5 \u2013 Grade 6', family: 'score-grid', sections: ['Teacher\u2019s Actions', 'Student\u2019s Actions'] },
            { key: 'g3g4', name: 'Grade 3 \u2013 Grade 4', family: 'category', sections: ['Classroom Cleanliness', 'Life-Enhancing Classroom Discipline', 'Mastery of the Subject Matter', 'Teaching Personality'] },
            { key: 'kinderg2', name: 'Kinder \u2013 Grade 2', family: 'category', sections: ['Classroom Cleanliness', 'Life-Enhancing Classroom Discipline', 'Mastery of the Subject Matter', 'Teaching Personality'] }
        ]
    };
}
function evalConfigSheet() { return sheetOrCreate('EvalConfig', EVAL_CONFIG_HEADERS); }
function authorizeOnce() {
    DriveApp.getRootFolder().getName();
    try {
        formsFolder().getName();
    }
    catch (e) { }
    try {
        FormApp.getActiveForm();
    }
    catch (e) { }
    try {
        SpreadsheetApp.openById(prop('SHEET_ID')).getName();
    }
    catch (e) { }
    Logger.log('Authorization complete: Drive, Forms and Sheets are now allowed.');
    return 'OK';
}
function formsFolder() {
    var id = prop('FORMS_FOLDER_ID', '');
    if (!id)
        throw httpError('FORMS_FOLDER_ID is not set in Script Properties. Add it (the Drive folder id) and re-deploy.', 'CONFIG');
    return DriveApp.getFolderById(id);
}
function handleListForms(session) {
    var root = formsFolder();
    var out = [], seen = {}, MAX = 800;
    function add(f, kind, path) {
        if (out.length >= MAX)
            return;
        var id = f.getId();
        if (seen[id])
            return;
        seen[id] = true;
        out.push({ id: id, name: f.getName(), path: path, kind: kind });
    }
    function scan(folder, path, depth) {
        if (depth > 10 || out.length >= MAX)
            return;
        var files = folder.getFiles();
        while (files.hasNext() && out.length < MAX) {
            var f = files.next(), mt = f.getMimeType(), kind = null;
            if (mt === MimeType.GOOGLE_FORMS)
                kind = 'form';
            else if (mt === MimeType.GOOGLE_SHEETS)
                kind = 'sheet';
            else if (mt === 'text/csv')
                kind = 'csv';
            if (kind)
                add(f, kind, path);
        }
        var subs = folder.getFolders();
        while (subs.hasNext()) {
            var sf = subs.next();
            scan(sf, path ? path + ' / ' + sf.getName() : sf.getName(), depth + 1);
        }
    }
    scan(root, '', 0);
    out.sort(function (a, b) {
        var an = (a.path || '') + '/' + a.name, bn = (b.path || '') + '/' + b.name;
        return an < bn ? -1 : (an > bn ? 1 : 0);
    });
    return { folderName: root.getName(), forms: out, capped: out.length >= MAX };
}
function handleGetFormResponses(session, p) {
    var fileId = String(p && p.fileId || '').trim();
    if (!fileId)
        throw httpError('Missing file id.', 'BAD_REQUEST');
    var file = DriveApp.getFileById(fileId);
    var mime = file.getMimeType();
    if (mime === MimeType.GOOGLE_FORMS)
        return formResponsesFromForm(fileId, file.getName());
    if (mime === MimeType.GOOGLE_SHEETS)
        return formResponsesFromSheet(SpreadsheetApp.openById(fileId), file.getName());
    if (mime === 'text/csv') {
        var arr = Utilities.parseCsv(file.getBlob().getDataAsString());
        return { name: file.getName(), headers: (arr[0] || []).map(String), rows: arr.slice(1) };
    }
    throw httpError('Unsupported file type (' + mime + '). Link the Form to a Google Sheet, or keep responses as a Form / CSV.', 'BAD_REQUEST');
}
function formResponsesFromForm(formId, name) {
    var form = FormApp.openById(formId);
    var responses = form.getResponses();
    if (!responses.length)
        throw httpError('\u201c' + name + '\u201d is a Google Form with no responses. Note: making a COPY of a Form does not copy its responses \u2014 open the ORIGINAL form, or use its linked response Sheet (or a CSV export) instead.', 'NO_RESPONSES');
    var items = form.getItems();
    var headers = items.map(function (it) { return it.getTitle(); });
    var rows = responses.map(function (resp) {
        var byId = {};
        resp.getItemResponses().forEach(function (ir) { byId[ir.getItem().getId()] = ir.getResponse(); });
        return items.map(function (it) { var v = byId[it.getId()]; if (v == null)
            return ''; return (v instanceof Array) ? v.join(', ') : String(v); });
    });
    return { name: name, headers: headers, rows: rows };
}
function sheetDataRowCount(values) {
    var n = 0;
    for (var r = 1; r < values.length; r++) {
        var row = values[r];
        for (var c = 0; c < row.length; c++) {
            if (String(row[c] == null ? '' : row[c]).trim() !== '') {
                n++;
                break;
            }
        }
    }
    return n;
}
function formResponsesFromSheet(ss, name) {
    var sheets = ss.getSheets(), best = null, bestScore = -1;
    for (var i = 0; i < sheets.length; i++) {
        var values = sheets[i].getDataRange().getValues();
        var dataRows = sheetDataRowCount(values);
        if (dataRows <= 0)
            continue;
        var score = dataRows + (/form responses/i.test(sheets[i].getName()) ? 1000000 : 0);
        if (score > bestScore) {
            bestScore = score;
            best = values;
        }
    }
    if (!best)
        return { name: name, headers: [], rows: [] };
    var headers = best[0].map(function (h) { return String(h); });
    var rows = [];
    for (var k = 1; k < best.length; k++) {
        var r = best[k], keep = false;
        for (var c = 0; c < r.length; c++) {
            if (String(r[c] == null ? '' : r[c]).trim() !== '') {
                keep = true;
                break;
            }
        }
        if (keep)
            rows.push(r.map(function (c) { return c == null ? '' : (c instanceof Date ? c.toISOString() : String(c)); }));
    }
    return { name: name, headers: headers, rows: rows };
}
function openResponseSheet(sheetId, tabName) {
    var id = String(sheetId || '').trim();
    if (!id)
        id = prop('SHEET_ID');
    if (!id)
        throw httpError('No response spreadsheet configured.', 'CONFIG');
    var m = id.match(/[-\w]{25,}/);
    if (m)
        id = m[0];
    var ss;
    try {
        ss = SpreadsheetApp.openById(id);
    }
    catch (e) {
        throw httpError('Could not open that spreadsheet. Check the ID/link and that this script has access to it.', 'CONFIG');
    }
    var sh = tabName ? ss.getSheetByName(tabName) : ss.getSheets()[0];
    if (!sh)
        throw httpError('Tab "' + tabName + '" was not found in the response sheet.', 'CONFIG');
    return { ss: ss, sh: sh };
}
function handleEvalSheetColumns(session, p) {
    var r = openResponseSheet(p.sheetId, p.tabName);
    var ss = r.ss, sh = r.sh;
    var lastCol = sh.getLastColumn();
    var headers = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
    var lastRow = Math.min(sh.getLastRow(), 40);
    var sample = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
    var guess = headers.map(function (h, i) {
        var numeric = 0, textLong = 0, total = 0;
        sample.forEach(function (row) {
            var v = row[i];
            if (v === '' || v == null)
                return;
            total++;
            var n = Number(v);
            if (!isNaN(n) && n >= 1 && n <= 5)
                numeric++;
            else if (String(v).trim().split(/\s+/).length >= 3)
                textLong++;
        });
        var kind = 'other';
        if (total > 0 && numeric / total >= 0.6)
            kind = 'item';
        else if (total > 0 && textLong / total >= 0.4)
            kind = 'comment';
        return { col: h, index: i, kind: kind };
    });
    return {
        tabs: ss.getSheets().map(function (s) { return s.getName(); }),
        tab: sh.getName(),
        headers: headers,
        guess: guess,
        rowCount: Math.max(0, sh.getLastRow() - 1)
    };
}
function handleListEvalConfigs(session) {
    var sh = evalConfigSheet();
    var values = sh.getDataRange().getValues();
    if (values.length < 2)
        return [];
    var out = [];
    for (var r = 1; r < values.length; r++) {
        var row = values[r];
        if (!String(row[0]).trim())
            continue;
        var mapping = {};
        try {
            mapping = JSON.parse(row[5] || '{}');
        }
        catch (e) {
            mapping = {};
        }
        out.push({
            id: String(row[0]), gradeLevel: String(row[1] || ''), templateType: String(row[2] || ''),
            sheetId: String(row[3] || ''), tabName: String(row[4] || ''), mapping: mapping, updatedAt: String(row[6] || '')
        });
    }
    return out;
}
function handleSaveEvalConfig(session, p) {
    var sh = evalConfigSheet();
    var values = sh.getDataRange().getValues();
    if (!String(p.gradeLevel || '').trim())
        throw httpError('A grade level / label is required.', 'BAD_REQUEST');
    var mapping = p.mapping || {};
    if (!mapping.teacher)
        throw httpError('Please map the column that holds the teacher name.', 'BAD_REQUEST');
    var now = nowStamp();
    var mapJson = JSON.stringify(mapping);
    var rowVals = [null, p.gradeLevel, p.templateType || '', p.sheetId || '', p.tabName || '', mapJson, now];
    var id = String(p.id || '').trim();
    if (id) {
        for (var r = 1; r < values.length; r++) {
            if (String(values[r][0]).trim() === id) {
                rowVals[0] = id;
                sh.getRange(r + 1, 1, 1, EVAL_CONFIG_HEADERS.length).setValues([rowVals]);
                return { id: id };
            }
        }
    }
    id = 'EC' + new Date().getTime();
    rowVals[0] = id;
    sh.appendRow(rowVals);
    return { id: id };
}
function handleDeleteEvalConfig(session, p) {
    var id = String(p.id || '').trim();
    if (!id)
        throw httpError('Config id required.', 'BAD_REQUEST');
    var sh = evalConfigSheet();
    var values = sh.getDataRange().getValues();
    for (var r = 1; r < values.length; r++) {
        if (String(values[r][0]).trim() === id) {
            sh.deleteRow(r + 1);
            return { removed: true };
        }
    }
    throw httpError('Config not found.', 'NOT_FOUND');
}
function handleProcessEval(session, p) {
    var configs = handleListEvalConfigs(session);
    var cfg = null;
    for (var i = 0; i < configs.length; i++) {
        if (configs[i].id === String(p.id || '').trim()) {
            cfg = configs[i];
            break;
        }
    }
    if (!cfg)
        throw httpError('Evaluation source not found. Save it first.', 'NOT_FOUND');
    if (!cfg.mapping || !cfg.mapping.teacher)
        throw httpError('This source has no teacher column mapped.', 'BAD_REQUEST');
    var r = openResponseSheet(cfg.sheetId, cfg.tabName);
    var sh = r.sh;
    var lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
    if (lastRow < 2)
        return { gradeLevel: cfg.gradeLevel, templateType: cfg.templateType, teachers: [], generatedAt: nowStamp(), responses: 0 };
    var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
    var headers = values[0].map(function (h) { return String(h).trim(); });
    var result = computeEvalResult(cfg, values, headers);
    writeEvalSummary(cfg, result.teachers);
    return result;
}
function guessKinds(headers, values) {
    var sample = values.slice(1, 41);
    return headers.map(function (h, i) {
        var numeric = 0, textLong = 0, total = 0;
        sample.forEach(function (row) {
            var v = row[i];
            if (v === '' || v == null)
                return;
            total++;
            var n = Number(v);
            if (!isNaN(n) && n >= 1 && n <= 5)
                numeric++;
            else if (String(v).trim().split(/\s+/).length >= 3)
                textLong++;
        });
        var kind = 'other';
        if (total > 0 && numeric / total >= 0.6)
            kind = 'item';
        else if (total > 0 && textLong / total >= 0.4)
            kind = 'comment';
        return { col: h, index: i, kind: kind };
    });
}
function autoDetectMapping(headers, guess) {
    function kindAt(i) { return guess[i] ? guess[i].kind : 'other'; }
    var teacher = -1, subject = -1, section = -1, docType = -1, comments = [], items = [];
    for (var i = 0; i < headers.length; i++) {
        var low = String(headers[i]).toLowerCase();
        if (teacher < 0 && /teacher|faculty|instructor|guro/.test(low))
            teacher = i;
        else if (subject < 0 && /subject|asignatura/.test(low))
            subject = i;
        else if (section < 0 && /section|grade|level|class/.test(low))
            section = i;
        else if (docType < 0 && /document|doc type|type of/.test(low))
            docType = i;
    }
    for (var j = 0; j < headers.length; j++) {
        if (j === teacher || j === subject || j === section || j === docType)
            continue;
        var k = kindAt(j);
        if (k === 'item')
            items.push({ col: headers[j], section: 'Evaluation' });
        else if (k === 'comment')
            comments.push(headers[j]);
    }
    if (teacher < 0) {
        for (var t = 0; t < headers.length; t++) {
            if (t === subject || t === section || t === docType)
                continue;
            if (kindAt(t) === 'other') {
                teacher = t;
                break;
            }
        }
    }
    return {
        teacher: teacher >= 0 ? headers[teacher] : '',
        subject: subject >= 0 ? headers[subject] : '',
        section: section >= 0 ? headers[section] : '',
        docType: docType >= 0 ? headers[docType] : '',
        comments: comments, items: items
    };
}
function handleQuickProcess(session, p) {
    var r = openResponseSheet(p.sheetId, p.tabName);
    var sh = r.sh, ss = r.ss;
    var lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
    var gradeName = ss.getName();
    if (lastRow < 2 || lastCol < 1)
        return { gradeLevel: gradeName, teachers: [], generatedAt: nowStamp(), responses: 0, autoMapped: true };
    var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
    var headers = values[0].map(function (h) { return String(h).trim(); });
    var guess = guessKinds(headers, values);
    var mapping = autoDetectMapping(headers, guess);
    if (!mapping.teacher)
        throw httpError('Could not auto-detect a teacher column in that sheet. Use \u201c+ Add Form Source\u201d to map the columns manually.', 'CONFIG');
    if (!mapping.items.length)
        throw httpError('Could not auto-detect any 1\u20134 score questions in that sheet. Use \u201c+ Add Form Source\u201d to map manually.', 'CONFIG');
    var cfg = { gradeLevel: gradeName, templateType: '', sheetId: p.sheetId || '', tabName: sh.getName(), mapping: mapping };
    var result = computeEvalResult(cfg, values, headers);
    writeEvalSummary(cfg, result.teachers);
    result.autoMapped = true;
    result.detected = { teacher: mapping.teacher, subject: mapping.subject, items: mapping.items.length, comments: mapping.comments.length };
    return result;
}
function computeEvalResult(cfg, values, headers) {
    var mapping = cfg.mapping || {};
    function colIndex(name) { return headers.indexOf(String(name || '').trim()); }
    var teacherIdx = colIndex(mapping.teacher);
    if (teacherIdx < 0)
        throw httpError('The mapped teacher column is no longer in the sheet. Re-map the columns.', 'CONFIG');
    var subjectIdx = mapping.subject ? colIndex(mapping.subject) : -1;
    var sectionIdx = mapping.section ? colIndex(mapping.section) : -1;
    var docTypeIdx = mapping.docType ? colIndex(mapping.docType) : -1;
    var commentIdxs = (mapping.comments || []).map(colIndex).filter(function (x) { return x >= 0; });
    var items = (mapping.items || []).map(function (it) {
        return { col: it.col, section: it.section || 'Evaluation', index: colIndex(it.col) };
    }).filter(function (it) { return it.index >= 0; });
    var groups = {};
    for (var rr = 1; rr < values.length; rr++) {
        var row = values[rr];
        var teacher = String(row[teacherIdx] == null ? '' : row[teacherIdx]).trim();
        if (!teacher)
            continue;
        var subject = subjectIdx >= 0 ? String(row[subjectIdx] || '').trim() : '';
        var key = teacher + ' || ' + subject;
        if (!groups[key])
            groups[key] = { teacher: teacher, subject: subject, sections: {}, rows: 0, comments: [], docType: '', classSection: '' };
        var g = groups[key];
        g.rows++;
        if (docTypeIdx >= 0 && !g.docType)
            g.docType = String(row[docTypeIdx] || '').trim();
        if (sectionIdx >= 0 && !g.classSection)
            g.classSection = String(row[sectionIdx] || '').trim();
        items.forEach(function (it) {
            var v = Number(row[it.index]);
            if (isNaN(v) || v <= 0)
                return;
            if (!g.sections[it.section])
                g.sections[it.section] = {};
            if (!g.sections[it.section][it.col])
                g.sections[it.section][it.col] = { sum: 0, n: 0 };
            g.sections[it.section][it.col].sum += v;
            g.sections[it.section][it.col].n++;
        });
        commentIdxs.forEach(function (ci) {
            var c = String(row[ci] == null ? '' : row[ci]).trim();
            if (c)
                g.comments.push(c);
        });
    }
    var teachers = Object.keys(groups).map(function (key) {
        var g = groups[key];
        var sectionList = Object.keys(g.sections).map(function (secName) {
            var itemsObj = g.sections[secName];
            var itemList = Object.keys(itemsObj).map(function (col) {
                var cell = itemsObj[col];
                return { item: col, average: cell.n ? round2(cell.sum / cell.n) : null, responses: cell.n };
            });
            var valid = itemList.filter(function (x) { return x.average != null; });
            var secAvg = valid.length ? round2(valid.reduce(function (s, x) { return s + x.average; }, 0) / valid.length) : null;
            return { section: secName, items: itemList, average: secAvg };
        });
        var secAvgs = sectionList.map(function (s) { return s.average; }).filter(function (x) { return x != null; });
        var overall = secAvgs.length ? round2(secAvgs.reduce(function (s, x) { return s + x; }, 0) / secAvgs.length) : null;
        return {
            teacher: g.teacher, subject: g.subject, classSection: g.classSection, docType: g.docType,
            responses: g.rows, sections: sectionList, overall: overall,
            comments: g.comments, wordCounts: tallyWords(g.comments), commentCounts: tallyComments(g.comments)
        };
    });
    teachers.sort(function (a, b) { return (b.overall || 0) - (a.overall || 0); });
    return {
        gradeLevel: cfg.gradeLevel, templateType: cfg.templateType, teachers: teachers,
        generatedAt: nowStamp(), responses: teachers.reduce(function (s, t) { return s + t.responses; }, 0)
    };
}
function tallyWords(comments) {
    var map = {};
    comments.forEach(function (c) {
        String(c).split(/\s+/).forEach(function (raw) {
            var w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
            if (!w)
                return;
            var key = w.toLowerCase();
            if (!map[key])
                map[key] = { word: w, count: 0 };
            map[key].count++;
        });
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.count - a.count; });
}
function tallyComments(comments) {
    var map = {};
    comments.forEach(function (c) {
        var key = String(c).trim();
        if (!key)
            return;
        map[key] = (map[key] || 0) + 1;
    });
    return Object.keys(map).map(function (k) { return { comment: k, count: map[k] }; }).sort(function (a, b) { return b.count - a.count; });
}
function writeEvalSummary(cfg, teachers) {
    var sh = sheetOrCreate('EvalSummary', EVAL_SUMMARY_HEADERS);
    var values = sh.getDataRange().getValues();
    for (var r = values.length - 1; r >= 1; r--) {
        if (String(values[r][0]).trim() === String(cfg.gradeLevel).trim())
            sh.deleteRow(r + 1);
    }
    var now = nowStamp();
    teachers.forEach(function (t) {
        var secStr = t.sections.map(function (s) { return s.section + ': ' + (s.average == null ? 'n/a' : s.average); }).join(' | ');
        sh.appendRow([cfg.gradeLevel, t.teacher, t.subject, t.docType, t.responses, secStr, t.overall == null ? '' : t.overall, now]);
    });
}

// ==== Security / site lock (Turn 71) ====
function secMaxAttempts() { return parseInt(prop('MAX_ATTEMPTS', '10'), 10) || 10; }
function secFails() { return parseInt(prop('LOGIN_FAILS', '0'), 10) || 0; }
function secIsLocked() { return prop('SITE_LOCKED', '') === '1'; }
function secUnlockCode() { var c = prop('UNLOCK_CODE', ''); if (!c) c = prop('REG_CODE', ''); return c; }
function handleSecurityStatus() { return { locked: secIsLocked() }; }
function handleUnlockSite(p) {
    var code = String(p && p.code || '');
    var expected = secUnlockCode();
    if (!expected)
        throw httpError('No unlock code is configured. An administrator must set UNLOCK_CODE (or REG_CODE) in Script Properties.', 'CONFIG');
    if (!constantTimeEquals(code, expected))
        throw httpError('Incorrect unlock code.', 'AUTH');
    props().setProperty('SITE_LOCKED', '');
    props().setProperty('LOGIN_FAILS', '0');
    return { unlocked: true };
}
function handleGetSecurity(session) {
    return { locked: secIsLocked(), attempts: secFails(), maxAttempts: secMaxAttempts(), hasUnlockCode: !!prop('UNLOCK_CODE', '') };
}
function handleSetSecurity(session, p) {
    if (p.maxAttempts != null) {
        var m = parseInt(p.maxAttempts, 10);
        if (isNaN(m) || m < 1 || m > 1000) throw httpError('Max attempts must be between 1 and 1000.', 'BAD_REQUEST');
        props().setProperty('MAX_ATTEMPTS', String(m));
    }
    if (p.unlockCode != null) {
        var uc = String(p.unlockCode);
        if (uc.length < 4) throw httpError('Unlock code must be at least 4 characters.', 'BAD_REQUEST');
        props().setProperty('UNLOCK_CODE', uc);
    }
    if (p.resetAttempts) props().setProperty('LOGIN_FAILS', '0');
    if (p.lock === true) props().setProperty('SITE_LOCKED', '1');
    if (p.lock === false) { props().setProperty('SITE_LOCKED', ''); props().setProperty('LOGIN_FAILS', '0'); }
    return handleGetSecurity(session);
}
// ==== Incident reports (Turn 71) ====
var INCIDENT_HEADERS = ['id', 'title', 'type', 'severity', 'status', 'dateOccurred', 'location', 'involved', 'description', 'actionsTaken', 'reportedBy', 'reporterRole', 'createdAt', 'updatedAt'];
function incidentSheet() { return sheetOrCreate('Incidents', INCIDENT_HEADERS); }
function incidentCols(values) {
    var head = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
    return {
        id: head.indexOf('id'), title: head.indexOf('title'), type: head.indexOf('type'),
        severity: head.indexOf('severity'), status: head.indexOf('status'), dateOccurred: head.indexOf('dateoccurred'),
        location: head.indexOf('location'), involved: head.indexOf('involved'), description: head.indexOf('description'),
        actionsTaken: head.indexOf('actionstaken'), reportedBy: head.indexOf('reportedby'), reporterRole: head.indexOf('reporterrole'),
        createdAt: head.indexOf('createdat'), updatedAt: head.indexOf('updatedat')
    };
}
function incCell(row, idx) { var v = idx >= 0 ? row[idx] : ''; if (v == null) return ''; return (v instanceof Date) ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') : String(v); }
function normInvolved(raw) {
    var arr = raw;
    if (typeof arr === 'string') { try { arr = JSON.parse(arr || '[]'); } catch (e) { arr = []; } }
    if (!Array.isArray(arr)) arr = [];
    return arr.map(function (p) { p = p || {}; return { name: String(p.name || '').slice(0, 120), grade: String(p.grade || '').slice(0, 40), section: String(p.section || '').slice(0, 40), role: String(p.role || '').slice(0, 40) }; })
        .filter(function (p) { return p.name || p.grade || p.section; });
}
function incToObj(row, c) {
    var involved = [];
    try { involved = JSON.parse(incCell(row, c.involved) || '[]'); } catch (e) { involved = []; }
    return {
        id: incCell(row, c.id), title: incCell(row, c.title), type: incCell(row, c.type), severity: incCell(row, c.severity),
        status: incCell(row, c.status) || 'Open', dateOccurred: incCell(row, c.dateOccurred), location: incCell(row, c.location),
        involved: involved, description: incCell(row, c.description), actionsTaken: incCell(row, c.actionsTaken),
        reportedBy: incCell(row, c.reportedBy), reporterRole: incCell(row, c.reporterRole),
        createdAt: incCell(row, c.createdAt), updatedAt: incCell(row, c.updatedAt)
    };
}
function incMine(session, reportedBy) {
    var keys = [String(session.name || '').toLowerCase(), String(session.username || '').toLowerCase()];
    return fieldMatchesAny(reportedBy, keys);
}
function handleListIncidents(session) {
    var sh = incidentSheet();
    var values = sh.getDataRange().getValues();
    if (values.length < 2) return [];
    var c = incidentCols(values); var out = [];
    for (var r = 1; r < values.length; r++) {
        var row = values[r];
        if (c.id >= 0 && !String(row[c.id]).trim()) continue;
        out.push(incToObj(row, c));
    }
    if (!isStaffRole(session.role)) out = out.filter(function (o) { return incMine(session, o.reportedBy); });
    out.sort(function (a, b) { return (a.createdAt < b.createdAt) ? 1 : -1; });
    return out;
}
function handleSaveIncident(session, p) {
    var sh = incidentSheet();
    var values = sh.getDataRange().getValues();
    var c = incidentCols(values); var width = values[0].length;
    var now = new Date();
    var nowStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    if (!String(p.title || '').trim()) throw httpError('An incident title is required.', 'BAD_REQUEST');
    var involvedJson = JSON.stringify(normInvolved(p.involved));
    var id = String(p.id || '').trim();
    if (!id) {
        var newId = 'IN' + now.getTime();
        var row = [];
        for (var i = 0; i < width; i++) row[i] = '';
        var setNew = function (idx, val) { if (idx >= 0) row[idx] = val == null ? '' : val; };
        setNew(c.id, newId); setNew(c.title, String(p.title).slice(0, 200)); setNew(c.type, String(p.type || '').slice(0, 80));
        setNew(c.severity, String(p.severity || '').slice(0, 40)); setNew(c.status, String(p.status || 'Open').slice(0, 40));
        setNew(c.dateOccurred, String(p.dateOccurred || '').slice(0, 40)); setNew(c.location, String(p.location || '').slice(0, 200));
        setNew(c.involved, involvedJson); setNew(c.description, String(p.description || '').slice(0, 8000));
        setNew(c.actionsTaken, String(p.actionsTaken || '').slice(0, 8000)); setNew(c.reportedBy, session.name || session.username);
        setNew(c.reporterRole, session.role || ''); setNew(c.createdAt, nowStr); setNew(c.updatedAt, nowStr);
        sh.appendRow(row);
        return { id: newId };
    }
    var target = -1;
    for (var rr = 1; rr < values.length; rr++) { if (String(values[rr][c.id]).trim() === id) { target = rr + 1; break; } }
    if (target < 0) throw httpError('Incident not found.', 'NOT_FOUND');
    if (!isStaffRole(session.role) && !incMine(session, values[target - 1][c.reportedBy]))
        throw httpError('You can only edit incident reports you created.', 'FORBIDDEN');
    var upd = function (idx, val) { if (idx >= 0) sh.getRange(target, idx + 1).setValue(val == null ? '' : val); };
    upd(c.title, String(p.title).slice(0, 200)); upd(c.type, String(p.type || '').slice(0, 80)); upd(c.severity, String(p.severity || '').slice(0, 40));
    upd(c.status, String(p.status || 'Open').slice(0, 40)); upd(c.dateOccurred, String(p.dateOccurred || '').slice(0, 40));
    upd(c.location, String(p.location || '').slice(0, 200)); upd(c.involved, involvedJson); upd(c.description, String(p.description || '').slice(0, 8000));
    upd(c.actionsTaken, String(p.actionsTaken || '').slice(0, 8000)); upd(c.updatedAt, nowStr);
    return { id: id };
}
function handleDeleteIncident(session, p) {
    var id = String(p.id || '').trim();
    if (!id) throw httpError('Incident id required.', 'BAD_REQUEST');
    var sh = incidentSheet();
    var values = sh.getDataRange().getValues();
    var c = incidentCols(values);
    for (var r = 1; r < values.length; r++) { if (String(values[r][c.id]).trim() === id) { sh.deleteRow(r + 1); return { removed: true }; } }
    throw httpError('Incident not found.', 'NOT_FOUND');
}

var SHARE_HEADERS = ['token','type','title','bodyClass','full','html','createdBy','createdAt','expiresAt','revoked'];
// Server-side sanitizer for PUBLIC share pages. Share links are viewable
// WITHOUT logging in, so we must not trust the HTML the browser sends. This
// strips the common stored-XSS vectors: <script>/<style>/<iframe>/<object>/
// <embed>/<template>/<noscript> blocks, standalone <link>/<meta>/<base>/<form>
// tags, inline on* event handlers, and javascript:/vbscript:/non-image data:
// URLs. Regex sanitizing is not a full HTML parser, so keep shared content
// limited to the app's own formatted output.
function shareEnabled() { return prop('PUBLIC_SHARING_ENABLED', '').toLowerCase() === 'true'; }
function sanitizeShareHtml(html) {
    var s = String(html || '');
    s = s.replace(/<\s*(script|style|iframe|object|embed|template|noscript)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
    s = s.replace(/<\s*(script|iframe|object|embed|link|meta|base|form)\b[^>]*>/gi, '');
    s = s.replace(/\son[a-z0-9_-]+\s*=\s*"[^"]*"/gi, '');
    s = s.replace(/\son[a-z0-9_-]+\s*=\s*'[^']*'/gi, '');
    s = s.replace(/\son[a-z0-9_-]+\s*=\s*[^\s>]+/gi, '');
    s = s.replace(/(href|src|xlink:href)\s*=\s*"(\s*(?:javascript|vbscript)\s*:)[^"]*"/gi, '$1="#"');
    s = s.replace(/(href|src|xlink:href)\s*=\s*'(\s*(?:javascript|vbscript)\s*:)[^']*'/gi, "$1='#'");
    s = s.replace(/(href|src|xlink:href)\s*=\s*"(\s*data:(?!image\/)[^"]*)"/gi, '$1="#"');
    s = s.replace(/(href|src|xlink:href)\s*=\s*'(\s*data:(?!image\/)[^']*)'/gi, "$1='#'");
    s = s.replace(/(href|src|xlink:href)\s*=\s*([^\s"'`=<>]+)/gi, function(_, a, v) { return /^(?:javascript|vbscript|data):/i.test(v.trim()) ? a + '="#"' : a + '="' + v.replace(/["<>]/g, '') + '"'; });
    return s;
}
function shareSheet(){ return sheetOrCreate('Shares', SHARE_HEADERS); }
function shareCols(values){
    var head = values[0].map(function(h){ return String(h).trim().toLowerCase(); });
    return { token: head.indexOf('token'), type: head.indexOf('type'), title: head.indexOf('title'), bodyClass: head.indexOf('bodyclass'), full: head.indexOf('full'), html: head.indexOf('html'), createdBy: head.indexOf('createdby'), createdAt: head.indexOf('createdat'), expiresAt: head.indexOf('expiresat'), revoked: head.indexOf('revoked') };
}
function handleCreateShare(session, p){
    if (!shareEnabled()) throw httpError('Public sharing is disabled by default. Use an approved secure document channel.', 'FORBIDDEN');
    var type = String(p.type || '').trim();
    var allowed = { record:1, incident:1, classlist:1, evaluation:1 };
    if(!allowed[type]) throw httpError('Unknown document type.', 'BAD_REQUEST');
    var html = String(p.html || '');
    if(!html.trim()) throw httpError('Nothing to share.', 'BAD_REQUEST');
    if(html.length > 48000) throw httpError('This document is too large to share as a link. Print it to PDF instead.', 'TOO_LARGE');
    html = sanitizeShareHtml(html);
    var sh = shareSheet();
    var values = sh.getDataRange().getValues();
    var c = shareCols(values);
    var width = values[0].length;
    var now = new Date();
    var days = parseInt(prop('SHARE_TTL_DAYS','7'), 10) || 7;
    var exp = new Date(now.getTime() + days * 86400000);
    var token = randomToken(20);
    var row = [];
    for(var i=0;i<width;i++) row[i] = '';
    function setC(idx,val){ if(idx>=0) row[idx] = val==null ? '' : val; }
    setC(c.token, token);
    setC(c.type, type);
    setC(c.title, String(p.title||'').slice(0,200));
    setC(c.bodyClass, String(p.bodyClass||'').slice(0,60));
    setC(c.full, p.full ? 'yes' : '');
    setC(c.html, html);
    setC(c.createdBy, session.name || session.username);
    setC(c.createdAt, Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'));
    setC(c.expiresAt, exp.toISOString());
    setC(c.revoked, '');
    sh.appendRow(row);
    return { token: token, expiresAt: exp.toISOString() };
}
function handleGetShared(p){
    if (!shareEnabled()) throw httpError('Public sharing is disabled.', 'GONE');
    var token = String(p.token||'').trim();
    if(!token) throw httpError('This link is invalid.', 'NOT_FOUND');
    var sh = shareSheet();
    var values = sh.getDataRange().getValues();
    var c = shareCols(values);
    for(var r=1;r<values.length;r++){
        if(String(values[r][c.token]).trim() === token){
            var row = values[r];
            if(String(row[c.revoked]).trim()) throw httpError('This link has been revoked.', 'GONE');
            var expStr = String(row[c.expiresAt]).trim();
            var exp = expStr ? new Date(expStr) : null;
            if(exp && !isNaN(exp.getTime()) && exp.getTime() < Date.now()) throw httpError('This link has expired.', 'GONE');
            return { type: String(row[c.type]||''), title: String(row[c.title]||''), bodyClass: String(row[c.bodyClass]||''), full: !!String(row[c.full]).trim(), html: String(row[c.html]||''), expiresAt: expStr };
        }
    }
    throw httpError('This link is invalid or has been removed.', 'NOT_FOUND');
}
function handleListShares(session){
    var sh = shareSheet();
    var values = sh.getDataRange().getValues();
    if(values.length < 2) return [];
    var c = shareCols(values);
    var out = [];
    var now = Date.now();
    for(var r=1;r<values.length;r++){
        var row = values[r];
        var tok = String(row[c.token]||'').trim();
        if(!tok) continue;
        var expStr = String(row[c.expiresAt]||'').trim();
        var exp = expStr ? new Date(expStr) : null;
        var expired = exp && !isNaN(exp.getTime()) && exp.getTime() < now;
        out.push({ token: tok, type: String(row[c.type]||''), title: String(row[c.title]||''), createdBy: String(row[c.createdBy]||''), createdAt: String(row[c.createdAt]||''), expiresAt: expStr, revoked: !!String(row[c.revoked]).trim(), expired: !!expired });
    }
    out.sort(function(a,b){ return (a.createdAt < b.createdAt) ? 1 : -1; });
    return out;
}
function handleRevokeShare(session, p){
    var token = String(p.token||'').trim();
    if(!token) throw httpError('Link id required.', 'BAD_REQUEST');
    var sh = shareSheet();
    var values = sh.getDataRange().getValues();
    var c = shareCols(values);
    for(var r=1;r<values.length;r++){
        if(String(values[r][c.token]).trim() === token){
            if(c.revoked>=0) sh.getRange(r+1, c.revoked+1).setValue('yes');
            return { revoked: true };
        }
    }
    throw httpError('Link not found.', 'NOT_FOUND');
}

function authorizeNow() {
  var to = Session.getEffectiveUser().getEmail();
  sendAppEmail(to, 'SMC Guidance - email is now authorized', 'This confirms email sending is authorized. Two-factor codes can now be emailed. You may close this.');
  return 'Test email sent to ' + to;
}
