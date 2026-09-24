"use strict";
window.SMC = window.SMC || {};
SMC.routine = (function () {
	var ui = SMC.ui;
	var user = null;
	var LS_KEY = "smc-routine-interviews";
	var STATUSES = ["Pending", "Scheduled", "Done"];
	var LEVEL_ORDER = ["Kinder", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6", "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12"];
	var DESIGNATES = [
		{ id: "mamaril", name: "Ms. Mamaril", levels: ["Grade 12", "Grade 7", "Grade 6"] },
		{ id: "quilatan", name: "Ms. Quilatan", levels: ["Grade 9", "Grade 8", "Kinder"] },
		{ id: "gundran", name: "Ms. Gundran", levels: ["Grade 11", "Grade 5", "Grade 2", "Grade 1"] },
		{ id: "reyes", name: "Mr. Reyes", levels: ["Grade 10", "Grade 4", "Grade 3"] }
	];
	var state = { desig: "all", section: "", status: "", q: "", showDropped: false, sexes: [], types: [], concerns: [], levels: [], dateFrom: "", dateTo: "" };
	var CONCERNS = ["Behavior", "Academic", "Close Monitoring"];
	var records = load();

	function esc(s) { return (ui && ui.esc) ? ui.esc(s) : String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
	function load() { return {}; }
	function save() { }
	function recOf(lrn) { var r = records[lrn] || {}; return { status: r.status || "Pending", date: r.date || "", notes: r.notes || "", dropout: r.dropout === true }; }
	function setRec(lrn, patch) { var r = recOf(lrn); if (patch.status != null) r.status = patch.status; if (patch.date != null) r.date = patch.date; if (patch.notes != null) r.notes = patch.notes; if (patch.dropout != null) r.dropout = !!patch.dropout; records[lrn] = r; save(); }
	function persist(lrn) {
		save();
		if (!(SMC.api && SMC.api.saveRoutine)) { if (ui && ui.toast) ui.toast("Online saving is unavailable.", "err"); return; }
		var r = recOf(lrn);
		SMC.api.saveRoutine({ lrn: lrn, status: r.status, date: r.date, notes: r.notes, dropout: r.dropout })
			.then(function () { if (ui && ui.toast) ui.toast("Saved online.", "ok"); })
			.catch(function () { if (ui && ui.toast) ui.toast("Could not save online. Your change was not persisted.", "err"); fetchRemote(); });
	}
	function fetchRemote() {
		if (!(SMC.api && SMC.api.listRoutine)) return;
		SMC.api.listRoutine().then(function (d) {
			if (d && d.records) { records = d.records; save(); refresh(); }
		}).catch(function () { });
	}
	function markDropout(lrn, drop) {
		var st = findStudent(lrn);
		if (drop && st && typeof window.confirm === "function" && !window.confirm(st.name + " will be marked as a dropout and excluded from the counts. You can restore them later. Continue?")) return;
		setRec(lrn, { dropout: !!drop });
		persist(lrn);
		refresh();
	}

	function setUser(u) { user = u; }
	function levelIdx(l) { var i = LEVEL_ORDER.indexOf(l); return i < 0 ? 999 : i; }
	function desigOf(id) { for (var i = 0; i < DESIGNATES.length; i++) if (DESIGNATES[i].id === id) return DESIGNATES[i]; return null; }
	function levelDesig(level) { for (var i = 0; i < DESIGNATES.length; i++) if (DESIGNATES[i].levels.indexOf(level) !== -1) return DESIGNATES[i]; return null; }
	function host() { return document.getElementById("routineView"); }

	function allStudents() {
		var data = SMC.classListData || [];
		var out = [];
		data.forEach(function (sec) {
			(sec.students || []).forEach(function (st) {
				out.push({ name: st.name, lrn: st.lrn, sex: st.sex, level: sec.level, section: sec.section });
			});
		});
		return out;
	}
	function scopeStudents() {
		var d = state.desig === "all" ? null : desigOf(state.desig);
		return allStudents().filter(function (s) { return d ? d.levels.indexOf(s.level) !== -1 : true; });
	}
	function activeIn(list) { return list.filter(function (s) { return !recOf(s.lrn).dropout; }); }
	function droppedIn(list) { return list.filter(function (s) { return recOf(s.lrn).dropout; }); }
	function flagStr(lrn) { return (SMC.classlists && SMC.classlists.flagOf) ? (SMC.classlists.flagOf(lrn) || "") : ""; }
	function concernPass(s) {
		if (!state.concerns.length) return true;
		var fl = flagStr(s.lrn);
		if (state.concerns.indexOf("__any__") !== -1 && fl) return true;
		if (fl && state.concerns.indexOf(fl) !== -1) return true;
		return false;
	}
	function sortStudents(list) {
		return list.slice().sort(function (a, b) {
			var d = levelIdx(a.level) - levelIdx(b.level);
			if (d !== 0) return d;
			if (a.section !== b.section) return a.section.localeCompare(b.section);
			return a.name.localeCompare(b.name);
		});
	}
	function statusCounts(list) {
		var c = { total: list.length, Done: 0, Scheduled: 0, Pending: 0 };
		list.forEach(function (s) { c[recOf(s.lrn).status]++; });
		return c;
	}
	function pct(c) { return c.total ? Math.round(c.Done / c.total * 100) : 0; }
	function stCls(s) { return s === "Done" ? "done" : s === "Scheduled" ? "sched" : "pending"; }
	function desigLevels() {
		if (state.desig === "all") return "";
		var d = desigOf(state.desig);
		if (!d) return "";
		return d.levels.slice().sort(function (a, b) { return levelIdx(a) - levelIdx(b); }).join(", ");
	}

	function render() {
		var el = host();
		if (!el) return;
		el.innerHTML =
			'<div class="ri-wrap">' +
			'<header class="ri-head">' +
			'<div class="ri-head-l">' +
			'<span class="ri-head-ic"><svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>' +
			'<div><h2 class="ri-head-t">Routine Interviews</h2><p class="ri-head-s">Track each student\'s routine interview \u2014 a one-on-one conversation about their life \u2014 organised by grade-level designate.</p></div>' +
			'</div>' +
			'<div class="ri-head-r"><button class="ri-btn primary" id="riPrint"><svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg> Print list</button></div>' +
			'</header>' +
			'<div class="ri-tabs" id="riTabs"></div>' +
			'<div class="ri-summary" id="riSummary"></div>' +
			'<div class="ri-tools">' +
			'<div class="ri-search-wrap"><svg class="ri-search-ic" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg><input type="text" id="riSearch" class="ri-search" placeholder="Search student name or Student Number"></div>' +
			'<div class="ri-filter-wrap">' +
			'<button type="button" class="ri-filter-btn" id="riFilterBtn"><svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg> Filters<span class="ri-filter-badge" id="riFilterBadge" hidden></span></button>' +
			'<div class="ri-filter-panel" id="riFilterPanel" hidden>' +
			'<div class="ri-fg"><div class="ri-fg-t">Sex</div><label class="ri-fck"><input type="checkbox" class="ri-fchk" data-g="sex" value="M"> Male</label><label class="ri-fck"><input type="checkbox" class="ri-fchk" data-g="sex" value="F"> Female</label></div>' +
			'<div class="ri-fg"><div class="ri-fg-t">Student type</div><label class="ri-fck"><input type="checkbox" class="ri-fchk" data-g="type" value="NEW"> New student</label><label class="ri-fck"><input type="checkbox" class="ri-fchk" data-g="type" value="OLD"> Old student</label></div>' +
			'<div class="ri-fg"><div class="ri-fg-t">Concern</div><label class="ri-fck"><input type="checkbox" class="ri-fchk" data-g="concern" value="__any__"> With any concern</label>' + CONCERNS.map(function (f) { return '<label class="ri-fck"><input type="checkbox" class="ri-fchk" data-g="concern" value="' + esc(f) + '"> ' + esc(f) + '</label>'; }).join('') + '</div>' +
			'<div class="ri-fg"><div class="ri-fg-t">Grade level</div><div class="ri-lvl-checks" id="riLvlChecks"></div></div>' +
			'<div class="ri-fg-foot"><button type="button" class="ri-fclear" id="riFilterClear">Clear all</button></div>' +
			'</div>' +
			'</div>' +
			'<select id="riSection" class="ri-filter"></select>' +
			'<select id="riStatusF" class="ri-filter"><option value="">All statuses</option>' + STATUSES.map(function (s) { return '<option value="' + s + '">' + s + '</option>'; }).join('') + '</select>' +
			'<span class="ri-date-range"><span class="ri-date-lb">Interview</span><input type="date" id="riFrom" class="ri-filter ri-date-in" title="Interview date from"><span class="ri-date-sep">\u2013</span><input type="date" id="riTo" class="ri-filter ri-date-in" title="Interview date to"></span>' +
			'<label class="ri-drop-toggle"><input type="checkbox" id="riShowDropped"> Show dropouts</label>' +
			'</div>' +
			'<div class="ri-tbl-wrap"><table class="ri-tbl"><thead id="riHead"></thead><tbody id="riTbody"></tbody></table></div>' +
			'</div>';
		buildFilters();
		bind();
		refresh();
		fetchRemote();
	}

	function buildTabs() {
		var tabs = document.getElementById("riTabs");
		if (!tabs) return;
		function chip(id, name, list) {
			var c = statusCounts(activeIn(list));
			return '<button type="button" class="ri-tab' + (state.desig === id ? ' on' : '') + '" data-d="' + id + '">' +
				'<span class="ri-tab-nm">' + esc(name) + '</span>' +
				'<span class="ri-tab-mt">' + c.Done + '/' + c.total + ' done</span>' +
				'</button>';
		}
		var html = chip("all", "All designates", allStudents());
		DESIGNATES.forEach(function (d) {
			var list = allStudents().filter(function (s) { return d.levels.indexOf(s.level) !== -1; });
			html += chip(d.id, d.name, list);
		});
		tabs.innerHTML = html;
	}

	function buildFilters() {
		var scope = scopeStudents();
		var levels = [];
		scope.forEach(function (s) { if (levels.indexOf(s.level) === -1) levels.push(s.level); });
		levels.sort(function (a, b) { return levelIdx(a) - levelIdx(b); });
		state.levels = state.levels.filter(function (l) { return levels.indexOf(l) !== -1; });
		var lc = document.getElementById("riLvlChecks");
		if (lc) lc.innerHTML = levels.map(function (l) { return '<label class="ri-fck"><input type="checkbox" class="ri-fchk" data-g="level" value="' + esc(l) + '"' + (state.levels.indexOf(l) !== -1 ? ' checked' : '') + '> ' + esc(l) + '</label>'; }).join('');
		var secs = [];
		scope.forEach(function (s) { if ((!state.levels.length || state.levels.indexOf(s.level) !== -1) && secs.indexOf(s.section) === -1) secs.push(s.section); });
		secs.sort(function (a, b) { return a.localeCompare(b); });
		var secSel = document.getElementById("riSection");
		if (secSel) {
			if (secs.indexOf(state.section) === -1) state.section = "";
			secSel.innerHTML = '<option value="">All sections</option>' + secs.map(function (s) { return '<option value="' + esc(s) + '"' + (state.section === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('');
		}
		updateFilterBadge();
	}
	function updateFilterBadge() {
		var n = state.sexes.length + state.types.length + state.concerns.length + state.levels.length + (state.dateFrom ? 1 : 0) + (state.dateTo ? 1 : 0);
		var b = document.getElementById("riFilterBadge");
		if (b) { if (n) { b.textContent = n; b.hidden = false; b.style.display = ""; } else { b.textContent = ""; b.hidden = true; b.style.display = "none"; } }
	}

	function updateSummary() {
		var box = document.getElementById("riSummary");
		if (!box) return;
		var scope = scopeStudents();
		var c = statusCounts(activeIn(scope));
		var dropped = droppedIn(scope).length;
		var p = pct(c);
		var label = state.desig === "all" ? "All designates" : (desigOf(state.desig) ? desigOf(state.desig).name : "");
		box.innerHTML =
			'<div class="ri-sum-top"><div class="ri-sum-title">' + esc(label) + '<span class="ri-sum-lv">' + esc(desigLevels()) + '</span></div>' +
			'<div class="ri-sum-pct">' + p + '% interviewed</div></div>' +
			'<div class="ri-bar"><span style="width:' + p + '%"></span></div>' +
			'<div class="ri-sum-stats">' +
			'<span class="ri-stat"><strong>' + c.total + '</strong> students</span>' +
			'<span class="ri-stat done"><strong>' + c.Done + '</strong> done</span>' +
			'<span class="ri-stat sched"><strong>' + c.Scheduled + '</strong> scheduled</span>' +
			'<span class="ri-stat pending"><strong>' + c.Pending + '</strong> pending</span>' +
			(dropped ? '<span class="ri-stat dropped"><strong>' + dropped + '</strong> dropped (not counted)</span>' : '') +
			'</div>';
	}

	function buildHead() {
		var head = document.getElementById("riHead");
		if (!head) return;
		var showD = state.desig === "all";
		if (state.showDropped) {
			head.innerHTML = '<tr><th>#</th><th>Student</th>' + (showD ? '<th>Designate</th>' : '') + '<th>Grade &amp; Section</th><th>Sex</th><th>Status</th><th></th></tr>';
			return;
		}
		head.innerHTML = '<tr><th>#</th><th>Student</th>' + (showD ? '<th>Designate</th>' : '') + '<th>Grade &amp; Section</th><th>Sex</th><th>Status</th><th>Interview date</th><th>Notes</th><th></th></tr>';
	}

	function drawRows() {
		var tb = document.getElementById("riTbody");
		if (!tb) return;
		var showD = state.desig === "all";
		var q = (state.q || "").toLowerCase().trim();
		var base = scopeStudents().filter(function (s) {
			if (state.levels.length && state.levels.indexOf(s.level) === -1) return false;
			if (state.section && s.section !== state.section) return false;
			if (state.sexes.length && state.sexes.indexOf(s.sex) === -1) return false;
			if (state.types.length && state.types.indexOf(s.status) === -1) return false;
			if (!concernPass(s)) return false;
			var rdt = recOf(s.lrn).date;
			if (state.dateFrom && (!rdt || rdt < state.dateFrom)) return false;
			if (state.dateTo && (!rdt || rdt > state.dateTo)) return false;
			if (q && (s.name + " " + s.lrn).toLowerCase().indexOf(q) === -1) return false;
			return true;
		});
		if (state.showDropped) {
			var dl = sortStudents(droppedIn(base));
			var dcol = showD ? 7 : 6;
			if (!dl.length) { tb.innerHTML = '<tr><td colspan="' + dcol + '" class="ri-empty">No dropped students.</td></tr>'; return; }
			tb.innerHTML = dl.map(function (s, idx) {
				var d = levelDesig(s.level);
				return '<tr class="ri-dropped" data-lrn="' + esc(s.lrn) + '">' +
					'<td class="ri-num">' + (idx + 1) + '</td>' +
					'<td class="ri-nm">' + esc(s.name) + '<span class="ri-lrn">' + esc(s.lrn) + '</span></td>' +
					(showD ? '<td class="ri-desig">' + esc(d ? d.name : "\u2014") + '</td>' : '') +
					'<td>' + esc(s.level) + ' \u00b7 ' + esc(s.section) + '</td>' +
					'<td>' + esc(s.sex) + '</td>' +
					'<td><span class="ri-drop-tag">Dropped</span></td>' +
					'<td><button type="button" class="ri-restore" data-lrn="' + esc(s.lrn) + '">Restore</button></td>' +
					'</tr>';
			}).join('');
			return;
		}
		var list = sortStudents(activeIn(base).filter(function (s) {
			if (state.status && recOf(s.lrn).status !== state.status) return false;
			return true;
		}));
		var colspan = showD ? 9 : 8;
		if (!list.length) { tb.innerHTML = '<tr><td colspan="' + colspan + '" class="ri-empty">No students match your filters.</td></tr>'; return; }
		tb.innerHTML = list.map(function (s, idx) {
			var r = recOf(s.lrn);
			var d = levelDesig(s.level);
			var opts = STATUSES.map(function (st) { return '<option value="' + st + '"' + (r.status === st ? ' selected' : '') + '>' + st + '</option>'; }).join('');
			var note = r.notes ? '<span class="ri-note-has">' + esc(r.notes.length > 40 ? r.notes.slice(0, 40) + "\u2026" : r.notes) + '</span>' : '<span class="ri-note-add">+ Add note</span>';
			return '<tr data-lrn="' + esc(s.lrn) + '">' +
				'<td class="ri-num">' + (idx + 1) + '</td>' +
				'<td class="ri-nm">' + esc(s.name) + '<span class="ri-lrn">' + esc(s.lrn) + '</span></td>' +
				(showD ? '<td class="ri-desig">' + esc(d ? d.name : "\u2014") + '</td>' : '') +
				'<td>' + esc(s.level) + ' \u00b7 ' + esc(s.section) + '</td>' +
				'<td>' + esc(s.sex) + '</td>' +
				'<td><select class="ri-status ri-st-' + stCls(r.status) + '" data-lrn="' + esc(s.lrn) + '">' + opts + '</select></td>' +
				'<td><input type="date" class="ri-date" data-lrn="' + esc(s.lrn) + '" value="' + esc(r.date) + '"></td>' +
				'<td><button type="button" class="ri-note-btn" data-lrn="' + esc(s.lrn) + '">' + note + '</button></td>' +
				'<td><button type="button" class="ri-drop-btn" data-lrn="' + esc(s.lrn) + '" title="Mark as dropout (excluded from counts)">Dropout</button></td>' +
				'</tr>';
		}).join('');
	}

	function refresh() { buildTabs(); updateSummary(); buildHead(); drawRows(); }

	function bind() {
		var tabs = document.getElementById("riTabs");
		if (tabs) tabs.addEventListener("click", function (e) {
			var b = e.target.closest(".ri-tab"); if (!b) return;
			state.desig = b.getAttribute("data-d"); state.levels = []; state.section = "";
			buildFilters(); refresh();
		});
		var s = document.getElementById("riSearch"); if (s) s.addEventListener("input", function () { state.q = this.value; drawRows(); });
		var sec = document.getElementById("riSection"); if (sec) sec.addEventListener("change", function () { state.section = this.value; drawRows(); });
		var stf = document.getElementById("riStatusF"); if (stf) stf.addEventListener("change", function () { state.status = this.value; drawRows(); });
		var sd = document.getElementById("riShowDropped"); if (sd) sd.addEventListener("change", function () { state.showDropped = this.checked; buildHead(); drawRows(); });
		var fr = document.getElementById("riFrom"); if (fr) fr.addEventListener("change", function () { state.dateFrom = this.value; updateFilterBadge(); drawRows(); });
		var to = document.getElementById("riTo"); if (to) to.addEventListener("change", function () { state.dateTo = this.value; updateFilterBadge(); drawRows(); });
		var fb = document.getElementById("riFilterBtn"); if (fb) fb.addEventListener("click", function (e) { e.stopPropagation(); var p = document.getElementById("riFilterPanel"); if (p) p.hidden = !p.hidden; });
		var fp = document.getElementById("riFilterPanel");
		if (fp) {
			fp.addEventListener("click", function (e) { e.stopPropagation(); });
			fp.addEventListener("change", function (e) {
				var c = e.target.closest("input.ri-fchk"); if (!c) return;
				var g = c.getAttribute("data-g"); var v = c.value;
				var arr = g === "sex" ? state.sexes : g === "type" ? state.types : g === "concern" ? state.concerns : state.levels;
				var i = arr.indexOf(v);
				if (c.checked) { if (i === -1) arr.push(v); } else if (i !== -1) { arr.splice(i, 1); }
				if (g === "level") buildFilters();
				updateFilterBadge(); drawRows();
			});
		}
		var fcl = document.getElementById("riFilterClear");
		if (fcl) fcl.addEventListener("click", function (e) {
			e.stopPropagation();
			state.sexes = []; state.types = []; state.concerns = []; state.levels = [];
			var box = document.getElementById("riFilterPanel"); if (box) { var cks = box.querySelectorAll("input.ri-fchk"); for (var k = 0; k < cks.length; k++) cks[k].checked = false; }
			buildFilters(); drawRows();
		});
		if (!window.__riDocClose) { window.__riDocClose = true; document.addEventListener("click", function () { var p = document.getElementById("riFilterPanel"); if (p && !p.hidden) p.hidden = true; }); }
		var tb = document.getElementById("riTbody");
		if (tb) {
			tb.addEventListener("change", function (e) {
				var sel = e.target.closest("select.ri-status");
				if (sel) { var slrn = sel.getAttribute("data-lrn"); setRec(slrn, { status: sel.value }); persist(slrn); sel.className = "ri-status ri-st-" + stCls(sel.value); updateSummary(); buildTabs(); if (state.status) drawRows(); return; }
				var dt = e.target.closest("input.ri-date");
				if (dt) { var dlrn = dt.getAttribute("data-lrn"); setRec(dlrn, { date: dt.value }); persist(dlrn); return; }
			});
			tb.addEventListener("click", function (e) {
				var nb = e.target.closest(".ri-note-btn");
				if (nb) { openNote(nb.getAttribute("data-lrn")); return; }
				var db = e.target.closest(".ri-drop-btn");
				if (db) { markDropout(db.getAttribute("data-lrn"), true); return; }
				var rb = e.target.closest(".ri-restore");
				if (rb) { markDropout(rb.getAttribute("data-lrn"), false); return; }
			});
		}
		var pr = document.getElementById("riPrint"); if (pr) pr.addEventListener("click", printList);
	}

	function noteModal() {
		var m = document.getElementById("riNoteModal");
		if (m) return m;
		m = document.createElement("div");
		m.id = "riNoteModal"; m.className = "ri-modal";
		m.innerHTML = '<div class="ri-modal-card">' +
			'<div class="ri-modal-h"><span id="riNoteName"></span><button class="ri-modal-x" id="riNoteX">&times;</button></div>' +
			'<label class="ri-modal-lb">Interview notes</label>' +
			'<textarea id="riNoteText" class="ri-modal-in" rows="5" placeholder="What did you talk about? Concerns, follow-ups, observations\u2026"></textarea>' +
			'<div class="ri-modal-ft"><button class="ri-btn ghost" id="riNoteCancel">Cancel</button><button class="ri-btn primary" id="riNoteSave">Save notes</button></div>' +
			'</div>';
		document.body.appendChild(m);
		m.addEventListener("click", function (e) { if (e.target === m) m.classList.remove("on"); });
		document.getElementById("riNoteX").addEventListener("click", function () { m.classList.remove("on"); });
		document.getElementById("riNoteCancel").addEventListener("click", function () { m.classList.remove("on"); });
		return m;
	}
	function findStudent(lrn) { var all = allStudents(); for (var i = 0; i < all.length; i++) if (all[i].lrn === lrn) return all[i]; return null; }
	function openNote(lrn) {
		var st = findStudent(lrn); if (!st) return;
		var m = noteModal();
		var r = recOf(lrn);
		document.getElementById("riNoteName").textContent = st.name + " \u00b7 " + st.level + " " + st.section;
		var ta = document.getElementById("riNoteText"); ta.value = r.notes || "";
		document.getElementById("riNoteSave").onclick = function () {
			setRec(lrn, { notes: ta.value });
			persist(lrn);
			m.classList.remove("on");
			drawRows();
		};
		m.classList.add("on");
		setTimeout(function () { ta.focus(); }, 40);
	}

	function printList() {
		var area = document.getElementById("clPrintArea");
		if (!area) { area = document.createElement("div"); area.id = "clPrintArea"; document.body.appendChild(area); }
		var scope = sortStudents(activeIn(scopeStudents()));
		var label = state.desig === "all" ? "All Designates" : (desigOf(state.desig) ? desigOf(state.desig).name : "");
		var c = statusCounts(scope);
		var byLvl = {}, order = [];
		scope.forEach(function (s) { if (!byLvl[s.level]) { byLvl[s.level] = []; order.push(s.level); } byLvl[s.level].push(s); });
		var blocks = order.map(function (lvl) {
			var n = 0;
			var rows = byLvl[lvl].map(function (s) {
				n++; var r = recOf(s.lrn);
				return "<tr><td class=\"cpn\">" + n + "</td><td>" + esc(s.name) + "</td><td>" + esc(s.section) + "</td><td>" + esc(r.status) + "</td><td>" + esc(r.date || "") + "</td><td>" + esc(r.notes || "") + "</td></tr>";
			}).join("");
			return '<div class="cpr-grp">' + esc(lvl) + '</div><table class="cpr-tbl"><thead><tr><th>#</th><th>Name</th><th>Section</th><th>Status</th><th>Interview Date</th><th>Notes</th></tr></thead><tbody>' + rows + "</tbody></table>";
		}).join("");
		area.innerHTML = '<div class="cpr">' +
			'<div class="cpr-head"><div class="cpr-ht">STELLA MARIS COLLEGE</div><div class="cpr-hs">Cubao, Quezon City</div><div class="cpr-doc">ROUTINE INTERVIEW TRACKER</div><div class="cpr-hs">School Year 2026-2027</div></div>' +
			'<div class="cpr-meta"><div><span class="cpr-k">Guidance Designate:</span> ' + esc(label) + '</div><div><span class="cpr-k">Levels:</span> ' + esc(desigLevels() || "All") + '</div>' +
			'<div><span class="cpr-k">Interviewed:</span> ' + c.Done + " / " + c.total + " (" + pct(c) + '%)</div><div><span class="cpr-k">Pending:</span> ' + c.Pending + '</div></div>' +
			blocks +
			'<div class="cpr-foot">Generated by SMC Guidance Center &middot; Routine interview = a one-on-one conversation with each student about their life.</div>' +
			'</div>';
		document.body.classList.add("printing-cl");
		var cleanup = function () { document.body.classList.remove("printing-cl"); window.removeEventListener("afterprint", cleanup); };
		window.addEventListener("afterprint", cleanup);
		setTimeout(function () { window.print(); }, 60);
	}

	return { render: render, setUser: setUser, load: render, isDropout: function (lrn) { return recOf(lrn).dropout; } };
})();
