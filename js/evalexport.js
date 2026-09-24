// evalexport.js  -  "Build Evaluation Workbooks" panel
// Calls the new backend action added by backend/EvalExport.gs.
// Self-mounting: it drops a card into the Evaluations > Folder panel.
window.SMC = window.SMC || {};
SMC.evalexport = (function () {
    'use strict';

    var busy = false;

    function esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function toast(msg, kind) {
        if (window.SMC && SMC.ui && SMC.ui.toast) { SMC.ui.toast(msg, kind); return; }
        if (kind === 'error') console.error(msg); else console.log(msg);
    }

    // In-page tutorial. Written so a first-time user can run a build without
    // any outside instructions. Collapsed state is remembered per browser.
    function helpTemplate() {
        return '' +
        '<div id="exHelp" class="ex-help" hidden>' +
          '<div class="ex-help-top">' +
            '<h4 class="ex-help-h">How to build evaluation workbooks</h4>' +
            '<button id="exHelpClose" class="ex-help-x" type="button" title="Close">&times;</button>' +
          '</div>' +

          '<ol class="ex-steps">' +
            '<li><b>Pick a teacher folder.</b> Use the dropdown on the left. ' +
              'Start with one teacher rather than <i>All teacher folders</i> &mdash; ' +
              'the whole folder holds hundreds of forms and can run past the time limit.</li>' +
            '<li><b>Click Preview.</b> This reads the forms and shows what it found ' +
              '(teacher, subject, section, how many students answered) ' +
              '<u>without</u> creating any file. Check the names look right.</li>' +
            '<li><b>Click Build workbooks.</b> This creates the Excel files in Google Drive. ' +
              'Each one lands in <b>Generated Evaluations &rsaquo; [TEACHER NAME]</b>.</li>' +
            '<li><b>Open the links.</b> When the build finishes, each workbook appears below ' +
              'with a link. They stay in Drive, so you do not need to build again.</li>' +
          '</ol>' +

          '<div class="ex-help-grid">' +
            '<div class="ex-help-box">' +
              '<div class="ex-help-bt">What the buttons do</div>' +
              '<div class="ex-help-kv"><span>Diagnose</span><em>Lists every file it can see in the folder. ' +
                'Use it when a teacher or form seems to be missing.</em></div>' +
              '<div class="ex-help-kv"><span>Preview</span><em>A dry run. Reads the data and reports, ' +
                'but writes nothing.</em></div>' +
              '<div class="ex-help-kv"><span>Build workbooks</span><em>The real thing. ' +
                'Creates the Excel files in Drive.</em></div>' +
            '</div>' +

            '<div class="ex-help-box">' +
              '<div class="ex-help-bt">What you get in each file</div>' +
              '<div class="ex-help-kv"><span>One tab per section</span><em>Named like <code>10A - AP</code> ' +
                '(grade, section letter, subject). Senior High keeps its section name, such as ' +
                '<code>MERCY - GENMATH</code>.</em></div>' +
              '<div class="ex-help-kv"><span>SUMMARY tab</span><em>Appears when a file holds two or more ' +
                'sections, comparing them side by side.</em></div>' +
              '<div class="ex-help-kv"><span>COMMENTS SUMMARY</span><em>Every student comment, ' +
                'shortest first, with repeats counted.</em></div>' +
            '</div>' +
          '</div>' +

          '<div class="ex-help-note">' +
            '<b>Good to know.</b> Averages are computed by the template formulas, not by the website, ' +
            'so the numbers match what the school already uses. ' +
            'Running a build twice replaces the earlier file for that teacher instead of piling up copies. ' +
            'A big folder can take a few minutes &mdash; leave the tab open while it works.' +
          '</div>' +
        '</div>';
    }

    // Toggle + remember. Opens by itself the first time, so a new user sees it.
    function bindHelp() {
        var panel = document.getElementById('exHelp');
        var btn = document.getElementById('exHelpBtn');
        var x = document.getElementById('exHelpClose');
        if (!panel || !btn) return;

        var KEY = 'smc_eval_help_seen';
        var seen = false;
        try { seen = localStorage.getItem(KEY) === '1'; } catch (e) { }
        if (!seen) panel.hidden = false;

        function show(on) {
            panel.hidden = !on;
            btn.textContent = on ? 'Hide guide' : 'How to use';
            try { localStorage.setItem(KEY, '1'); } catch (e) { }
        }
        show(!panel.hidden);

        btn.addEventListener('click', function () { show(panel.hidden); });
        if (x) x.addEventListener('click', function () { show(false); });
    }

    // "Generated Evaluations" browser. Workbooks already built stay in Drive,
    // so this lists them per teacher and spares the user a rebuild.
    function renderSaved(res) {
        var host = document.getElementById('exSaved');
        if (!host) return;
        if (!res) { host.innerHTML = ''; return; }

        var teachers = res.teachers || [];
        var loose = res.looseFiles || [];
        var total = res.totalFiles || 0;

        var h = '<div class="ex-saved-head">' +
            '<div>' +
              '<div class="ex-saved-title">Generated Evaluations</div>' +
              '<div class="ex-saved-sub">' +
                (total
                  ? total + ' workbook' + (total === 1 ? '' : 's') + ' already built across ' +
                    teachers.length + ' teacher folder' + (teachers.length === 1 ? '' : 's')
                  : 'No workbooks here yet. Build one and it will appear in this list.') +
                (res.outputFolderUrl
                  ? ' &middot; <a href="' + esc(res.outputFolderUrl) + '" target="_blank" rel="noopener">Open the Drive folder</a>'
                  : '') +
              '</div>' +
            '</div>' +
            '<button id="exSavedRefresh" class="ex-btn ex-btn-ghost" type="button">Refresh</button>' +
          '</div>';

        function fileRow(f) {
            return '<div class="ex-saved-file">' +
                '<a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.name) + '</a>' +
                (f.updated ? '<span class="ex-saved-when">' + esc(f.updated) + '</span>' : '') +
                (f.id ? '<button class="ex-saved-dl ex-prev-btn" type="button" data-id="' + esc(f.id) +
                        '" data-name="' + esc(f.name) + '">Preview</button>' : '') +
                (f.xlsxUrl ? '<a class="ex-saved-dl" href="' + esc(f.xlsxUrl) + '">Excel</a>' : '') +
              '</div>';
        }

        teachers.forEach(function (t) {
            var files = t.files || [];
            h += '<div class="ex-saved-group">' +
                '<div class="ex-saved-teacher">' +
                  (t.url
                    ? '<a href="' + esc(t.url) + '" target="_blank" rel="noopener">' + esc(t.teacher) + '</a>'
                    : esc(t.teacher)) +
                  '<span class="ex-saved-count">' + files.length + '</span>' +
                '</div>';
            files.forEach(function (f) { h += fileRow(f); });
            h += '</div>';
        });

        if (loose.length) {
            h += '<div class="ex-saved-group">' +
                '<div class="ex-saved-teacher">Not in a teacher folder' +
                  '<span class="ex-saved-count">' + loose.length + '</span></div>';
            loose.forEach(function (f) { h += fileRow(f); });
            h += '</div>';
        }

        host.innerHTML = h;

        var btn = document.getElementById('exSavedRefresh');
        if (btn) btn.addEventListener('click', function () { loadSaved(true); });
    }

    function loadSaved(announce) {
        if (!window.SMC || !SMC.api || !SMC.api.listGeneratedEvals) return;
        var host = document.getElementById('exSaved');
        if (host && announce) host.innerHTML = '<div class="ex-saved-sub">Loading...</div>';
        SMC.api.listGeneratedEvals().then(renderSaved).catch(function (err) {
            if (!host) return;
            host.innerHTML = '<div class="ex-saved-head"><div class="ex-saved-sub">' +
                'Could not list the generated workbooks. ' + esc(err && err.message ? err.message : String(err)) +
                '</div></div>';
        });
    }

    // Opens a workbook inside the site. Google serves a read-only rendering at
    // /preview, so the numbers and tabs are visible without granting edit
    // rights and without leaving the page.
    function openPreview(id, name) {
        closePreview();
        var wrap = document.createElement('div');
        wrap.id = 'exPrevWrap';
        wrap.className = 'ex-prev-wrap';
        wrap.innerHTML = '' +
            '<div class="ex-prev-box" role="dialog" aria-modal="true">' +
              '<div class="ex-prev-head">' +
                '<div class="ex-prev-name">' + esc(name || 'Workbook') + '</div>' +
                '<div class="ex-prev-acts">' +
                  '<a class="ex-saved-dl" href="https://docs.google.com/spreadsheets/d/' + esc(id) +
                    '/edit" target="_blank" rel="noopener">Open in Sheets</a>' +
                  '<a class="ex-saved-dl" href="https://docs.google.com/spreadsheets/d/' + esc(id) +
                    '/export?format=xlsx">Excel</a>' +
                  '<button class="ex-prev-x" type="button" id="exPrevX" title="Close">&times;</button>' +
                '</div>' +
              '</div>' +
              '<iframe class="ex-prev-frame" src="https://docs.google.com/spreadsheets/d/' +
                esc(id) + '/preview" loading="lazy"></iframe>' +
              '<div class="ex-prev-foot">Read-only preview. Sign in to the same Google account if it stays blank.</div>' +
            '</div>';
        document.body.appendChild(wrap);

        wrap.addEventListener('click', function (e) {
            if (e.target === wrap) closePreview();
        });
        var x = document.getElementById('exPrevX');
        if (x) x.addEventListener('click', closePreview);
        document.addEventListener('keydown', escClose);
    }

    function escClose(e) { if (e.key === 'Escape') closePreview(); }

    function closePreview() {
        var w = document.getElementById('exPrevWrap');
        if (w && w.parentNode) w.parentNode.removeChild(w);
        document.removeEventListener('keydown', escClose);
    }

    // Delegated so it keeps working after the list is re-rendered.
    function bindPreview() {
        if (bindPreview.__done) return;
        bindPreview.__done = true;
        document.addEventListener('click', function (e) {
            var t = e.target;
            if (!t || !t.className || String(t.className).indexOf('ex-prev-btn') < 0) return;
            e.preventDefault();
            openPreview(t.getAttribute('data-id'), t.getAttribute('data-name'));
        });
    }

    function template() {
        return '' +
            '<div class="ex-card" id="exCard">' +
            '<div class="ex-head">' +
            '<div>' +
            '<h3 class="ex-title">Build Evaluation Workbooks</h3>' +
            '<p class="ex-sub">Reads every teacher folder, fills the matching grade-level template, ' +
            'lets the template compute the averages, and adds a comments summary.</p>' +
            '</div>' +
            '</div>' +
            '<div class="ex-row">' +
            '<select id="exBatch" class="ex-select"><option value="">All teacher folders</option></select>' +
            '<button id="exHelpBtn" class="ex-btn ex-btn-ghost" type="button">How to use</button>' +
            '<button id="exDiag" class="ex-btn ex-btn-ghost" type="button">Diagnose</button>' +
            '<button id="exPreview" class="ex-btn ex-btn-ghost" type="button">Preview</button>' +
            '<button id="exBuild" class="ex-btn" type="button">Build workbooks</button>' +
            '</div>' +
            helpTemplate() +
            '<div id="exStatus" class="ex-status"></div>' +
            '<div id="exResults" class="ex-results"></div>' +
            '<div id="exSaved" class="ex-saved"></div>' +
            '</div>';
    }

    function setBusy(on, label) {
        busy = on;
        var build = document.getElementById('exBuild');
        var prev = document.getElementById('exPreview');
        var diag = document.getElementById('exDiag');
        if (build) { build.disabled = on; build.textContent = on ? (label || 'Working...') : 'Build workbooks'; }
        if (prev) prev.disabled = on;
        if (diag) diag.disabled = on;
    }

    function status(html, kind) {
        var el = document.getElementById('exStatus');
        if (!el) return;
        el.className = 'ex-status' + (kind ? ' ex-' + kind : '');
        el.innerHTML = html || '';
    }

    function loadBatches() {
        if (!window.SMC || !SMC.api || !SMC.api.listEvalBatches) return;
        SMC.api.listEvalBatches().then(function (res) {
            var sel = document.getElementById('exBatch');
            if (!sel || !res) return;
            var batches = res.batches || [];
            var html = '<option value="">All teacher folders (' + batches.length + ')</option>';
            batches.forEach(function (b) {
                // files === -1 means the backend deliberately skipped counting
                // (counting meant walking every subfolder, which took ~57s).
                var count = (typeof b.files === 'number' && b.files >= 0)
                    ? ' (' + b.files + ' file' + (b.files === 1 ? '' : 's') + ')'
                    : '';
                html += '<option value="' + esc(b.id) + '">' + esc(b.name) + count + '</option>';
            });
            sel.innerHTML = html;
            var total = (res.totalFiles === undefined || res.totalFiles === null ||
                res.totalFiles < 0 || res.countsSkipped) ? null : res.totalFiles;
            var extra = res.looseFiles ? ' &middot; ' + res.looseFiles + ' loose in the root' : '';
            if (total === 0) {
                status('Source folder <b>' + esc(res.folderName) + '</b> has no readable files. ' +
                    'Press <b>Diagnose</b> to see what is in there.', 'err');
            } else {
                status('Source folder: <b>' + esc(res.folderName) + '</b> &middot; ' +
                    batches.length + ' teacher folder(s)' +
                    (total === null ? '' : ' &middot; ' + total + ' readable file(s)') + extra +
                    (batches.length > 20
                        ? '. <b>Pick one teacher at a time</b> - this folder is too big to build in one go.'
                        : ''));
            }
        }).catch(function (err) {
            status('Could not list the Drive folder: ' + esc(err && err.message ? err.message : err), 'err');
        });
    }

    function renderResults(res) {
        var el = document.getElementById('exResults');
        if (!el) return;
        var files = (res && res.files) || [];
        var notes = (res && res.notes) || [];

        if (!files.length) {
            el.innerHTML = '<p class="ex-empty">Nothing to build. Check that the teacher folders contain forms, sheets or CSV files.</p>';
        } else {
            var html = '<table class="ex-table"><thead><tr>' +
                '<th>File</th><th>Template</th><th>Tabs (sections)</th><th>Responses</th><th></th>' +
                '</tr></thead><tbody>';
            files.forEach(function (f) {
                html += '<tr>' +
                    '<td><b>' + esc(f.name) + '</b></td>' +
                    '<td>' + esc(f.template) + '</td>' +
                    '<td>' + esc((f.tabs || []).join(', ')) + '</td>' +
                    '<td class="ex-num">' + (f.responses || 0) + '</td>' +
                    '<td>' + (f.url
                        ? '<a class="ex-link" target="_blank" rel="noopener" href="' + esc(f.url) + '">Open</a>' +
                          ' &middot; <a class="ex-link" href="' + esc(f.xlsxUrl) + '">Excel</a>'
                        : '<span class="ex-muted">preview</span>') + '</td>' +
                    '</tr>';
            });
            html += '</tbody></table>';

            if (res.outputFolderUrl) {
                html += '<p class="ex-foot">Saved to <a class="ex-link" target="_blank" rel="noopener" href="' +
                    esc(res.outputFolderUrl) + '">' + esc(res.outputFolder) + '</a> at ' + esc(res.generatedAt) + '.</p>';
            }
            el.innerHTML = html;
        }

        if (notes.length) {
            var warn = '<div class="ex-notes"><b>Notes</b><ul>';
            notes.forEach(function (n) { warn += '<li>' + esc(n) + '</li>'; });
            warn += '</ul></div>';
            el.innerHTML += warn;
        }
    }

    function run(dryRun) {
        if (busy) return;
        if (!window.SMC || !SMC.api || !SMC.api.buildEvalWorkbooks) {
            toast('The backend is missing the buildEvalWorkbooks action. See backend/INSTALL-EvalExport.md.', 'error');
            return;
        }
        var sel = document.getElementById('exBatch');
        var payload = { dryRun: !!dryRun };
        if (sel && sel.value) payload.folderId = sel.value;

        setBusy(true, dryRun ? 'Checking...' : 'Building...');
        status(dryRun
            ? 'Reading the folder and matching templates...'
            : 'Copying templates and pasting responses. Large folders can take a minute.');

        SMC.api.buildEvalWorkbooks(payload).then(function (res) {
            setBusy(false);
            var n = (res.files || []).length;
            var left = (res && res.remaining) || [];
            status((dryRun
                ? 'Preview only. ' + n + ' file(s) would be created.'
                : n + ' workbook(s) created.') +
                (left.length ? ' <b>' + left.length + ' teacher folder(s) still to do</b> - ' +
                    'pick them one at a time from the dropdown.' : ''),
                left.length ? 'err' : 'ok');
            renderResults(res);
            if (!dryRun) toast(n + ' evaluation workbook(s) built.', 'success');
        }).catch(function (err) {
            setBusy(false);
            var msg = err && err.message ? err.message : String(err);
            status('Failed: ' + esc(msg), 'err');
            toast(msg, 'error');
        });
    }

    // Shows every file the backend can see, and why anything was skipped.
    function diagnose() {
        if (busy) return;
        if (!window.SMC || !SMC.api || !SMC.api.diagnoseEvalFolder) {
            toast('The backend is missing the diagnoseEvalFolder action. Update EvalExport.gs and re-deploy.', 'error');
            return;
        }
        setBusy(true, 'Scanning...');
        status('Scanning the Drive folder, including subfolders and shortcuts...');

        SMC.api.diagnoseEvalFolder().then(function (res) {
            setBusy(false);
            var c = res.counts || {};
            var secs = res.elapsedMs ? ' in ' + (res.elapsedMs / 1000).toFixed(1) + 's' : '';
            status('Folder <b>' + esc(res.folderName) + '</b>: ' +
                (c.usable || 0) + ' readable, ' + (c.skipped || 0) + ' skipped, ' +
                (c.folders || 0) + ' subfolder(s)' +
                (c.shortcutFolders ? ', ' + c.shortcutFolders + ' folder shortcut(s)' : '') +
                (c.loops ? ', ' + c.loops + ' shortcut loop(s) skipped' : '') + secs,
                (c.usable ? 'ok' : 'err'));

            var rows = res.entries || [];
            var el = document.getElementById('exResults');
            if (!el) return;
            if (!rows.length) {
                el.innerHTML = '<p class="ex-empty">The folder is empty, or the Google account running ' +
                    'the script cannot see inside it. Check FORMS_FOLDER_ID and that the folder is ' +
                    'shared with that account.</p>';
                return;
            }
            var html = '<table class="ex-table"><thead><tr>' +
                '<th>Folder</th><th>File</th><th>Type Google reports</th><th>Used?</th>' +
                '</tr></thead><tbody>';
            rows.forEach(function (r) {
                html += '<tr>' +
                    '<td>' + esc(r.path || '(root)') + '</td>' +
                    '<td>' + esc(r.name) + '</td>' +
                    '<td><code>' + esc(r.mime) + '</code></td>' +
                    '<td>' + (r.usable ? 'yes' : '<span class="ex-muted">no - ' + esc(r.note) + '</span>') + '</td>' +
                    '</tr>';
            });
            html += '</tbody></table>';
            if (res.stopped) {
                html = '<div class="ex-notes"><b>The scan was cut short.</b> ' + esc(res.stopped) +
                    ' This usually means the folder tree is very large, or a shortcut points at a ' +
                    'parent folder or at your whole Drive. Check the Folder column below for any ' +
                    'path that looks unrelated to evaluations.</div>' + html;
            }
            if (res.capped && !res.stopped) html += '<p class="ex-foot">Only the first 400 entries are shown.</p>';
            if (res.folderUrl) {
                html += '<p class="ex-foot">Scanned <a class="ex-link" target="_blank" rel="noopener" href="' +
                    esc(res.folderUrl) + '">' + esc(res.folderName) + '</a>.</p>';
            }
            el.innerHTML = html;
        }).catch(function (err) {
            setBusy(false);
            var msg = err && err.message ? err.message : String(err);
            status('Diagnose failed: ' + esc(msg), 'err');
            toast(msg, 'error');
        });
    }

    function wire() {
        var build = document.getElementById('exBuild');
        var prev = document.getElementById('exPreview');
        var diag = document.getElementById('exDiag');
        if (build) build.addEventListener('click', function () { run(false); });
        if (prev) prev.addEventListener('click', function () { run(true); });
        if (diag) diag.addEventListener('click', diagnose);
    }

    // Mounts into the Evaluations > Folder panel, above the existing tools.
    function mount() {
        var host = document.getElementById('ebMount') ||
            document.getElementById('epPanel-folder') ||
            document.getElementById('evalProcMount');
        if (!host) return false;
        if (document.getElementById('exCard')) return true;

        var wrap = document.createElement('div');
        wrap.innerHTML = template();
        host.insertBefore(wrap.firstChild, host.firstChild);
        wire();
        bindHelp();
        bindPreview();
        loadBatches();
        loadSaved();
        return true;
    }

    // The Evaluations view renders lazily - #ebMount does not exist until the
    // user actually opens that tab, which can be many minutes after load.
    // So we watch the DOM permanently and also hook evalproc.render().
    function autoMount() {
        mount();

        // 1. Re-mount whenever the evaluations panel is (re)drawn.
        if (window.MutationObserver && document.body) {
            var observer = new MutationObserver(function () {
                if (!document.getElementById('exCard')) mount();
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }

        // 2. Belt and braces: wrap the renderer that builds the host element.
        var hook = setInterval(function () {
            if (!window.SMC || !SMC.evalproc || typeof SMC.evalproc.render !== 'function') return;
            clearInterval(hook);
            if (SMC.evalproc.__exWrapped) return;
            var original = SMC.evalproc.render;
            SMC.evalproc.render = function () {
                var out = original.apply(this, arguments);
                try { setTimeout(mount, 0); } catch (e) { }
                return out;
            };
            SMC.evalproc.__exWrapped = true;
        }, 200);

        // 3. Also try on any nav click, for older browsers without MutationObserver.
        document.addEventListener('click', function () {
            setTimeout(function () {
                if (!document.getElementById('exCard')) mount();
            }, 250);
        }, true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoMount);
    } else {
        autoMount();
    }

    return { mount: mount, refresh: loadBatches, build: run, diagnose: diagnose, saved: loadSaved, preview: openPreview };
})();
