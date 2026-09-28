"use strict";
window.SMC = window.SMC || {};
SMC.app = (function () {
    var ui = SMC.ui, api = SMC.api;
    var user = null, warnTimer = null, hardTimer = null;
    var maintenance = {}, currentView = 'dashboard';
    function showScreen(id) {
        document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
        document.getElementById(id).classList.add('active');
    }
    var VIEW_META = {
        dashboard: { el: 'dashView', nav: 'navDash', title: 'Dashboard', sub: 'Stella Maris College \u00b7 Guidance Office' },
        counselors: { el: 'counselorsView', nav: 'navCounselors', title: 'Staff & Guidance Designates', sub: 'Manage accounts and access levels' },
        evaluations: { el: 'evalView', nav: 'navEval', title: 'Teachers Evaluation', sub: 'Choose a focused tool for online or paper evaluations' },
        procedures: { el: 'proceduresView', nav: 'navProcedures', title: 'Assessment Procedures', sub: 'Reference for student & teacher applicants' },
        profile: { el: 'profileView', nav: 'navProfile', title: 'My Profile', sub: 'Your photo, notes & profile guide' },
        incidents: { el: 'incidentsView', nav: 'navIncidents', title: 'Incident Reports', sub: 'Log, view, print & manage incident reports' },
        classlists: { el: 'classListsView', nav: 'navClassLists', title: 'Class Lists', sub: 'Official class lists by year level \u00b7 SY 2026-2027' },
        routine: { el: 'routineView', nav: 'navRoutine', title: 'Routine Interviews', sub: 'Track routine interviews per guidance designate' },
        schedule: { el: 'scheduleView', nav: 'navSchedule', title: 'Schedules', sub: 'Browse teacher & class schedules \u00b7 SY 2026-2027' }
    };
    function isAdminUser() { return !!(user && user.role === 'admin'); }
    function maintHost() { return document.querySelector('.main') || document.body; }
    function showMaintNotice(title) {
        var n = document.getElementById('maintNotice');
        if (!n) {
            n = document.createElement('div');
            n.id = 'maintNotice';
            n.className = 'maint-notice';
            maintHost().appendChild(n);
        }
        n.innerHTML = '<div class="maint-card"><div class="maint-ic"><svg width="46" height="46" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.1-2.1 2.6-2.6z"/></svg></div><h3>' + ui.esc(title) + ' is under maintenance</h3><p>This section is temporarily unavailable. Please check back later.</p></div>';
        n.style.display = '';
    }
    function hideMaintNotice() { var n = document.getElementById('maintNotice'); if (n)
        n.style.display = 'none'; }
    function showAdminBanner() {
        var b = document.getElementById('maintAdminBanner');
        if (!b) {
            b = document.createElement('div');
            b.id = 'maintAdminBanner';
            b.className = 'maint-admin-banner';
            var host = maintHost();
            host.insertBefore(b, host.children[1] || null);
        }
        b.innerHTML = '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span>This tab is <strong>under maintenance</strong> \u2014 only you can see it. Others get an "under maintenance" notice. Use the header button to bring it back online.</span>';
        b.style.display = '';
    }
    function hideAdminBanner() { var b = document.getElementById('maintAdminBanner'); if (b)
        b.style.display = 'none'; }
    function updateSearchVisibility() {
        var onDash = !!user && currentView === 'dashboard';
        var top = document.getElementById('topSearch');
        if (top)
            top.style.display = onDash ? '' : 'none';
        var mob = document.getElementById('mobSearchWrap');
        if (mob)
            mob.style.display = (onDash && window.innerWidth <= 768) ? 'flex' : 'none';
    }
    function showView(v) {
        if (!VIEW_META[v])
            v = 'dashboard';
        currentView = v;
        updateSearchVisibility();
        document.querySelectorAll('.sbi, .sbsubi').forEach(function (b) { b.classList.remove('on'); });
        var nav = document.getElementById(VIEW_META[v].nav);
        if (nav)
            nav.classList.add('on');
        document.getElementById('viewTitle').textContent = VIEW_META[v].title;
        document.getElementById('viewSub').textContent = VIEW_META[v].sub;
        updateMaintBtn();
        var locked = !!maintenance[v];
        if (locked && !isAdminUser()) {
            Object.keys(VIEW_META).forEach(function (k) { var el = document.getElementById(VIEW_META[k].el); if (el)
                el.style.display = 'none'; });
            hideAdminBanner();
            showMaintNotice(VIEW_META[v].title);
            return;
        }
        hideMaintNotice();
        Object.keys(VIEW_META).forEach(function (k) { var el = document.getElementById(VIEW_META[k].el); if (el)
            el.style.display = k === v ? '' : 'none'; });
        if (locked && isAdminUser())
            showAdminBanner();
        else
            hideAdminBanner();
        if (v === 'counselors')
            renderCounselors();
        if (v === 'evaluations' && SMC.evalhub && SMC.evalhub.mount)
            SMC.evalhub.mount();
        if (v === 'evaluations' && SMC.evalexport && SMC.evalexport.mount)
            SMC.evalexport.mount();
        if (v === 'evaluations' && SMC.k2manual && SMC.k2manual.mount) {
            SMC.k2manual.mount();
            if (SMC.k2manual.refresh) SMC.k2manual.refresh();
        }
        if (v === 'procedures')
            SMC.procedures.render();
        if (v === 'profile' && SMC.profile && SMC.profile.render)
            SMC.profile.render();
        if (v === 'incidents' && SMC.incidents)
            SMC.incidents.render();
        if (v === 'classlists' && SMC.classlists)
            SMC.classlists.render();
        if (v === 'routine' && SMC.routine)
            SMC.routine.render();
        if (v === 'schedule' && SMC.schedule)
            SMC.schedule.render();
    }
    function updateMaintBtn() {
        var btn = document.getElementById('maintBtn');
        if (!btn)
            return;
        if (!isAdminUser()) {
            btn.style.display = 'none';
            return;
        }
        btn.style.display = '';
        var locked = !!maintenance[currentView];
        btn.classList.toggle('on', locked);
        btn.innerHTML = locked
            ? '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><span>Under maintenance</span>'
            : '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg><span>Set maintenance</span>';
    }
    function applyNavLocks() {
        Object.keys(VIEW_META).forEach(function (k) {
            var nav = document.getElementById(VIEW_META[k].nav);
            if (nav)
                nav.classList.toggle('nav-maint', !!maintenance[k] && isAdminUser());
        });
    }
    function persistMaintLocal() { try {
        localStorage.setItem('smc-maintenance', JSON.stringify(maintenance));
    }
    catch (e) { } }
    function loadMaintenance() {
        try {
            var raw = localStorage.getItem('smc-maintenance');
            if (raw)
                maintenance = JSON.parse(raw) || {};
        }
        catch (e) {
            maintenance = {};
        }
        applyNavLocks();
        updateMaintBtn();
        if (api.getMaintenance)
            api.getMaintenance().then(function (r) { if (r && r.maintenance) {
                maintenance = r.maintenance;
                persistMaintLocal();
                applyNavLocks();
                showView(currentView);
            } }).catch(function () { });
    }
    function toggleMaintenance() {
        if (!isAdminUser())
            return;
        var v = currentView, turnOn = !maintenance[v];
        if (turnOn)
            maintenance[v] = true;
        else
            delete maintenance[v];
        persistMaintLocal();
        applyNavLocks();
        showView(v);
        ui.toast(turnOn ? (VIEW_META[v].title + ' is now under maintenance.') : (VIEW_META[v].title + ' is back online.'), 'ok');
        if (api.setMaintenance)
            api.setMaintenance(v, turnOn).then(function (r) { if (r && r.maintenance) {
                maintenance = r.maintenance;
                persistMaintLocal();
                applyNavLocks();
            } }).catch(function () { ui.toast('Saved on this device. Redeploy the backend to apply it for everyone.', 'warn'); });
    }
    function startTimers(expiresAt) {
        clearTimers();
        if (!expiresAt)
            return;
        var warnAt = expiresAt - SMC.config.warnBefore;
        if (warnAt > Date.now())
            warnTimer = setTimeout(function () { document.getElementById('sesNote').classList.add('on'); }, warnAt - Date.now());
        hardTimer = setTimeout(function () {
            ui.toast('Session expired \u2014 please sign in again.', 'err');
            setTimeout(function () { SMC.auth.doLogout(); }, 1500);
        }, Math.max(0, expiresAt - Date.now()));
    }
    function clearTimers() {
        clearTimeout(hardTimer);
        clearTimeout(warnTimer);
        hardTimer = warnTimer = null;
        var n = document.getElementById('sesNote');
        if (n)
            n.classList.remove('on');
    }
    function openSidebar() {
        document.getElementById('sidebar').classList.add('expanded');
        document.getElementById('mobOverlay').classList.add('on');
        document.body.style.overflow = 'hidden';
    }
    function closeSidebar() {
        document.getElementById('sidebar').classList.remove('expanded');
        document.getElementById('mobOverlay').classList.remove('on');
        document.body.style.overflow = '';
    }
    function renderCounselors() {
        var tb = document.getElementById('cTbody');
        var isAdmin = user && user.role === 'admin';
        tb.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--mist);padding:20px">Loading\u2026</td></tr>';
        api.listUsers().then(function (users) {
            var html = '';
            (users || []).forEach(function (u, i) {
                var isSelf = user && u.username === user.username;
                var canRemove = u.role !== 'admin' && !isSelf;
                var roleCls = u.role === 'admin' ? 'ra' : (u.role === 'co-admin' ? 'rco' : 'rc');
                var roleBtn = '';
                if (isAdmin && u.role !== 'admin' && !isSelf) {
                    roleBtn = (u.role === 'co-admin')
                        ? '<button class="tbtn bp" data-role-set="counselor" data-role-user="' + ui.esc(u.username) + '">Revoke co-admin</button>'
                        : '<button class="tbtn bp" data-role-set="co-admin" data-role-user="' + ui.esc(u.username) + '">Make co-admin</button>';
                }
                var delBtn = canRemove
                    ? '<button class="tbtn bdel" data-del="' + ui.esc(u.username) + '">Remove</button>'
                    : '<span style="font-size:11px;color:var(--mist)">' + (isSelf ? '(you)' : '\u2014') + '</span>';
                html += '<tr>' +
                    '<td style="color:var(--mist);font-size:11px">' + (i + 1) + '</td>' +
                    '<td style="font-weight:500">' + ui.esc(u.name) + '</td>' +
                    '<td style="color:var(--mist)">' + ui.esc(u.username) + '</td>' +
                    '<td><span class="rpill ' + roleCls + '">' + ui.esc(u.role === 'counselor' ? 'guidance designate' : u.role) + '</span></td>' +
                    '<td><div class="action-col" style="display:flex;gap:4px;flex-wrap:wrap">' + roleBtn + delBtn + '</div></td></tr>';
            });
            tb.innerHTML = html || '<tr><td colspan="5" style="text-align:center;color:var(--mist);padding:20px">No accounts found.</td></tr>';
        }).catch(function (e) {
            tb.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--red);padding:20px">' + ui.esc(e.message || 'Could not load.') + '</td></tr>';
        });
    }
    function bindCounselors() {
        document.getElementById('cTbody').addEventListener('click', function (e) {
            var del = e.target.closest('button[data-del]');
            var role = e.target.closest('button[data-role-set]');
            if (del) {
                var username = del.getAttribute('data-del');
                if (!confirm('Remove account "' + username + '"? This cannot be undone.'))
                    return;
                api.deleteUser(username).then(function () {
                    ui.toast('Account removed.', 'ok');
                    renderCounselors();
                }).catch(function (er) { ui.toast(er.message || 'Could not remove account.', 'err'); });
            }
            else if (role) {
                var tgt = role.getAttribute('data-role-user');
                var newRole = role.getAttribute('data-role-set');
                var verb = newRole === 'co-admin' ? 'Make "' + tgt + '" a co-admin?' : 'Revoke co-admin access from "' + tgt + '"?';
                if (!confirm(verb))
                    return;
                api.setRole(tgt, newRole).then(function () {
                    ui.toast('Access level updated.', 'ok');
                    renderCounselors();
                }).catch(function (er) { ui.toast(er.message || 'Could not update access.', 'err'); });
            }
        });
    }
    function loadData() {
        document.getElementById('tableLoader').classList.add('on');
        api.records().then(function (rows) {
            document.getElementById('tableLoader').classList.remove('on');
            SMC.records.setData(rows);
        }).catch(function (e) {
            document.getElementById('tableLoader').classList.remove('on');
            document.getElementById('tbody').innerHTML =
                '<tr><td colspan="7"><div class="empty">' +
                    '<svg width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">' +
                    '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>' +
                    '<line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
                    '<p>' + ui.esc(e.message || 'Could not load data.') + '</p></div></td></tr>';
            if (e.code === 'AUTH')
                setTimeout(function () { SMC.auth.doLogout(); }, 1200);
        });
    }
    function boot(u) {
        user = u;
        var initial = (u.name || '?').charAt(0).toUpperCase();
        document.getElementById('sbAv').textContent = initial;
        document.getElementById('sbName').textContent = u.name;
        document.getElementById('sbRole').textContent = (u.role === 'counselor' ? 'Guidance Designate' : u.role);
        var pmAvEl = document.getElementById('pmAv'); if (pmAvEl) pmAvEl.textContent = initial;
        var pmNameEl = document.getElementById('pmName'); if (pmNameEl) pmNameEl.textContent = u.name;
        var pmRoleEl = document.getElementById('pmRole'); if (pmRoleEl) pmRoleEl.textContent = (u.role === 'counselor' ? 'Guidance Designate' : u.role);
        var staff = u.role === 'admin' || u.role === 'co-admin';
        document.getElementById('navCounselors').style.display = staff ? '' : 'none';
        var neg = document.getElementById('navEvalGroup'); if (neg) neg.style.display = '';
        document.getElementById('navProcedures').style.display = '';
        var np = document.getElementById('navProfile');
        if (np)
            np.style.display = '';
        if (SMC.evaluations && SMC.evaluations.setUser) SMC.evaluations.setUser(u);
        loadMaintenance();
        if (SMC.evaluations && SMC.evaluations.refreshChrome) SMC.evaluations.refreshChrome();
        if (SMC.settings && SMC.settings.setUser) SMC.settings.setUser(u);
        if (SMC.incidents && SMC.incidents.setUser) SMC.incidents.setUser(u);
        if (SMC.classlists && SMC.classlists.setUser) SMC.classlists.setUser(u);
        if (SMC.routine && SMC.routine.setUser) SMC.routine.setUser(u);
        if (SMC.schedule && SMC.schedule.setUser) SMC.schedule.setUser(u);
        if (SMC.chat && SMC.chat.setUser) SMC.chat.setUser(u);
        window.__smcUser = u;
        startTimers(u.expiresAt);
        showScreen('appScreen');
        showView('dashboard');
        maybeShowWhatsNew();
        checkSiteMaint();
        if (!window.__smcMaintTimer) window.__smcMaintTimer = setInterval(checkSiteMaint, 60000);
        loadData();
        refreshEvalStats();
        updateSearchVisibility();
    }
    function refreshEvalStats() {
        var el = document.getElementById('stEv');
        if (!el || !api.listEvaluations)
            return;
        api.listEvaluations().then(function (rows) {
            rows = rows || [];
            var done = rows.filter(function (o) { return (o.status || '') === 'Done'; }).length;
            el.textContent = rows.length;
            var sub = document.getElementById('stEvSub');
            if (sub)
                sub.textContent = done + ' done · ' + (rows.length - done) + ' open';
        }).catch(function () { });
    }
    function reset() {
        user = null;
        window.__smcUser = null;
        clearTimers();
        if (SMC.chat && SMC.chat.setUser) SMC.chat.setUser(null);
        SMC.charts.destroy();
    }
    function init() {
        if (SMC.share && SMC.share.check()) return;
        if (SMC.share && SMC.share.bind) SMC.share.bind();
        SMC.auth.bind();
        SMC.records.bind();
        bindCounselors();
        if (SMC.evaluations && SMC.evaluations.bind) SMC.evaluations.bind();
        if (SMC.settings && SMC.settings.bind) SMC.settings.bind();
        document.getElementById('navDash').addEventListener('click', function () { showView('dashboard'); });
        var navHome = document.getElementById('navHome');
        if (navHome) navHome.addEventListener('click', function () { showView('dashboard'); if (window.innerWidth <= 768) closeSidebar(); });
        setupWhatsNew();
        document.getElementById('navCounselors').addEventListener('click', function () { showView('counselors'); });
        document.getElementById('navEval').addEventListener('click', function () { showView('evaluations'); });
        document.getElementById('navProcedures').addEventListener('click', function () { showView('procedures'); });
        (function () {
            var grp = document.getElementById('navEvalGroup');
            if (!grp) return;
            var closeT;
            grp.addEventListener('mouseenter', function () { clearTimeout(closeT); grp.classList.add('open'); });
            grp.addEventListener('mouseleave', function () { closeT = setTimeout(function () { grp.classList.remove('open'); }, 160); });
        })();
        (function () {
            var pm = document.getElementById('profileMenu');
            var pb = document.getElementById('profileBtn');
            var menu = document.getElementById('profileDropdown');
            if (pm && pb && menu) {
                var positionMenu = function () {
                    if (window.innerWidth <= 768) { menu.style.top = ''; menu.style.right = ''; menu.style.left = ''; return; }
                    var r = pb.getBoundingClientRect();
                    menu.style.top = (r.bottom + 8) + 'px';
                    menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
                    menu.style.left = 'auto';
                };
                var closeMenu = function () { pm.classList.remove('open'); pb.setAttribute('aria-expanded', 'false'); };
                var openMenu = function () { positionMenu(); pm.classList.add('open'); pb.setAttribute('aria-expanded', 'true'); };
                var pick = function (view) { closeMenu(); showView(view); if (window.innerWidth <= 768) closeSidebar(); };
                pb.addEventListener('click', function (e) { e.stopPropagation(); if (pm.classList.contains('open')) closeMenu(); else openMenu(); });
                document.getElementById('pmProfile').addEventListener('click', function () { pick('profile'); });
                document.getElementById('pmSettings').addEventListener('click', function () { closeMenu(); if (window.innerWidth <= 768) closeSidebar(); if (SMC.settings && SMC.settings.open) SMC.settings.open(user); });
                document.getElementById('pmHelp').addEventListener('click', function () { closeMenu(); if (wnIntroOpen) wnIntroOpen(); else showTutorial(); });
                document.getElementById('pmLogout').addEventListener('click', function () { closeMenu(); SMC.auth.doLogout(); });
                document.addEventListener('click', function (e) { if (pm.classList.contains('open') && !pm.contains(e.target)) closeMenu(); });
                window.addEventListener('resize', function () { if (pm.classList.contains('open')) { if (window.innerWidth <= 768) closeMenu(); else positionMenu(); } });
            }
        })();
        (function () {
            var tut = document.getElementById('tutorial');
            if (!tut) return;
            var closeTut = function () { tut.classList.remove('on'); tut.setAttribute('aria-hidden', 'true'); };
            document.getElementById('tutClose').addEventListener('click', closeTut);
            document.getElementById('tutDone').addEventListener('click', closeTut);
            tut.addEventListener('click', function (e) { if (e.target === tut) closeTut(); });
            document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && tut.classList.contains('on')) closeTut(); });
        })();
        var dashInc = document.getElementById('dashIncidentsBtn');
        if (dashInc) dashInc.addEventListener('click', function () { showView('incidents'); });
        setupDashStudentSearch();
        var navCl = document.getElementById('navClassLists');
        if (navCl) navCl.addEventListener('click', function () { showView('classlists'); });
        var navRi = document.getElementById('navRoutine');
        if (navRi) navRi.addEventListener('click', function () { showView('routine'); });
        var navSch = document.getElementById('navSchedule');
        if (navSch) navSch.addEventListener('click', function () { showView('schedule'); });
        if (SMC.cmd && SMC.cmd.init) SMC.cmd.init();
        var _mas = document.getElementById('maintAdminSignin');
        if (_mas) _mas.addEventListener('click', function () { if (SMC.cmd && SMC.cmd.open) SMC.cmd.open(); });
        (function () {
            var lb = document.getElementById('lockUnlockBtn');
            if (!lb) return;
            lb.addEventListener('click', function () {
                var code = document.getElementById('lockCode').value;
                var lerr = document.getElementById('lockErr');
                lerr.classList.remove('on');
                lb.disabled = true; lb.textContent = 'Unlocking…';
                api.unlockSite(code).then(function () {
                    lb.disabled = false; lb.textContent = 'Unlock Website';
                    document.getElementById('lockCode').value = '';
                    hideLock(); ui.toast('Website unlocked.', 'ok');
                }).catch(function (e) {
                    lb.disabled = false; lb.textContent = 'Unlock Website';
                    ui.showErr(lerr, e.message || 'Unlock failed.');
                });
            });
            var lc = document.getElementById('lockCode');
            if (lc) lc.addEventListener('keydown', function (e) { if (e.key === 'Enter') lb.click(); });
        })();
        checkLock();
        checkSiteMaint();
        if (!window.__smcMaintTimer) window.__smcMaintTimer = setInterval(checkSiteMaint, 60000);
        window.addEventListener('storage', function (e) { if (e.key === 'smc_token') location.reload(); });
        var mb = document.getElementById('maintBtn');
        if (mb)
            mb.addEventListener('click', toggleMaintenance);
        (function () {
            var tb = document.getElementById('themeToggle');
            if (!tb)
                return;
            function sync() { var d = document.documentElement.getAttribute('data-theme') === 'dark'; var sp = tb.querySelector('span'); if (sp)
                sp.textContent = d ? 'Light mode' : 'Dark mode'; tb.setAttribute('aria-pressed', d ? 'true' : 'false'); }
            sync();
            tb.addEventListener('click', function () { var d = document.documentElement.getAttribute('data-theme') === 'dark'; if (d) {
                document.documentElement.removeAttribute('data-theme');
            }
            else {
                document.documentElement.setAttribute('data-theme', 'dark');
            } try {
                localStorage.setItem('smc-theme', d ? 'light' : 'dark');
            }
            catch (e) { } sync(); });
        })();
        document.getElementById('mobMenuBtn').addEventListener('click', openSidebar);
        document.getElementById('mobOverlay').addEventListener('click', closeSidebar);
        document.getElementById('sidebar').addEventListener('click', function (e) {
            if (window.innerWidth <= 768 && e.target.closest('.sbi'))
                closeSidebar();
        });
        window.addEventListener('resize', function () {
            if (window.innerWidth > 768) {
                closeSidebar();
            }
            updateSearchVisibility();
        });
        function finishBoot() { document.getElementById('boot').classList.add('gone'); }
        if (api.getToken()) {
            api.me().then(function (u) { finishBoot(); boot(u); })
                .catch(function () { api.clearToken(); finishBoot(); showScreen('authScreen'); loadPublicStats(); });
        }
        else {
            finishBoot();
            showScreen('authScreen');
            loadPublicStats();
        }
    }
    function loadPublicStats() {
        api.publicStats().then(function (s) {
            if (!s)
                return;
            if (s.totalSessions != null)
                document.getElementById('authTotal').textContent = s.totalSessions;
            if (s.totalStudents != null)
                document.getElementById('authStudents').textContent = s.totalStudents;
        }).catch(function () { });
    }
    function showTutorial() {
        var t = document.getElementById('tutorial');
        if (!t)
            return;
        t.classList.add('on');
        t.setAttribute('aria-hidden', 'false');
        var pm = document.getElementById('profileMenu');
        if (pm)
            pm.classList.remove('open');
    }
    function showLock() { var o = document.getElementById('lockOverlay'); if (o) { o.classList.add('on'); o.setAttribute('aria-hidden', 'false'); } }
    function hideLock() { var o = document.getElementById('lockOverlay'); if (o) { o.classList.remove('on'); o.setAttribute('aria-hidden', 'true'); } }
    function checkLock() { if (!api.securityStatus) return; api.securityStatus().then(function (s) { if (s && s.locked) showLock(); else hideLock(); }).catch(function () { }); }
    function showSiteMaint(msg) { var o = document.getElementById('siteMaintOverlay'); if (!o) return; var m = document.getElementById('siteMaintMsg'); if (m) m.textContent = msg || 'The site is temporarily down for maintenance. Please check back soon.'; o.classList.add('on'); o.setAttribute('aria-hidden', 'false'); }
    function hideSiteMaint() { var o = document.getElementById('siteMaintOverlay'); if (o) { o.classList.remove('on'); o.setAttribute('aria-hidden', 'true'); } }
    function showMaintSiteBanner() {
        var b = document.getElementById('maintSiteBanner');
        if (!b) {
            b = document.createElement('div');
            b.id = 'maintSiteBanner';
            b.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2100;background:#8a1c1c;color:#fff;padding:9px 16px;font-size:.82rem;line-height:1.4;text-align:center;box-shadow:0 -4px 18px rgba(0,0,0,.28)';
            document.body.appendChild(b);
        }
        b.innerHTML = 'The site is in <strong>maintenance mode</strong> \u2014 only administrators can access it right now. Everyone else sees the maintenance notice. Turn it off from the Command Center when you are done.';
        b.style.display = '';
    }
    function hideMaintSiteBanner() { var b = document.getElementById('maintSiteBanner'); if (b) b.style.display = 'none'; }
    var maintNotified = false;
    function checkSiteMaint() { if (!api.getSiteMaint) return; api.getSiteMaint().then(function (m) { var isAdmin = window.__smcUser && window.__smcUser.role === 'admin'; if (m && m.on && !isAdmin) { hideMaintSiteBanner(); showSiteMaint(m.message); } else { hideSiteMaint(); if (m && m.on && isAdmin) { showMaintSiteBanner(); } else { hideMaintSiteBanner(); } } }).catch(function () { }); }
    function setupDashClassDropdown() {
        var btn = document.getElementById('dashClassListsBtn');
        var menu = document.getElementById('dashClMenu');
        if (!btn || !menu || !SMC.classlists || !SMC.classlists.listSections) return;
        function esc(s) { return (ui && ui.esc) ? ui.esc(s) : String(s == null ? '' : s); }
        var built = false;
        function build() {
            if (built) return; built = true;
            var byLvl = {}; var order = [];
            SMC.classlists.listSections().forEach(function (s) { if (!byLvl[s.level]) { byLvl[s.level] = []; order.push(s.level); } byLvl[s.level].push(s); });
            menu.innerHTML = order.map(function (lvl) {
                return '<div class="dcm-grp">' + esc(lvl) + '</div>' + byLvl[lvl].map(function (s) {
                    return '<button type="button" class="dcm-item" data-key="' + esc(s.key) + '"><span class="dcm-sec">' + esc(s.section) + '</span><span class="dcm-mt">' + esc((s.adviser || '\u2014') + ' \u00b7 ' + s.count) + '</span></button>';
                }).join('');
            }).join('');
        }
        function openM() { build(); menu.classList.add('on'); btn.setAttribute('aria-expanded', 'true'); }
        function closeM() { menu.classList.remove('on'); btn.setAttribute('aria-expanded', 'false'); }
        btn.addEventListener('click', function (e) { e.stopPropagation(); if (menu.classList.contains('on')) closeM(); else openM(); });
        menu.addEventListener('click', function (e) {
            var b = e.target.closest('[data-key]'); if (!b) return;
            closeM(); showView('classlists');
            if (SMC.classlists.openSection) SMC.classlists.openSection(b.getAttribute('data-key'));
        });
        document.addEventListener('click', function (e) { if (!menu.contains(e.target) && !btn.contains(e.target)) closeM(); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeM(); });
    }
    function setupDashStudentSearch() {
        var inp = document.getElementById('dashClStudent');
        var box = document.getElementById('dashClResults');
        if (!inp || !box || !SMC.classlists || !SMC.classlists.searchStudents) return;
        function esc(s) { return (ui && ui.esc) ? ui.esc(s) : String(s == null ? '' : s); }
        function close() { box.classList.remove('on'); box.innerHTML = ''; }
        inp.addEventListener('input', function () {
            var q = this.value.trim();
            if (q.length < 2) { close(); return; }
            var list = SMC.classlists.searchStudents(q).slice(0, 8);
            if (!list.length) { box.innerHTML = '<div class="dcr-empty">No student found</div>'; box.classList.add('on'); return; }
            box.innerHTML = list.map(function (s) {
                return '<button type="button" class="dcr-item" data-lrn="' + esc(s.lrn) + '"><span class="dcr-nm">' + esc(s.name) + '</span><span class="dcr-mt">' + esc(s.level + ' \u00b7 ' + s.section + ' \u00b7 ' + s.lrn) + '</span></button>';
            }).join('');
            box.classList.add('on');
        });
        box.addEventListener('click', function (e) {
            var b = e.target.closest('[data-lrn]');
            if (!b) return;
            showView('classlists');
            if (SMC.classlists.openStudent) SMC.classlists.openStudent(b.getAttribute('data-lrn'));
            inp.value = ''; close();
        });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
        document.addEventListener('click', function (e) { if (e.target !== inp && !box.contains(e.target)) close(); });
    }
    var wnOpen = null, wnIntroOpen = null, tourSeenKey = 'smc-design-tour-required-2026-09-r3-evaluations', tourRequired = false;
    function setupWhatsNew() {
        var ov = document.getElementById('tour');
        var intro = document.getElementById('wnIntro');
        if (!ov || !intro) return;
        var hole = document.getElementById('tourHole');
        var pop = document.getElementById('tourPop');
        var icE = document.getElementById('tourIc');
        var tE = document.getElementById('tourT');
        var dE = document.getElementById('tourD');
        var dots = document.getElementById('tourDots');
        var back = document.getElementById('tourBack');
        var next = document.getElementById('tourNext');
        var xB = document.getElementById('tourX');
        if (!hole || !pop || !back || !next) return;
        var steps = [
            { sel: '#navEval', ic: '1', t: 'Teachers Evaluation tab', d: 'Open Teachers Evaluation from the main taskbar. This workspace contains both online and paper-based evaluation tools.', nav: true },
            { sel: '#evalHub', ic: '2', t: 'Evaluation tool hub', d: 'The landing page separates each workflow so you can focus on one task at a time.', view: 'evaluations', evalHome: true },
            { sel: '[data-eval-open="workbooks"]', ic: '3', t: 'Online evaluation workbooks', d: 'Use this tool for Google Forms and Drive folders. Preview sources, build grade-level workbooks, and reopen completed files.', view: 'evaluations', evalHome: true },
            { sel: '[data-eval-open="k2"]', ic: '4', t: 'Kinder–Grade 2 paper encoder', d: 'Use this tool to encode paper responses in one batch, then create the compiled PDF and result workbook.', view: 'evaluations', evalHome: true },
            { sel: '.eval-hub-steps', ic: '5', t: 'Follow the evaluation workflow', d: 'Choose the correct tool, review every entry, then open the completed files from Google Drive.', view: 'evaluations', evalHome: true },
            { sel: '#exCard', ic: '6', t: 'Workbooks workspace', d: 'Select a teacher folder, preview the detected forms, diagnose missing sources, and build the evaluation workbooks.', view: 'evaluations', evalTool: 'workbooks' },
            { sel: '#exBatch', ic: '7', t: 'Choose a teacher folder', d: 'Pick one teacher at a time for large folders. This keeps each build focused and easier to verify.', view: 'evaluations', evalTool: 'workbooks' },
            { sel: '#exSaved', ic: '8', t: 'Generated Evaluations', d: 'Completed workbooks appear here as dropdowns grouped by teacher. Expand a teacher to preview, download, or open the Drive folder.', view: 'evaluations', evalTool: 'workbooks' },
            { sel: '#k2Card', ic: '9', t: 'K2 Paper Evaluation workspace', d: 'The paper encoder keeps one teacher, subject, and school year together as a single batch.', view: 'evaluations', evalTool: 'k2' },
            { sel: '.k2-common', ic: '10', t: 'Enter the shared batch details', d: 'Type the teacher as SURNAME, FIRST NAME, then enter the subject and numeric school year. These details apply to every staged paper.', view: 'evaluations', evalTool: 'k2' },
            { sel: '.k2-paper', ic: '11', t: 'Encode each answered paper', d: 'Enter the optional class number, student name, grade level, ratings, and comment exactly as written on the paper form.', view: 'evaluations', evalTool: 'k2' },
            { sel: '#k2Batch', ic: '12', t: 'Save and create the outputs', d: 'Add papers to the batch, save the complete batch, preview the compiled PDF, and build the result template.', view: 'evaluations', evalTool: 'k2' },
            { sel: '#profileBtn', ic: '13', t: 'Personalise the website', d: 'Open your profile menu to reach Settings and the appearance controls.', nav: true },
            { sel: '#pmSettings', ic: '14', t: 'Open Settings', d: 'Choose Settings from the profile menu whenever you want to change the website theme.', profile: true, nav: true },
            { sel: '#themeWood', ic: '15', t: 'Choose a theme', d: 'Select Wood & Navy, Classic Light, Midnight Navy, Calm Sage, or Sakura. Your choice is saved on this device.', settings: true },
            { sel: null, ic: '16', t: 'Tour complete', d: 'You have now seen every Teachers Evaluation tool and the theme controls. You can replay this tour from Settings.' }
        ];
        var i = 0;
        function markSeen() { try { localStorage.setItem(tourSeenKey, '1'); } catch (e) {} }
        function closeProfile() { var pm = document.getElementById('profileMenu'); if (pm) pm.classList.remove('open'); var pb = document.getElementById('profileBtn'); if (pb) pb.setAttribute('aria-expanded', 'false'); }
        function prepare(s) {
            if (window.innerWidth <= 768) {
                if (s.nav) openSidebar(); else closeSidebar();
            }
            if (s.settings) {
                closeProfile();
                if (SMC.settings && SMC.settings.open) SMC.settings.open(user);
            } else {
                var sm = document.getElementById('settingsModal');
                if (sm && sm.classList.contains('on') && SMC.settings && SMC.settings.close) SMC.settings.close();
                if (s.profile) {
                    var pm = document.getElementById('profileMenu');
                    var pb = document.getElementById('profileBtn');
                    if (pm) pm.classList.add('open');
                    if (pb) pb.setAttribute('aria-expanded', 'true');
                } else closeProfile();
            }
            if (s.view) showView(s.view);
            if (s.evalHome && SMC.evalhub && SMC.evalhub.home) SMC.evalhub.home();
            if (s.evalTool && SMC.evalhub && SMC.evalhub.activate) SMC.evalhub.activate(s.evalTool);
        }
        function place() {
            var step = steps[i];
            icE.textContent = step.ic; tE.textContent = step.t; dE.textContent = step.d;
            dots.innerHTML = steps.map(function (_, k) { return '<span class="wn-dot' + (k === i ? ' on' : '') + '"></span>'; }).join('');
            back.style.visibility = i === 0 ? 'hidden' : 'visible';
            next.textContent = i === steps.length - 1 ? 'Done' : 'Next';
            var el = step.sel ? document.querySelector(step.sel) : null;
            var rect = el ? el.getBoundingClientRect() : null;
            if (el && rect && rect.width > 0 && rect.height > 0 && (rect.top < 76 || rect.bottom > window.innerHeight - 18)) {
                try { el.scrollIntoView({ block: rect.height > window.innerHeight * 0.72 ? 'start' : 'center', inline: 'nearest' }); } catch (e) {}
                rect = el.getBoundingClientRect();
            }
            var pw = Math.min(300, window.innerWidth - 24);
            if (rect && rect.width > 0 && rect.height > 0) {
                var pad = 8;
                hole.style.display = 'block';
                hole.style.top = (rect.top - pad) + 'px'; hole.style.left = (rect.left - pad) + 'px';
                hole.style.width = (rect.width + pad * 2) + 'px'; hole.style.height = (rect.height + pad * 2) + 'px';
                var ph = pop.offsetHeight || 190;
                var top = rect.bottom + 14, left = rect.left;
                if (top + ph > window.innerHeight - 10) top = rect.top - ph - 14;
                if (top < 10) top = 10;
                left = Math.max(12, Math.min(left, window.innerWidth - pw - 12));
                pop.style.top = top + 'px'; pop.style.left = left + 'px';
            } else {
                hole.style.display = 'none';
                pop.style.top = Math.max(10, (window.innerHeight - (pop.offsetHeight || 200)) / 2) + 'px';
                pop.style.left = Math.max(12, (window.innerWidth - pw) / 2) + 'px';
            }
        }
        function render() { prepare(steps[i]); setTimeout(place, steps[i].settings || steps[i].profile || steps[i].view || steps[i].evalTool ? 240 : 30); }
        function closeTour(completed) {
            if (tourRequired && !completed) return;
            ov.classList.remove('on'); ov.setAttribute('aria-hidden', 'true'); closeProfile();
            var sm = document.getElementById('settingsModal'); if (sm && sm.classList.contains('on') && SMC.settings && SMC.settings.close) SMC.settings.close();
            markSeen(); window.removeEventListener('resize', place);
        }
        back.addEventListener('click', function () { if (i > 0) { i--; render(); } });
        next.addEventListener('click', function () { if (i < steps.length - 1) { i++; render(); } else closeTour(true); });
        if (xB) xB.addEventListener('click', function () { closeTour(false); });
        wnOpen = function (required) { tourRequired = !!required; ov.classList.toggle('required', tourRequired); if (xB) xB.hidden = tourRequired; i = 0; ov.classList.add('on'); ov.setAttribute('aria-hidden', 'false'); render(); window.addEventListener('resize', place); };
        function closeIntro(seen) { if (tourRequired && seen) return; intro.classList.remove('on'); intro.setAttribute('aria-hidden', 'true'); if (seen) markSeen(); }
        wnIntroOpen = function (required) { tourRequired = !!required; intro.classList.toggle('required', tourRequired); if (introX) introX.hidden = tourRequired; if (introSkip) introSkip.hidden = tourRequired; if (introStart) introStart.textContent = tourRequired ? 'Continue to required tour' : 'Show me around'; intro.classList.add('on'); intro.setAttribute('aria-hidden', 'false'); };
        var introX = document.getElementById('wnIntroX');
        var introSkip = document.getElementById('wnIntroSkip');
        var introStart = document.getElementById('wnIntroStart');
        if (introX) introX.addEventListener('click', function () { closeIntro(true); });
        if (introSkip) introSkip.addEventListener('click', function () { closeIntro(true); });
        if (introStart) introStart.addEventListener('click', function () { closeIntro(false); wnOpen(tourRequired); });
        intro.addEventListener('click', function (e) { if (e.target === intro && !tourRequired) closeIntro(true); });
    }
    function maybeShowWhatsNew() {
        var key = 'smc-design-tour-required-2026-09-r3-evaluations';
        try { if (user && user.username) key += '-' + String(user.username).toLowerCase(); } catch (e) {}
        tourSeenKey = key;
        try { if (localStorage.getItem(key)) return; } catch (e) {}
        if (wnIntroOpen) setTimeout(function () { wnIntroOpen(true); }, 700);
    }
    return { init: init, boot: boot, reset: reset, showScreen: showScreen, refreshEvalStats: refreshEvalStats, showTutorial: showTutorial, showUpdateTour: function () { if (wnOpen) wnOpen(false); }, showWhatsNew: function () { if (wnIntroOpen) wnIntroOpen(false); }, go: function (v) { showView(v); }, showLock: showLock, hideLock: hideLock, checkLock: checkLock, showSiteMaint: showSiteMaint, hideSiteMaint: hideSiteMaint, checkSiteMaint: checkSiteMaint };
})();
window.addEventListener('DOMContentLoaded', SMC.app.init);
