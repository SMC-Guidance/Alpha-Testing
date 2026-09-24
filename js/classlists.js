"use strict";
window.SMC = window.SMC || {};
SMC.classlists = (function () {
	var ui = SMC.ui, api = SMC.api;
	var user = null;
	var state = { view: "grid", key: null };
	var FLAGS = ["Behavior", "Academic", "Close Monitoring"];
	var LEVEL_ORDER = ["Kinder", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6", "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12"];
	var localFlags = {};
	var rosterLoaded = false, rosterLoading = null, rosterError = "";
	var PALETTE = ["#002B6B", "#2F6DB5", "#2A9D8F", "#3E8E5A", "#BFA050", "#D98324", "#C94040", "#C65A93", "#7A5AA8", "#5B6B85"];
	var colors = loadColors();
	function loadColors() { try { return JSON.parse(localStorage.getItem("smc-classcolors") || "{}") || {}; } catch (e) { return {}; } }
	function saveColors() { try { localStorage.setItem("smc-classcolors", JSON.stringify(colors)); } catch (e) { } }
	function pushColor(key, color) { if (api && api.setClassColor) { try { api.setClassColor({ key: key, color: color || "" }).catch(function () { }); } catch (e) { } } }
	function syncColors() { if (!(api && api.getClassColors)) return; try { api.getClassColors().then(function (d) { if (d && d.colors && typeof d.colors === "object") { Object.keys(d.colors).forEach(function (key) { colors[key] = d.colors[key]; }); saveColors(); var h = document.getElementById("classListsView"); if (h && h.querySelector(".cl-wrap")) render(); } }).catch(function () { }); } catch (e) { } }
	function gradeColor(level) { return colors["lvl::" + level] || PALETTE[levelIdx(level) % PALETTE.length]; }
	function sectionColor(s) { return colors["sec::" + keyOf(s)] || gradeColor(s.level); }
	function closeColorPicker() { var p = document.getElementById("clPalette"); if (p && p.parentNode) p.parentNode.removeChild(p); document.removeEventListener("click", outsidePalette); }
	function outsidePalette(e) { var p = document.getElementById("clPalette"); if (p && !p.contains(e.target)) closeColorPicker(); }
	function openColorPicker(anchor, scope, ckey) {
		closeColorPicker();
		var k = (scope === "lvl" ? "lvl::" : "sec::") + ckey;
		var cur = (colors[k] || "").toLowerCase();
		var pop = document.createElement("div");
		pop.className = "cl-palette"; pop.id = "clPalette";
		var cv = colors[k] || "";
		function hslHex(h, s, l) { s /= 100; l /= 100; var a = (1 - Math.abs(2 * l - 1)) * s, x = a * (1 - Math.abs((h / 60) % 2 - 1)), m = l - a / 2, r = 0, g = 0, b = 0; if (h < 60) { r = a; g = x; } else if (h < 120) { r = x; g = a; } else if (h < 180) { g = a; b = x; } else if (h < 240) { g = x; b = a; } else if (h < 300) { r = x; b = a; } else { r = a; b = x; } var to = function (v) { return ("0" + Math.round((v + m) * 255).toString(16)).slice(-2); }; return "#" + to(r) + to(g) + to(b); }
		var BASE = ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff", "#c0c0c0", "#808080", "#800000", "#808000", "#008000", "#800080", "#008080", "#000080"];
		var HUES = [0, 20, 40, 60, 90, 120, 150, 180, 200, 220, 250, 270, 290, 320, 340];
		var LS = [85, 75, 65, 55, 50, 42, 34, 25, 15];
		var GRAYS = [96, 85, 72, 60, 48, 38, 28, 18, 6];
		var mk = function (c) { return '<button type="button" class="cl-cell" data-c="' + c + '" style="background:' + c + '"' + (cur === c.toLowerCase() ? ' data-on="1"' : "") + '></button>'; };
		var mat = "";
		for (var ri = 0; ri < LS.length; ri++) { for (var ci = 0; ci < HUES.length; ci++) { mat += mk(hslHex(HUES[ci], 100, LS[ri])); } mat += mk(hslHex(0, 0, GRAYS[ri])); }
		pop.innerHTML = '<div class="cl-pal-circles">' + BASE.map(function (c) { return '<button type="button" class="cl-circ" data-c="' + c + '" style="background:' + c + '"' + (cur === c.toLowerCase() ? ' data-on="1"' : "") + '></button>'; }).join("") + '</div>' + '<div class="cl-pal-matrix">' + mat + '</div>' + '<div class="cl-pal-custom"><input type="text" id="clPalHex" class="cl-pal-hex" placeholder="#RRGGBB" value="' + esc(cv) + '" maxlength="7"><button type="button" class="cl-pal-apply" id="clPalApply">Apply</button><button type="button" class="cl-pal cl-pal-clear" data-c="" title="Reset to default">\u2715</button></div>';
		document.body.appendChild(pop);
		var r = anchor.getBoundingClientRect();
		pop.style.top = (r.bottom + 6 + window.scrollY) + "px";
		pop.style.left = Math.max(8, Math.min(r.left + window.scrollX, window.innerWidth - pop.offsetWidth - 8)) + "px";
		pop.addEventListener("click", function (e) {
			var b = e.target.closest("[data-c]"); if (!b) return;
			var c = b.getAttribute("data-c");
			if (c) colors[k] = c; else delete colors[k];
			saveColors(); pushColor(k, c); closeColorPicker(); drawCards();
		});
		var setColor = function (val) { if (val) colors[k] = val; else delete colors[k]; saveColors(); pushColor(k, val); closeColorPicker(); drawCards(); };
		var normHex = function (v) { v = (v || "").trim(); if (v.charAt(0) !== "#") v = "#" + v; if (/^#[0-9a-fA-F]{3}$/.test(v)) v = "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]; return /^#[0-9a-fA-F]{6}$/.test(v) ? v : null; };
		var nat = pop.querySelector("#clPalNative"), sw = pop.querySelector("#clPalSw"), hex = pop.querySelector("#clPalHex");
		if (nat) { nat.addEventListener("input", function () { if (sw) sw.style.background = nat.value; if (hex) hex.value = nat.value; }); nat.addEventListener("change", function () { setColor(nat.value); }); }
		var applyHex = function () { var h = normHex(hex && hex.value); if (h) setColor(h); else if (hex) hex.style.borderColor = "#C94040"; };
		var applyBtn = pop.querySelector("#clPalApply"); if (applyBtn) applyBtn.addEventListener("click", applyHex);
		if (hex) hex.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); applyHex(); } });
		setTimeout(function () { document.addEventListener("click", outsidePalette); }, 0);
	}

	function loadRoster() {
		if (!user || !(api && api.listClassLists)) return Promise.resolve([]);
		if (rosterLoading) return rosterLoading;
		rosterError = "";
		rosterLoading = api.listClassLists().then(function (d) {
			SMC.classListData = (d && d.sections) || [];
			rosterLoaded = true; rosterLoading = null;
			var h = host(); if (h && h.querySelector(".cl-loading")) render();
			return SMC.classListData;
		}).catch(function (e) {
			rosterLoading = null; rosterError = (e && e.message) || "Could not load class lists.";
			var h = host(); if (h) h.innerHTML = '<div class="cl-empty">' + esc(rosterError) + '</div>';
			throw e;
		});
		return rosterLoading;
	}
	function setUser(u) { user = u; SMC.classListData = []; rosterLoaded = false; rosterLoading = null; if (u) loadRoster().catch(function(){}); syncColors(); }
	function isStaff() { return !!(user && (user.role === "admin" || user.role === "co-admin")); }
	function esc(s) {
		if (ui && ui.esc) return ui.esc(s);
		return String(s == null ? "" : s).replace(/[&<>\"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; });
	}
	function data() { return SMC.classListData || []; }
	function keyOf(s) { return s.level + "||" + s.section; }
	function levelIdx(l) { var i = LEVEL_ORDER.indexOf(l); return i < 0 ? 999 : i; }
	function sorted() {
		return data().slice().sort(function (a, b) {
			var d = levelIdx(a.level) - levelIdx(b.level);
			return d !== 0 ? d : a.section.localeCompare(b.section);
		});
	}
	function findByKey(k) { var d = data(); for (var i = 0; i < d.length; i++) { if (keyOf(d[i]) === k) return d[i]; } return null; }

	function loadLocalFlags() { return {}; }
	function saveLocalFlags() { }
	function effFlag(st) {
		return { flag: st.flag || "", note: st.note || "" };
	}
	function flagOf(lrn) {
		var d = data();
		for (var i = 0; i < d.length; i++) {
			for (var j = 0; j < d[i].students.length; j++) {
				if (d[i].students[j].lrn === lrn) return effFlag(d[i].students[j]).flag || "";
			}
		}
		return "";
	}
	function isDropped(st) { return !!(SMC.routine && SMC.routine.isDropout && SMC.routine.isDropout(st.lrn)); }

	function host() { return document.getElementById("classListsView"); }
	function tally(sec) {
		var m = 0, f = 0, fl = 0, dr = 0, total = 0;
		sec.students.forEach(function (st) {
			if (isDropped(st)) { dr++; return; }
			total++;
			if (st.sex === "M") m++; else if (st.sex === "F") f++;
			if (effFlag(st).flag) fl++;
		});
		return { m: m, f: f, fl: fl, dr: dr, total: total };
	}
	function flagCls(f) { return f === "Behavior" ? "beh" : f === "Academic" ? "acad" : "close"; }
	function flagBadge(f) { if (!f) return ""; return '<span class="cl-fl cl-fl-' + flagCls(f) + '">' + esc(f) + "</span>"; }
	function statusPill(s) { var c = (s === "NEW") ? "new" : "old"; return '<span class="cl-st cl-st-' + c + '">' + esc(s || "") + "</span>"; }

	function render() {
		var el = host();
		if (!el) return;
		if (!rosterLoaded) { el.innerHTML = '<div class="cl-empty cl-loading">Loading protected class lists…</div>'; loadRoster().catch(function(){}); return; }
		el.innerHTML =
			'<div class="cl-wrap">' +
			'<header class="cl-head">' +
			'<div class="cl-head-l">' +
			'<span class="cl-head-ic"><svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></span>' +
			'<div><h2 class="cl-head-t">Class Lists</h2><p class="cl-head-s">Official class lists by year level, SY 2026-2027. Search, filter and print rosters.</p></div>' +
			'</div>' +
			'<div class="cl-head-r">' +
			'<button class="cl-btn ghost" id="clBackDash"><svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg> Dashboard</button>' +
			'</div>' +
			'</header>' +
			'<div id="clBody"></div>' +
			"</div>";
		document.getElementById("clBackDash").addEventListener("click", function () { if (SMC.app && SMC.app.go) SMC.app.go("dashboard"); else if (SMC.app && SMC.app.showView) SMC.app.showView("dashboard"); });
		if (state.view === "section" && findByKey(state.key)) renderSection(); else renderGrid();
	}

	function renderGrid() {
		state.view = "grid";
		var body = document.getElementById("clBody");
		if (!body) return;
		var levels = LEVEL_ORDER.filter(function (l) { return data().some(function (s) { return s.level === l; }); });
		var grand = 0, gDrop = 0; data().forEach(function (s) { s.students.forEach(function (st) { if (isDropped(st)) { gDrop++; } else { grand++; } }); });
		var gFlag = 0; data().forEach(function (s) { s.students.forEach(function (st) { if (!isDropped(st) && effFlag(st).flag) gFlag++; }); });
		body.innerHTML =
			'<div class="cl-tools">' +
			'<div class="cl-search-wrap"><svg class="cl-search-ic" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>' +
			'<input type="text" id="clSearch" class="cl-search" placeholder="Search student name, Student Number, section or adviser"></div>' +
			'<select id="clLevel" class="cl-filter"><option value="">All year levels</option>' + levels.map(function (l) { return '<option value="' + esc(l) + '">' + esc(l) + "</option>"; }).join("") + "</select>" +
			'<select id="clFlag" class="cl-filter"><option value="">All students</option><option value="__any__">Any concern</option>' + FLAGS.map(function (f) { return '<option value="' + esc(f) + '">' + esc(f) + "</option>"; }).join("") + "</select>" +
			"</div>" +
			'<div class="cl-summary"><span><strong>' + data().length + '</strong> sections</span><span><strong>' + grand + '</strong> students</span><span><strong>' + gFlag + '</strong> with concern</span>' + (gDrop ? '<span><strong>' + gDrop + '</strong> dropped</span>' : '') + '</div>' +
			'<div id="clGrid" class="cl-list"></div>';
		document.getElementById("clSearch").addEventListener("input", drawCards);
		document.getElementById("clLevel").addEventListener("change", drawCards);
		document.getElementById("clFlag").addEventListener("change", drawCards);
		document.getElementById("clGrid").addEventListener("click", function (e) {
			var sw = e.target.closest("[data-cl-color]");
			if (sw) { e.stopPropagation(); openColorPicker(sw, sw.getAttribute("data-cl-color"), sw.getAttribute("data-cl-ckey")); return; }
			var card = e.target.closest("[data-cl-key]");
			if (card) { state.key = card.getAttribute("data-cl-key"); renderSection(); }
		});
		drawCards();
	}

	function drawCards() {
		var grid = document.getElementById("clGrid");
		if (!grid) return;
		var q = (document.getElementById("clSearch").value || "").toLowerCase().trim();
		var lv = document.getElementById("clLevel").value || "";
		var ff = document.getElementById("clFlag").value || "";
		var list = sorted().filter(function (s) {
			if (lv && s.level !== lv) return false;
			if (ff) {
				var has = s.students.some(function (st) { var f = effFlag(st).flag; return ff === "__any__" ? !!f : f === ff; });
				if (!has) return false;
			}
			if (q) {
				var meta = (s.level + " " + s.section + " " + s.adviser).toLowerCase();
				if (meta.indexOf(q) !== -1) return true;
				return s.students.some(function (st) { return (st.name + " " + st.lrn).toLowerCase().indexOf(q) !== -1; });
			}
			return true;
		});
		if (!list.length) {
			grid.innerHTML = '<div class="cl-empty">No class lists match your search.</div>';
			return;
		}
		var byLvl = {}, order = [];
		list.forEach(function (s) { if (!byLvl[s.level]) { byLvl[s.level] = []; order.push(s.level); } byLvl[s.level].push(s); });
		grid.innerHTML = order.map(function (lvl) {
			var secs = byLvl[lvl], gc = gradeColor(lvl), gTot = 0, gFl = 0, gDr = 0;
			secs.forEach(function (s) { var tt = tally(s); gTot += tt.total; gFl += tt.fl; gDr += tt.dr; });
			var head = '<div class="cl-lvl-row">' +
				'<button type="button" class="cl-swatch" data-cl-color="lvl" data-cl-ckey="' + esc(lvl) + '" title="Set colour for ' + esc(lvl) + '" style="background:' + gc + '"></button>' +
				'<span class="cl-lvl-nm">' + esc(lvl) + '</span>' +
				'<span class="cl-lvl-mt">' + secs.length + ' section' + (secs.length > 1 ? 's' : '') + ' \u00b7 ' + gTot + ' students' + (gFl ? ' \u00b7 ' + gFl + ' with concern' : '') + (gDr ? ' \u00b7 ' + gDr + ' dropped' : '') + '</span>' +
				'</div>';
			var lines = secs.map(function (s) {
				var t = tally(s), c = sectionColor(s);
				return '<div class="cl-line" data-cl-key="' + esc(keyOf(s)) + '" style="border-left-color:' + c + '">' +
					'<button type="button" class="cl-swatch sm" data-cl-color="sec" data-cl-ckey="' + esc(keyOf(s)) + '" title="Set colour for this section" style="background:' + c + '"></button>' +
					'<span class="cl-line-main"><span class="cl-line-sec">' + esc(s.section) + '</span><span class="cl-line-adv">' + esc(s.adviser || "\u2014") + (s.room ? ' \u00b7 Rm ' + esc(s.room) : '') + '</span></span>' +
					'<span class="cl-line-tallies"><span class="cl-chip">' + t.total + '</span><span class="cl-chip m">' + t.m + ' M</span><span class="cl-chip f">' + t.f + ' F</span>' + (t.fl ? '<span class="cl-chip flag">' + t.fl + ' with concern</span>' : '') + (t.dr ? '<span class="cl-chip dropped">' + t.dr + ' dropped</span>' : '') + '</span>' +
					'<svg class="cl-line-arr" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>' +
					'</div>';
			}).join("");
			return '<div class="cl-lvl-grp">' + head + '<div class="cl-lines">' + lines + '</div></div>';
		}).join("");
	}

	function renderSection() {
		state.view = "section";
		var sec = findByKey(state.key);
		var body = document.getElementById("clBody");
		if (!sec || !body) { renderGrid(); return; }
		var t = tally(sec);
		body.innerHTML =
			'<div class="cl-sec">' +
			'<div class="cl-sec-bar">' +
			'<button class="cl-btn ghost" id="clBackGrid"><svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg> All class lists</button>' +
			'<button class="cl-btn primary" id="clPrintBtn"><svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg> Print</button>' +
			"</div>" +
			'<div class="cl-sec-head">' +
			'<div><div class="cl-sec-lvl">' + esc(sec.level) + '</div><h3 class="cl-sec-title">' + esc(sec.section) + "</h3>" +
			'<div class="cl-sec-meta">Adviser: <strong>' + esc(sec.adviser || "\u2014") + "</strong>" + (sec.room ? " &middot; Room " + esc(sec.room) : "") + "</div></div>" +
			'<div class="cl-sec-tallies"><span class="cl-chip">' + t.total + ' total</span><span class="cl-chip m">' + t.m + ' M</span><span class="cl-chip f">' + t.f + ' F</span>' + (t.fl ? '<span class="cl-chip flag">' + t.fl + ' with concern</span>' : "") + (t.dr ? '<span class="cl-chip dropped">' + t.dr + ' dropped</span>' : "") + "</div>" +
			"</div>" +
			'<div class="cl-sec-tools"><div class="cl-search-wrap sm"><svg class="cl-search-ic" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg><input type="text" id="clRowSearch" class="cl-search" placeholder="Filter this roster by name or Student Number"></div></div>' +
			'<div id="clRoster"></div>' +
			"</div>";
		document.getElementById("clBackGrid").addEventListener("click", function () { state.key = null; renderGrid(); });
		document.getElementById("clPrintBtn").addEventListener("click", function () { printSection(sec); });
		document.getElementById("clRowSearch").addEventListener("input", function () { drawRoster(sec); });
		document.getElementById("clRoster").addEventListener("click", function (e) {
			var b = e.target.closest("button[data-cl-edit]");
			if (b) openFlagModal(sec, b.getAttribute("data-cl-edit"));
		});
		drawRoster(sec);
	}

	function groupRows(sec, sex, q) {
		var n = 0;
		var rows = sec.students.filter(function (st) { return st.sex === sex; }).map(function (st) {
			var ef = effFlag(st);
			var dropped = isDropped(st);
			if (!dropped) n++;
			if (q && (st.name + " " + st.lrn).toLowerCase().indexOf(q) === -1) return "";
			return '<tr data-cl-row="' + esc(st.lrn) + '"' + (dropped ? ' class="cl-row-dropped"' : '') + '>' +
				'<td class="cl-num">' + (dropped ? "\u2014" : n) + "</td>" +
				'<td class="cl-nm">' + esc(st.name) + (dropped ? ' <span class="cl-drop-tag">Dropped</span>' : "") + "</td>" +
				'<td class="cl-lrn">' + esc(st.lrn) + "</td>" +
				"<td>" + statusPill(st.status) + "</td>" +
				'<td class="cl-flagcell">' + (ef.flag ? flagBadge(ef.flag) : '<span class="cl-none">\u2014</span>') + (ef.note ? '<span class="cl-note" title="' + esc(ef.note) + '">' + esc(ef.note) + "</span>" : "") + "</td>" +
				(isStaff() ? '<td class="cl-act"><button class="cl-mini" data-cl-edit="' + esc(st.lrn) + '">Concern</button></td>' : "") +
				"</tr>";
		}).join("");
		return rows;
	}
	function drawRoster(sec) {
		var box = document.getElementById("clRoster");
		if (!box) return;
		var q = (document.getElementById("clRowSearch").value || "").toLowerCase().trim();
		var cols = isStaff() ? 6 : 5;
		function table(title, sex) {
			var rows = groupRows(sec, sex, q);
			if (!rows.replace(/\s/g, "")) return "";
			return '<div class="cl-group"><div class="cl-group-h">' + title + "</div>" +
				'<div class="cl-tbl-wrap"><table class="cl-tbl"><thead><tr><th>#</th><th>Name</th><th>Student Number</th><th>Status</th><th>Concern / Note</th>' + (isStaff() ? "<th></th>" : "") + '</tr></thead><tbody>' + rows + "</tbody></table></div></div>";
		}
		var html = table("Male", "M") + table("Female", "F");
		box.innerHTML = html || '<div class="cl-empty">No students match \u201c' + esc(q) + "\u201d.</div>";
	}

	/* ---- flag editor (staff) ---- */
	function ensureModal() {
		var m = document.getElementById("clFlagModal");
		if (m) return m;
		m = document.createElement("div");
		m.id = "clFlagModal";
		m.className = "cl-modal";
		m.innerHTML =
			'<div class="cl-modal-card">' +
			'<div class="cl-modal-h"><span id="clModalName"></span><button class="cl-modal-x" id="clModalX">&times;</button></div>' +
			'<label class="cl-modal-lb">Guidance concern</label>' +
			'<select id="clModalFlag" class="cl-modal-in"><option value="">None</option>' + FLAGS.map(function (f) { return '<option value="' + esc(f) + '">' + esc(f) + "</option>"; }).join("") + "</select>" +
			'<label class="cl-modal-lb">Note</label>' +
			'<textarea id="clModalNote" class="cl-modal-in" rows="3" placeholder="Optional note (reason, monitoring detail)"></textarea>' +
			'<div class="cl-modal-ft"><button class="cl-btn ghost" id="clModalCancel">Cancel</button><button class="cl-btn primary" id="clModalSave">Save concern</button></div>' +
			"</div>";
		document.body.appendChild(m);
		m.addEventListener("click", function (e) { if (e.target === m) closeModal(); });
		document.getElementById("clModalX").addEventListener("click", closeModal);
		document.getElementById("clModalCancel").addEventListener("click", closeModal);
		return m;
	}
	function closeModal() { var m = document.getElementById("clFlagModal"); if (m) m.classList.remove("on"); }
	function openFlagModal(sec, lrn) {
		if (!isStaff()) return;
		var st = null; for (var i = 0; i < sec.students.length; i++) { if (sec.students[i].lrn === lrn) { st = sec.students[i]; break; } }
		if (!st) return;
		var m = ensureModal();
		var ef = effFlag(st);
		document.getElementById("clModalName").textContent = st.name + " \u00b7 " + lrn;
		document.getElementById("clModalFlag").value = ef.flag || "";
		document.getElementById("clModalNote").value = ef.note || "";
		var saveBtn = document.getElementById("clModalSave");
		saveBtn.onclick = function () {
			var flag = document.getElementById("clModalFlag").value || "";
			var note = document.getElementById("clModalNote").value || "";
			if (!(api && api.saveClassFlag)) return;
			saveBtn.disabled = true;
			api.saveClassFlag({ lrn: lrn, flag: flag, note: note }).then(function () {
				st.flag = flag; st.note = note; saveBtn.disabled = false; closeModal();
				if (ui && ui.toast) ui.toast("Concern saved securely.", "ok"); drawRoster(sec);
			}).catch(function (e) { saveBtn.disabled = false; if (ui && ui.toast) ui.toast((e && e.message) || "Could not save concern.", "err"); });
		};
		m.classList.add("on");
	}

	/* ---- formal print ---- */
	function printSection(sec) {
		var area = document.getElementById("clPrintArea");
		if (!area) { area = document.createElement("div"); area.id = "clPrintArea"; document.body.appendChild(area); }
		function rows(sex) {
			var n = 0;
			return sec.students.filter(function (s) { return s.sex === sex; }).map(function (st) {
				var ef = effFlag(st); var dropped = isDropped(st); if (!dropped) n++;
				return "<tr><td class=\"cpn\">" + (dropped ? "-" : n) + "</td><td>" + esc(st.name) + (dropped ? " (Dropped)" : "") + "</td><td>" + esc(st.lrn) + "</td><td>" + esc(st.status || "") + "</td><td>" + esc(ef.flag ? ef.flag + (ef.note ? " - " + ef.note : "") : "") + "</td></tr>";
			}).join("");
		}
		function block(title, sex) {
			var r = rows(sex); if (!r) return "";
			return '<div class="cpr-grp">' + title + '</div><table class="cpr-tbl"><thead><tr><th>#</th><th>Name</th><th>Student Number</th><th>Status</th><th>Guidance Concern / Note</th></tr></thead><tbody>' + r + "</tbody></table>";
		}
		var t = tally(sec);
		area.innerHTML =
			'<div class="cpr">' +
			'<div class="cpr-head"><div class="cpr-ht">STELLA MARIS COLLEGE</div><div class="cpr-hs">Cubao, Quezon City</div><div class="cpr-doc">CLASS LIST</div><div class="cpr-hs">School Year 2026-2027</div></div>' +
			'<div class="cpr-meta"><div><span class="cpr-k">Section:</span> ' + esc(sec.level) + " - " + esc(sec.section) + '</div><div><span class="cpr-k">Adviser:</span> ' + esc(sec.adviser || "") + "</div>" +
			'<div><span class="cpr-k">Room:</span> ' + esc(sec.room || "\u2014") + '</div><div><span class="cpr-k">Count:</span> ' + t.total + " (" + t.m + " M / " + t.f + " F)</div></div>" +
			block("MALE", "M") + block("FEMALE", "F") +
			'<div class="cpr-foot">Generated by SMC Guidance Center &middot; Data transcribed from the official class list; verify entries against the source record.</div>' +
			"</div>";
		document.body.classList.add("printing-cl");
		var cleanup = function () { document.body.classList.remove("printing-cl"); window.removeEventListener("afterprint", cleanup); };
		window.addEventListener("afterprint", cleanup);
		setTimeout(function () { window.print(); }, 60);
	}

	function searchStudents(q) {
		q = String(q || "").toLowerCase().trim();
		if (!q) return [];
		var out = [];
		data().forEach(function (s) {
			s.students.forEach(function (st) {
				if ((st.name + " " + st.lrn).toLowerCase().indexOf(q) !== -1) {
					out.push({ name: st.name, lrn: st.lrn, sex: st.sex, level: s.level, section: s.section, key: keyOf(s) });
				}
			});
		});
		out.sort(function (a, b) { return a.name.localeCompare(b.name); });
		return out;
	}
	function openStudent(lrn) {
		var d = data();
		for (var i = 0; i < d.length; i++) {
			for (var j = 0; j < d[i].students.length; j++) {
				if (d[i].students[j].lrn === lrn) {
					state.view = "section";
					state.key = keyOf(d[i]);
					render();
					setTimeout(function () {
						var sel = (window.CSS && CSS.escape) ? CSS.escape(lrn) : lrn;
						var row = document.querySelector('[data-cl-row="' + sel + '"]');
						if (row) { row.scrollIntoView({ behavior: "smooth", block: "center" }); row.classList.add("cl-row-hl"); setTimeout(function () { row.classList.remove("cl-row-hl"); }, 2400); }
					}, 90);
					return;
				}
			}
		}
	}
	function listSections() {
		return sorted().map(function (s) { return { key: keyOf(s), level: s.level, section: s.section, adviser: s.adviser || "", count: s.students.length }; });
	}
	function openSection(k) {
		var sec = findByKey(k);
		if (!sec) return;
		state.view = "section";
		state.key = k;
		render();
	}
	return { render: render, setUser: setUser, load: loadRoster, ready: loadRoster, searchStudents: searchStudents, openStudent: openStudent, listSections: listSections, openSection: openSection, flagOf: flagOf };
})();
