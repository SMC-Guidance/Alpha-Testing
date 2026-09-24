"use strict";
window.SMC = window.SMC || {};
SMC.api = (function () {
    // Normal sessions remain tab-scoped. If the user explicitly checks
    // “Remember this device”, keep the signed session in localStorage so it can
    // survive closing and reopening the browser (the server still enforces the
    // configured SESSION_TTL_H expiry).
    var TOKEN_KEY = 'smc_token';
    var REMEMBER_KEY = 'smc_remember_login';
    function remembered() { try {
        return localStorage.getItem(REMEMBER_KEY) === '1';
    } catch (e) { return false; } }
    function getToken() { try {
        return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || null;
    }
    catch (e) {
        return null;
    } }
    function setToken(t, persist) { try {
        if (!t) {
            sessionStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(TOKEN_KEY);
            return;
        }
        var keep = (persist === undefined) ? remembered() : !!persist;
        if (keep) {
            localStorage.setItem(TOKEN_KEY, t);
            localStorage.setItem(REMEMBER_KEY, '1');
            sessionStorage.removeItem(TOKEN_KEY);
        } else {
            sessionStorage.setItem(TOKEN_KEY, t);
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(REMEMBER_KEY);
        }
    }
    catch (e) { } }
    function clearToken() { setToken(null); }
    function deviceId() {
        try {
            var d = localStorage.getItem('smc_device');
            if (!d) {
                var bytes = new Uint8Array(24);
                crypto.getRandomValues(bytes);
                d = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
                localStorage.setItem('smc_device', d);
            }
            return d;
        } catch (e) { return ''; }
    }
    function call(action, payload) {
        var url = (SMC.config && SMC.config.apiUrl) || '';
        if (!url || url.indexOf('PASTE_') === 0) {
            return Promise.reject(new Error('Backend not configured. Set SMC.config.apiUrl in js/config.js.'));
        }
        var body = JSON.stringify({
            action: action,
            token: getToken(),
            payload: payload || {}
        });
        // Long scans can outlast the default browser timeout, and a killed or
        // blocked request otherwise surfaces as the bare browser text
        // "Failed to fetch", which tells the user nothing. Give it a real
        // deadline and a message that explains what to check.
        var controller = null, timer = null;
        var opts = {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: body
        };
        try {
            if (typeof AbortController === 'function') {
                controller = new AbortController();
                opts.signal = controller.signal;
                timer = setTimeout(function () { try { controller.abort(); } catch (e) { } }, 360000);
            }
        } catch (e) { }

        function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }

        return fetch(url, opts).catch(function (netErr) {
            clearTimer();
            var aborted = netErr && (netErr.name === 'AbortError');
            if (aborted) {
                throw new Error('The server did not answer within 6 minutes, so the request was ' +
                    'stopped. Google cuts off any Apps Script request at that point. Try one ' +
                    'teacher folder at a time instead of all of them.');
            }
            if (!navigator.onLine) {
                throw new Error('You appear to be offline. Check your internet connection and try again.');
            }
            throw new Error('Could not reach the backend. This is usually one of three things: ' +
                '(1) the Apps Script deployment was not updated - open Deploy > Manage deployments ' +
                'and publish a New version; (2) the web app access is not set to "Anyone", so ' +
                'Google redirects to a sign-in page the site cannot read; or (3) the request was ' +
                'cut off. Original browser message: ' + (netErr && netErr.message ? netErr.message : netErr));
        }).then(function (r) {
            clearTimer();
            if (!r.ok && r.status >= 500) {
                throw new Error('The backend returned an error (HTTP ' + r.status + '). ' +
                    'Open the Apps Script project and check Executions for the failing run.');
            }
            // Read the body as text first. When it is not JSON the actual page
            // content names the cause, so surface it instead of guessing.
            return r.text().then(function (body) {
                try {
                    return JSON.parse(body);
                } catch (parseErr) {
                    var raw = String(body || '');
                    var snippet = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
                    var hint = '';
                    if (/accounts\.google\.com|sign ?in/i.test(raw)) {
                        hint = ' It looks like a Google sign-in page, so set the web app access to "Anyone".';
                    } else if (/exceeded maximum execution time/i.test(raw)) {
                        hint = ' The script hit Google\'s 6-minute limit. Run one teacher folder at a time.';
                    } else if (/temporarily unavailable|try again later|error has occurred/i.test(raw)) {
                        hint = ' Google returned a temporary error page. Wait a minute and retry.';
                    } else if (/authoriz/i.test(raw)) {
                        hint = ' The script needs authorization. Open the editor and run authorizeOnce.';
                    }
                    throw new Error('The backend replied with something that is not JSON (HTTP ' +
                        r.status + ').' + hint + ' First part of the reply: ' +
                        (snippet || '(the reply was empty)'));
                }
            });
        }).then(function (res) {
            if (!res || res.ok !== true) {
                var msg = (res && res.error) || 'Request failed.';
                if (res && res.code === 'AUTH') {
                    clearToken();
                }
                // Force-block: the server refused because the whole site is in
                // maintenance. Show the maintenance screen to everyone at once.
                if (res && res.code === 'MAINTENANCE' && window.SMC && SMC.app && SMC.app.showSiteMaint) {
                    try { SMC.app.showSiteMaint(msg); } catch (e2) { }
                }
                var err = new Error(msg);
                err.code = res && res.code;
                throw err;
            }
            // Sliding session: the server returns a fresh token when the current
            // one is past half its life, so active users are never logged out.
            if (res.token) setToken(res.token);
            return res.data;
        });
    }
    return {
        getToken: getToken,
        setToken: setToken,
        clearToken: clearToken,
        login: function (username, password) {
            return call('login', { username: username, password: password, deviceId: deviceId() }).then(function (d) {
                if (d && d.token)
                    setToken(d.token, !!d.remembered);
                return d;
            });
        },
        verify2fa: function (username, password, code, remember) {
            return call('verify2fa', { username: username, password: password, code: code, deviceId: deviceId(), remember: !!remember }).then(function (d) {
                if (d && d.token)
                    setToken(d.token, !!remember);
                return d;
            });
        },
        set2faEmail: function (username, password, email) {
            return call('set2faEmail', { username: username, password: password, email: email, deviceId: deviceId() });
        },
        resend2fa: function (username, password) {
            return call('resend2fa', { username: username, password: password, deviceId: deviceId() });
        },
        register: function (data) { return call('register', data); },
        me: function () { return call('me', {}); },
        records: function () { return call('records', {}); },
        publicStats: function () { return call('publicStats', {}); },
        listUsers: function () { return call('listUsers', {}); },
        deleteUser: function (username) { return call('deleteUser', { username: username }); },
        setRole: function (username, role) { return call('setRole', { username: username, role: role }); },
        listEvaluations: function () { return call('listEvaluations', {}); },
        saveEvaluation: function (data) { return call('saveEvaluation', data); },
        deleteEvaluation: function (id) { return call('deleteEvaluation', { id: id }); },
        evalTemplates: function () { return call('evalTemplates', {}); },
        evalSheetColumns: function (sheetId, tabName) { return call('evalSheetColumns', { sheetId: sheetId, tabName: tabName }); },
        listEvalConfigs: function () { return call('listEvalConfigs', {}); },
        saveEvalConfig: function (data) { return call('saveEvalConfig', data); },
        deleteEvalConfig: function (id) { return call('deleteEvalConfig', { id: id }); },
        processEval: function (id) { return call('processEval', { id: id }); },
        quickProcessEval: function (sheetId, tabName) { return call('quickProcessEval', { sheetId: sheetId, tabName: tabName }); },
        listForms: function () { return call('listForms', {}); },
        listEvalBatches: function () { return call('listEvalBatches', {}); },
        buildEvalWorkbooks: function (opts) { return call('buildEvalWorkbooks', opts || {}); },
        diagnoseEvalFolder: function () { return call('diagnoseEvalFolder', {}); },
        listGeneratedEvals: function () { return call('listGeneratedEvals', {}); },
        getFormResponses: function (fileId) { return call('getFormResponses', { fileId: fileId }); },
        getMaintenance: function () { return call('getMaintenance', {}); },
        setMaintenance: function (view, on) { return call('setMaintenance', { view: view, on: !!on }); },
        getProfile: function () { return call('getProfile', {}); },
        saveProfile: function (data) { return call('saveProfile', data); },
        saveReport: function (message) { return call('saveReport', { message: message }); },
        listReports: function () { return call('listReports', {}); },
        setReportStatus: function (id, status) { return call('setReportStatus', { id: id, status: status }); },
        listIncidents: function () { return call('listIncidents', {}); },
        listClassLists: function () { return call('listClassLists', {}); },
        saveIncident: function (data) { return call('saveIncident', data); },
        deleteIncident: function (id) { return call('deleteIncident', { id: id }); },
        listClassFlags: function () { return call('listClassFlags', {}); },
        saveClassFlag: function (data) { return call('saveClassFlag', data); },
        getClassColors: function () { return call('getClassColors', {}); },
        setClassColor: function (data) { return call('setClassColor', data); },
        listRoutine: function () { return call('listRoutine', {}); },
        listSchedules: function () { return call('listSchedules', {}); },
        saveRoutine: function (data) { return call('saveRoutine', data); },
        securityStatus: function () { return call('securityStatus', {}); },
        unlockSite: function (code) { return call('unlockSite', { code: code }); },
        getSecurity: function () { return call('getSecurity', {}); },
        setSecurity: function (data) { return call('setSecurity', data); },
        chatPoll: function () { return call('chatPoll', {}); },
        getThread: function (withUser) { return call('getThread', { withUser: withUser }); },
        sendMessage: function (to, text) { return call('sendMessage', { to: to, text: text }); },
        chatDirectory: function () { return call('chatDirectory', {}); },
        broadcast: function (text, to) { return call('chatBroadcast', { text: text, to: to || '' }); },
        deleteMessage: function (id) { return call('deleteMessage', { id: id }); },
        clearMessages: function () { return call('clearMessages', {}); },
        unsendMessage: function (id) { return call('unsendMessage', { id: id }); },
        setChatMute: function (username, muted) { return call('setChatMute', { username: username, muted: muted }); },
        setPresenceMode: function (mode) { return call('setPresenceMode', { mode: mode }); },
        getSiteMaint: function () { return call('getSiteMaint', {}); },
        setSiteMaint: function (on, message) { return call('setSiteMaint', { on: !!on, message: message || '' }); },
        maintOff: function (code) { return call('maintOff', { code: code }); },
        createShare: function (data) { return call('createShare', data || {}); },
        getShared: function (token) { return call('getShared', { token: token }); },
        listShares: function () { return call('listShares', {}); },
        revokeShare: function (token) { return call('revokeShare', { token: token }); }
    };
})();
