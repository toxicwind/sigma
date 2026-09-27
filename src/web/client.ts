import { MESSAGES } from "./i18n.js";

export const WEB_CLIENT = `(function () {
    "use strict";
    const MESSAGES=${JSON.stringify(MESSAGES)};
    let locale = "zh-CN";
    try {
        const saved = localStorage.getItem("bili-language");
        if (saved === "en" || saved === "zh-CN") locale = saved;
        else if (/^en([-_]|$)/i.test(navigator.language || "")) locale = "en";
    } catch (e) {}
    function t(key, vars) {
        let text = MESSAGES[locale][key];
        if (text === undefined) text = MESSAGES["zh-CN"][key];
        if (text === undefined) text = key;
        if (vars) for (const name of Object.keys(vars)) text = text.split("{" + name + "}").join(String(vars[name]));
        return text;
    }
    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === \'"\' ? "&quot;" : "&#39;");
    }
    function $(id) { return document.getElementById(id); }
    function toast(message, kind) {
        const host = $("toast-host");
        if (!host) return;
        const el = document.createElement("div");
        el.className = "toast " + (kind === "err" ? "err" : "ok");
        el.textContent = message;
        host.appendChild(el);
        setTimeout(() => el.remove(), 2600);
    }
    function busy(btn, on) {
        if (on) { btn.dataset.label = btn.innerHTML; btn.classList.add("busy"); btn.disabled = true; }
        else { btn.classList.remove("busy"); btn.disabled = false; if (btn.dataset.label !== undefined) btn.innerHTML = btn.dataset.label; }
    }
    async function json(url, opts) {
        const res = await fetch(url, opts);
        let body = null;
        try { body = await res.json(); } catch (e) {}
        if (!res.ok) throw new Error(body && body.error ? String(body.error) : "HTTP " + res.status);
        return body;
    }
    async function putCfg(btn, payload) {
        busy(btn, true);
        try {
            await json("/__bili/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
            toast(t("cfg.saved"), "ok");
            loadConfig();
        } catch (e) {
            toast(e.message, "err");
        } finally {
            busy(btn, false);
        }
    }
    function fmtW(n) {
        if (n === null || n === undefined || isNaN(n)) return t("common.none");
        n = Math.round(Number(n));
        const abs = Math.abs(n);
        if (abs >= 1e9) return (n / 1e9).toFixed(1) + "B";
        if (abs >= 1e6) return (n / 1e6).toFixed(1) + "M";
        if (abs >= 1e4) return Math.round(n / 1e3) + "K";
        if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
        return String(n);
    }
    function fmtB(n) {
        if (n === null || n === undefined || isNaN(n)) return t("common.none");
        n = Number(n);
        const units = ["B", "KB", "MB", "GB", "TB"];
        let i = 0;
        while (Math.abs(n) >= 1024 && i < units.length - 1) { n /= 1024; i++; }
        return (i > 0 ? n.toFixed(1) : String(Math.round(n))) + " " + units[i];
    }
    function timeAgo(iso) {
        if (!iso) return t("common.none");
        const then = typeof iso === "number" ? iso : Date.parse(String(iso));
        if (isNaN(then)) return escapeHtml(String(iso));
        const s = Math.max(0, (Date.now() - then) / 1000);
        if (s < 60) return Math.floor(s) + "s";
        if (s < 3600) return Math.floor(s / 60) + "m";
        if (s < 86400) return Math.floor(s / 3600) + "h";
        return Math.floor(s / 86400) + "d";
    }
    function fmtDT(ms) {
        const d = new Date(ms || 0);
        const p = (v) => String(v).padStart(2, "0");
        return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
    }

    function hostOf(u) {
        if (!u) return "";
        try { return new URL(u).host; } catch (e) { return u; }
    }
    // #1426: sessions recorded before wire-path tagging have protocol "unknown" — show them as
    // "unmarked (legacy)" instead of a bare question mark.
    function protoBadge(p) {
        if (!p || p === "unknown") return '<span class="dim small">' + escapeHtml(t("protocol.unmarked")) + "</span>";
        return '<span class="badge proto">' + escapeHtml(p) + "</span>";
    }
    function hydrate() {
        document.documentElement.lang = locale;
        document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.getAttribute("data-i18n")); });
        document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph"))); });
        document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.setAttribute("title", t(el.getAttribute("data-i18n-title"))); });
        const tog = $("language-toggle");
        if (tog) tog.textContent = locale === "zh-CN" ? "English" : "中文";
    }

    const PAGES = ["overview", "sessions", "config", "connect"];
    let current = "overview";
    let sessionsCache = [];

    function sessionTitleCell(s) {
        // #1426: title falls back to an "untitled" placeholder and the FULL session id is always
        // shown underneath so rows stay identifiable. Disk-restored pool entries read as history,
        // not live.
        const named = Boolean(s.title || s.label || s.firstBlockHint);
        const name = s.title || s.label || s.firstBlockHint || t("ses.no_title");
        const live = s.live && !s.restored;
        return '<span class="row-title' + (named ? "" : " faint") + '">' + escapeHtml(name) + "</span>"
            + ' <span class="badge ' + (live ? "live" : "disk") + '">' + (live ? t("common.live") : t("common.disk")) + "</span>"
            + (s.restored ? ' <span class="dim small">' + t("common.restored") + "</span>" : "")
            + '<span class="row-id">' + escapeHtml(s.id) + "</span>";
    }
    // SAVED column prefers ledger-derived net savings; pre-tagging sessions fall back
    // to the local tokensSaved estimate; neither present => honest dash, never fake 0.
    function savedTd(x) {
        const v = x.netSaved != null ? x.netSaved : (x.tokensSaved || 0);
        return v > 0 ? '<td class="num good-num">' + fmtW(v) + "</td>" : (v ? '<td class="num">' + fmtW(v) + "</td>" : '<td class="num dim">' + t("common.none") + "</td>");
    }

    function sessionRow(s, compact) {
        const tr = document.createElement("tr");
        tr.title = s.id;
        if (compact) {
            tr.innerHTML = "<td>" + sessionTitleCell(s) + '</td><td>' + protoBadge(s.protocol) + '</td><td class="num">' + fmtW(s.contextTokens) + '</td>' + savedTd(s) + '<td class="dim">' + timeAgo(s.lastSeen) + "</td>";
        } else {
            tr.innerHTML = "<td>" + sessionTitleCell(s) + '</td><td>' + (s.clientHint ? '<span class="mono small">' + escapeHtml(s.clientHint) + "</span>" : '<span class="dim">' + t("common.none") + "</span>") + '</td><td>' + protoBadge(s.protocol) + '</td><td class="mono dim small">' + escapeHtml(hostOf(s.upstreamOrigin)) + '</td><td class="num">' + (s.requests ? s.requests : t("common.none")) + '</td><td class="num">' + fmtW(s.contextTokens) + '</td><td class="num">' + (s.inputTokens ? fmtW(s.inputTokens) : '<span class="dim">' + t("common.none") + "</span>") + "</td>" + savedTd(s) + '<td class="num">' + (s.cacheHitPct == null ? t("common.none") : s.cacheHitPct.toFixed(1) + "%") + '</td><td class="num">' + (s.foldCount || 0) + '</td><td class="num">' + (s.blocks || 0) + '</td><td class="dim">' + timeAgo(s.lastSeen) + "</td>";
        }
        tr.addEventListener("click", () => { location.hash = "#/session/" + encodeURIComponent(s.id); });
        return tr;
    }

    async function loadOverview() {
        try {
            const d = await json("/__bili/overview");
            const o = d.overview || {};
            // #1426: total splits live vs historical (disk-restored pool entries are history);
            // counters without usage samples render "—" instead of a misleading 0; the saved
            // counter labels how much comes from pre-tagging local estimates (no cache ledger).
            const total = o.sessions || 0;
            const liveN = o.live || 0;
            $("st-sessions").textContent = String(total);
            $("st-sessions-sub").textContent = liveN + " " + t("ov.live_now") + " · " + Math.max(0, total - liveN) + " " + t("ov.hist");
            $("st-reqs").textContent = o.requests ? fmtW(o.requests) : t("common.none");
            $("st-gross").textContent = o.grossSavedTotal ? fmtW(o.grossSavedTotal) : t("common.none");
            $("st-gross-sub").textContent = t("ov.gross_note") + ((o.savedEstimated || 0) > 0 ? " · " + t("ov.saved_from_legacy", { n: fmtW(o.savedEstimated) }) : "");
            $("st-netsaved").textContent = o.hasFoldData ? ((o.netSavedTotal || 0) < 0 ? "-" : "") + fmtW(Math.abs(o.netSavedTotal || 0)) : t("common.none");
            $("st-net-sub").textContent = o.hasFoldData ? t("ov.sub_repay", { r: fmtW(o.repayTotal || 0), s: fmtW(o.summaryCostTotal || 0) }) + ((o.savedEstimated || 0) > 0 ? " · " + t("ov.net_excl") : "") : "";
            $("st-hitpct").textContent = o.hitPct == null ? t("common.none") : o.hitPct.toFixed(1) + "%";
            $("st-input").textContent = o.inputTokens ? fmtW(o.inputTokens) : t("common.none");
            $("st-cached").textContent = o.cachedTokens ? fmtW(o.cachedTokens) : t("common.none");
            $("st-output").textContent = o.outputTokens ? fmtW(o.outputTokens) : t("common.none");
            const pb = $("protocol-body");
            pb.innerHTML = "";
            const rows = (o.byProtocol || []).slice().sort((a, b) => b.sessions - a.sessions || b.requests - a.requests);
            if (!rows.length) pb.innerHTML = '<tr><td colspan="7" class="dim">' + t("common.empty") + "</td></tr>";
            rows.forEach((r) => {
                const tr = document.createElement("tr");
                tr.innerHTML = '<td>' + protoBadge(r.protocol) + '</td><td class="num">' + r.sessions + '</td><td class="num">' + (r.requests ? fmtW(r.requests) : t("common.none")) + '</td><td class="num">' + (r.inputTokens ? fmtW(r.inputTokens) : t("common.none")) + '</td><td class="num">' + (r.cachedTokens ? fmtW(r.cachedTokens) : t("common.none")) + '</td><td class="' + (r.savedNet > 0 ? "num good-num" : "num") + '">' + (r.savedNet ? fmtW(r.savedNet) : t("common.none")) + '</td><td class="num">' + (r.folds ? fmtW(r.folds) : t("common.none")) + "</td>";
                pb.appendChild(tr);
            });
            $("sys-version").textContent = d.version || "?";
            $("sys-disk-version").textContent = d.diskVersion || t("common.none");
            $("sys-inflight").textContent = String(d.inFlight || 0);
            const bt = d.blindTunnels || {};
            $("sys-blind").textContent = String(bt.total != null ? bt.total : 0);
            const rb = $("recent-body");
            rb.innerHTML = "";
            const recent = (o.recent || []).slice(0, 8);
            if (!recent.length) rb.innerHTML = '<tr><td colspan="12" class="dim">' + t("common.empty") + "</td></tr>";
            recent.forEach((s) => rb.appendChild(sessionRow(s, false)));
            renderBanners(d);
        } catch (e) {
            toast(t("toast.failed", { msg: e.message }), "err");
        }
    }
    function renderBanners(d) {
        const stale = $("stale-banner");
        if (d.stale) {
            stale.hidden = false;
            stale.classList.add("show");
            stale.innerHTML = "<strong>" + t("sys.stale", { disk: d.diskVersion || "?", running: d.version || "?" }) + "</strong> " + (d.autoRestartOnUpdate ? t("sys.stale_auto") : t("sys.stale_manual"));
        } else {
            stale.hidden = true;
            stale.classList.remove("show");
            stale.innerHTML = "";
        }
        const pt = $("passthrough-banner");
        if (d.passthrough && d.passthrough.enabled) {
            pt.hidden = false;
            pt.classList.add("show");
            pt.textContent = t("sys.pt_on") + (d.passthrough.source === "env" ? t("sys.pt_env") : t("sys.pt_file"));
        } else {
            pt.hidden = true;
            pt.classList.remove("show");
            pt.textContent = "";
        }
        const cb = $("conflicts-banner");
        if (cb) {
            const c = d.conflicts;
            if (c && c.events > 0) {
                cb.hidden = false;
                cb.classList.add("show");
                const kinds = Object.entries(c.kinds || {}).map((kv) => kv[0] + "×" + kv[1]).join(", ");
                cb.innerHTML = '<strong>' + t("conflict.on") + "</strong> " + t("conflict.desc") + '<span class="mono"> (' + c.events + " event(s) in " + c.sessions + " session(s): " + kinds + ")</span>";
            } else {
                cb.hidden = true;
                cb.classList.remove("show");
                cb.innerHTML = "";
            }
        }
    }

    async function loadSessions(detailId) {
        const listEl = $("sessions-list-view");
        const detEl = $("session-detail-view");
        if (detailId) {
            listEl.hidden = true;
            detEl.hidden = false;
            await loadDetail(detailId);
            return;
        }
        detEl.hidden = true;
        listEl.hidden = false;
        await refreshSessions(true);
    }
    async function refreshSessions(showToast) {
        try {
            const d = await json("/__bili/sessions");
            sessionsCache = d.sessions || [];
            renderSessionTable();
        } catch (e) {
            if (showToast) toast(t("toast.failed", { msg: e.message }), "err");
        }
    }
    function renderSessionTable() {
        const input = $("ses-search");
        const q = ((input && input.value) || "").toLowerCase();
        const rows = sessionsCache.filter((s) => !q
            || (s.title || "").toLowerCase().indexOf(q) >= 0
            || (s.label || "").toLowerCase().indexOf(q) >= 0
            || s.id.toLowerCase().indexOf(q) >= 0);
        $("ses-count").textContent = t("ses.count", { count: rows.length });
        const tb = $("sessions-body");
        tb.innerHTML = "";
        if (!rows.length) {
            tb.innerHTML = '<tr><td colspan="9"><div class="empty"><div class="big">🗂</div>' + t("ses.empty") + "<br>" + t("ses.empty_hint") + "</div></td></tr>";
            return;
        }
        rows.forEach((s) => tb.appendChild(sessionRow(s, false)));
    }

    function mini(parts, label, value, good) {
        parts.push('<div class="stat' + (good ? " good" : "") + '"><div class="k">' + label + '</div><div class="v' + (value == null ? " faint" : "") + '">' + (value == null ? t("common.none") : value) + "</div></div>");
    }
    function kv(parts, label, value, mono) {
        parts.push('<div class="k">' + label + '</div><div class="v' + (mono ? " mono" : "") + '">' + (value == null || value === "" ? t("common.none") : escapeHtml(String(value))) + "</div>");
    }
    function trajectorySvg(lines, folds, win, baseIn) {
        lines = (lines || []).filter((l) => Boolean(l));
        if (!lines.length) return "";
        const W = 960, H = 260, PL = 56, PR = 16, PT = 14, PB = 26;
        const iw = W - PL - PR, ih = H - PT - PB;
        let maxY = 0;
        lines.forEach((l) => { if ((l.input || 0) > maxY) maxY = l.input; });
        if (win && win > maxY) maxY = win * 1.05;
        if (maxY <= 0) maxY = 1;
        const x = (i) => PL + (lines.length === 1 ? iw / 2 : (i / (lines.length - 1)) * iw);
        const y = (v) => PT + ih - (Math.max(0, v) / maxY) * ih;
        const dt = (ms) => fmtDT(ms);
        let grid = "", ticks = "";
        for (let g = 0; g <= 4; g++) {
            const v = (maxY / 4) * g;
            const yy = y(v);
            grid += '<line x1="' + PL + '" y1="' + yy.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + yy.toFixed(1) + '" stroke="var(--border)" stroke-width="1"/>';
            ticks += '<text x="' + (PL - 6) + '" y="' + (yy + 3).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--text-muted)">' + fmtW(v) + "</text>";
        }
        let area = "M" + x(0).toFixed(1) + "," + y(lines[0].input || 0).toFixed(1);
        let stroke = "";
        lines.forEach((l, i) => {
            area += " L" + x(i).toFixed(1) + "," + y(l.cached || 0).toFixed(1);
            stroke += (i === 0 ? "M" : "L") + x(i).toFixed(1) + "," + y(l.input || 0).toFixed(1) + " ";
        });
        area += " L" + x(lines.length - 1).toFixed(1) + "," + (PT + ih).toFixed(1) + " L" + x(0).toFixed(1) + "," + (PT + ih).toFixed(1) + " Z";
        // Cache-gap causes: color each sample's un-cached band (input − cached)
        // by its most likely cause so gaps on the chart explain themselves.
        // Heuristics use only fields every ledger era carries (at/input/cached + fold times).
        const GAP_MS = 600_000;
        const CAUSE_COLOR = { cold: "#6e7681", comp: "#bf8700", ttl: "#8250df" };
        const CAUSE_KEY = { cold: "det.cause_cold", comp: "det.cause_comp", ttl: "det.cause_ttl" };
        const causes = lines.map((l, i) => {
            if (i === 0) return !(l.cached || 0) ? "cold" : "new";
            const p = lines[i - 1];
            const missed = (l.input || 0) - (l.cached || 0);
            const growth = Math.max(0, (l.input || 0) - (p.input || 0));
            if ((folds || []).some((f) => (f.at || 0) >= (p.at || 0) && (f.at || 0) <= (l.at || 0)) && missed > growth + 256) return "comp";
            if ((l.at || 0) - (p.at || 0) > GAP_MS && missed > growth + 2048) return "ttl";
            return "new";
        });
        let bands = "", hovers = "";
        const swSeg = lines.length === 1 ? iw : iw / (lines.length - 1);
        lines.forEach((l, i) => {
            const c = causes[i];
            const yIn = y(l.input || 0), yCa = y(l.cached || 0);
            const x0 = Math.max(PL, x(i) - swSeg / 2), x1 = Math.min(W - PR, x(i) + swSeg / 2);
            if (c !== "new") {
                bands += '<rect x="' + x0.toFixed(1) + '" y="' + yIn.toFixed(1) + '" width="' + Math.max(1, x1 - x0).toFixed(1) + '" height="' + Math.max(3, yCa - yIn).toFixed(1) + '" fill="' + CAUSE_COLOR[c] + '" opacity="0.35" rx="1"/>';
            }
            const hitPctLine = (l.input || 0) > 0 ? ((l.cached || 0) / l.input * 100).toFixed(1) + "%" : t("common.none");
            hovers += '<rect x="' + x0.toFixed(1) + '" y="' + PT + '" width="' + Math.max(1, x1 - x0).toFixed(1) + '" height="' + ih + '" fill="transparent"><title>'
                + (l.seq != null ? "#" + l.seq + " · " : "") + dt(l.at)
                + "\\nin " + fmtW(l.input || 0) + " · cached " + fmtW(l.cached || 0) + " · missed " + fmtW((l.input || 0) - (l.cached || 0)) + " · hit " + hitPctLine
                + (c === "new" ? "" : "\\n" + t(CAUSE_KEY[c])) + "</title></rect>";
        });
        let foldMarks = "";
        // Burst-folds share (near-)identical timestamps and thus the same pixel — merge them
        // into one marker per pixel-bucket so stacked marks don't ghost into doubled lines.
        const foldBuckets = [];
        (folds || []).forEach((f) => {
            let idx = -1;
            for (let i = 0; i < lines.length; i++) { if ((lines[i].at || 0) >= (f.at || 0)) { idx = i; break; } }
            if (idx < 0) idx = lines.length - 1;
            const fx = x(idx);
            const bk = foldBuckets.find((b) => Math.abs(b.fx - fx) <= 1.5);
            if (bk) bk.items.push(f); else foldBuckets.push({ fx, items: [f] });
        });
        foldBuckets.forEach((bk) => {
            const n = bk.items.length;
            const seqs = bk.items.map((m) => m.seq != null ? "#" + m.seq : "").filter(Boolean).slice(0, 5).join("·");
            foldMarks += '<line x1="' + bk.fx.toFixed(1) + '" y1="' + PT + '" x2="' + bk.fx.toFixed(1) + '" y2="' + (PT + ih) + '" stroke="#cf222e" stroke-width="1.2" stroke-dasharray="3 3"><title>'
                + t("det.fold_short") + (n > 1 ? " ×" + n : "") + (seqs ? " " + seqs + (bk.items.length > 5 ? "…" : "") + " · " : " ") + dt(bk.items[0].at) + " · " + fmtW(bk.items.reduce((a, m) => a + (m.S || 0), 0)) + "</title></line>";
        });
        let ceiling = "";
        if (win && win > 0) {
            const yy = y(win);
            ceiling = '<line x1="' + PL + '" y1="' + yy.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + yy.toFixed(1) + '" stroke="#cf222e" stroke-width="1.5" stroke-dasharray="6 4"/>'
                + '<text x="' + (W - PR) + '" y="' + Math.max(10, yy - 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="#cf222e">' + t("det.legend_window") + " " + fmtW(win) + "</text>";
        }
        // Baseline: the not-compressible floor every request carries (system prompt + tools).
        // Measured when the kernel persisted systemPromptTokens; otherwise estimated as the
        // 10th percentile of (input − cached) across samples.
        let baseline = "";
        const baseMeasured = Boolean(baseIn && baseIn > 0);
        const baseVal = baseMeasured
            ? baseIn
            : lines.length >= 20
                ? (() => { const ds = lines.map((l) => Math.max(0, (l.input || 0) - (l.cached || 0))).sort((a, b) => a - b); return ds[Math.floor(ds.length * 0.1)] || 0; })()
                : 0;
        if (baseVal >= 200 && baseVal < maxY) {
            const yy = y(baseVal);
            baseline = '<line x1="' + PL + '" y1="' + yy.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + yy.toFixed(1) + '" stroke="#8b949e" stroke-width="1" stroke-dasharray="2 4"/>'
                + '<text x="' + PL + '" y="' + Math.max(10, yy - 4).toFixed(1) + '" font-size="9.5" fill="#8b949e">' + t(baseMeasured ? "det.legend_base" : "det.legend_base_est") + " " + fmtW(baseVal) + "</text>";
        }
        const xt = [0, Math.floor((lines.length - 1) / 2), lines.length - 1]
            .map((i) => '<text x="' + x(i).toFixed(1) + '" y="' + (H - 20) + '" text-anchor="middle" font-size="10" fill="var(--text-muted)">' + lines[i].seq + "</text>").join("");
        const xtTime =
            (lines[0] && lines[0].at ? '<text x="' + PL + '" y="' + (H - 8) + '" text-anchor="start" font-size="9.5" fill="var(--text-faint)">' + dt(lines[0].at) + "</text>" : "")
            + (lines.length > 1 && lines[lines.length - 1].at ? '<text x="' + (W - PR) + '" y="' + (H - 8) + '" text-anchor="end" font-size="9.5" fill="var(--text-faint)">' + dt(lines[lines.length - 1].at) + "</text>" : "");
        return '<svg viewBox="0 0 ' + W + " " + H + '" class="chart-svg" role="img">' + grid
            + '<path d="' + area + '" fill="var(--accent)" opacity="0.18"/>'
            + bands
            + hovers
            + '<path d="' + stroke.trim() + '" fill="none" stroke="var(--accent)" stroke-width="1.8"/>'
            + foldMarks + ceiling + baseline + ticks + xt + xtTime + "</svg>";
    }
    function legendItem(style, label, dashed) {
        if (dashed) return '<span><span class="dot" style="background:none;border-top:2px dashed #cf222e;height:0;border-radius:0;width:14px"></span>' + label + "</span>";
        return '<span><span class="dot" style="' + style + '"></span>' + label + "</span>";
    }
    function blockTopic(b) {
        // #1426: untitled blocks fall back to the lead line of their summary
        if (b.topic && String(b.topic).trim()) return String(b.topic).trim();
        const lead = String(b.summary || "").split("\\n").map((s) => s.trim()).find(Boolean) || "";
        return lead.length > 48 ? lead.slice(0, 48) + "…" : lead || b.blockId;
    }
    function detailBadges(d) {
        const live = d.live && !d.restored;
        let html = '<span class="badge ' + (live ? "live" : "disk") + '">' + (live ? t("common.live") : t("common.disk")) + "</span>";
        if (d.protocol) html += " " + protoBadge(d.protocol);
        if (d.restored) html += ' <span class="dim small">' + t("common.restored") + "</span>";
        return html;
    }
    // #1426: structured handoff rendering — per-role blocks with separated thinking,
    // output text and tool call/result formatting (tool chips + pretty JSON args).
    function toolChipCls(name) {
        if (name === "bash" || name === "shell" || name === "run_command") return "t-shell";
        if (name === "read" || name === "write" || name === "edit" || name === "ls" || name === "glob" || name === "note") return "t-file";
        if (name === "grep" || name === "search_context" || name === "decompress" || name === "acp_retrieve") return "t-seek";
        if (name === "compress" || name === "acp_status" || name === "acp_cache") return "t-fold";
        return "";
    }
    function parseToolLine(line) {
        const BT = String.fromCharCode(96);
        if (line.charAt(0) !== BT) return null;
        const ARGS = ")" + BT + " args: ";
        const RES = ")" + BT + " \u2192 ";
        let mark = -1, kind = "", tailLen = 0;
        if (line.indexOf(ARGS) > -1) { mark = line.indexOf(ARGS); kind = "call"; tailLen = ARGS.length; }
        else if (line.indexOf(RES) > -1) { mark = line.indexOf(RES); kind = "res"; tailLen = RES.length; }
        else return null;
        const nameId = line.slice(1, mark);
        const lp = nameId.indexOf("(");
        if (lp < 0) return null;
        return { kind: kind, name: nameId.slice(0, lp), cid: nameId.slice(lp + 1), text: line.slice(mark + tailLen) };
    }
    function splitHandoffBody(bodyLines) {
        const segs = [];
        for (const raw of bodyLines) {
            if (raw.trim() === "" && !(segs.length && segs[segs.length - 1].type === "out")) continue;
            const tool = parseToolLine(raw);
            if (tool) { segs.push({ type: "tool", kind: tool.kind, name: tool.name, cid: tool.cid, lines: [tool.text] }); continue; }
            if (raw.indexOf("_reasoning_: ") === 0) {
                const lastT = segs[segs.length - 1];
                if (!lastT || lastT.type !== "think") segs.push({ type: "think", lines: [] });
                segs[segs.length - 1].lines.push(raw.slice("_reasoning_: ".length));
                continue;
            }
            const last = segs[segs.length - 1];
            if (last && (last.type === "out" || last.type === "think")) last.lines.push(raw);
            else segs.push({ type: "out", lines: [raw] });
        }
        return segs;
    }
    function renderHandoffMd(md) {
        const lines = md.split("\\n");
        let start = 0;
        for (let i = 0; i < lines.length; i++) if (lines[i].indexOf("## ") === 0 && lines[i].indexOf("Conversation") > -1) { start = i + 1; break; }
        const blocks = [];
        let cur = null;
        for (let i = start; i < lines.length; i++) {
            const l = lines[i];
            if (l.indexOf("### ") === 0) { cur = { role: l.slice(4).trim(), lines: [] }; blocks.push(cur); continue; }
            if (cur) cur.lines.push(l);
        }
        const html = [];
        if (!blocks.length) return '<span class="dim small">' + escapeHtml(String(md).slice(0, 200)) + "</span>";
        for (const b of blocks) {
            const role = b.role === "user" || b.role === "assistant" || b.role === "tool" ? b.role : "assistant";
            html.push('<h3 class="msg-role ' + role + '">' + role + "</h3>");
            const segs = splitHandoffBody(b.lines);
            if (!segs.length) { html.push('<div class="dim small">_(empty)_</div>'); continue; }
            for (const s of segs) {
                if (s.type === "think") {
                    const n = s.lines.filter((x) => x.trim() !== "").length;
                    html.push('<details class="msg-think"><summary>' + t("det.thinking") + " \u00b7 " + n + '</summary><div class="think-box">' + s.lines.map(escapeHtml).join("<br/>") + "</div></details>");
                } else if (s.type === "out") {
                    html.push('<p class="msg-out">' + s.lines.map(escapeHtml).join("<br/>") + "</p>");
                } else {
                    const txt = s.lines.join("\\n");
                    let shown = txt;
                    if (s.kind === "call") { try { shown = JSON.stringify(JSON.parse(txt), null, 2); } catch (e) {} }
                    html.push('<div class="' + (s.kind === "call" ? "msg-tool" : "msg-result") + '"><span class="tool-chip ' + toolChipCls(s.name) + '">' + escapeHtml(s.name) + '</span><span class="tool-cid">' + escapeHtml(s.cid) + "</span>" + (s.kind === "res" ? '<span class="dim"> \u2192 </span>' : "") + '<pre class="' + (s.kind === "call" ? "tool-args" : "tool-out") + '">' + escapeHtml(shown) + "</pre></div>");
                }
            }
        }
        return html.join("");
    }
    function buildDetailHtml(d) {
        const parts = [];
        parts.push('<a class="btn sm" href="#/sessions">' + t("common.back") + "</a>");
        parts.push('<div class="page-head"><div><h1 title="' + escapeHtml(d.title || d.label || d.id) + '">' + escapeHtml(d.title || d.label || d.id.slice(0, 16)) + '</h1><div class="sub mono">' + escapeHtml(d.id) + "</div></div><div>" + detailBadges(d) + "</div></div>");
        parts.push('<div class="card"><div class="card-h"><span>' + t("det.identity") + '</span></div><div class="card-b"><dl class="kv">');
        // Full title wraps in place, is hoverable (title attr) and carries a copy button.
        parts.push('<div class="k">' + t("common.title") + '</div><div class="v" title="' + escapeHtml(d.title || "") + '">' + (d.title ? escapeHtml(d.title) + ' <button id="title-copy" class="btn sm">' + t("common.copy") + "</button>" : '<span class="faint">' + t("common.none") + "</span>") + "</div>");
        if (d.label && d.label !== d.id) kv(parts, t("common.label"), d.label);
        kv(parts, t("common.protocol"), d.protocol || null, true);
        kv(parts, t("det.client_hint"), d.clientHint || null, true);
        kv(parts, t("common.upstream"), hostOf(d.upstreamOrigin) || null, true);
        kv(parts, t("det.active_pack"), d.activePack || null, true);
        parts.push("</dl></div></div>");
        parts.push('<div class="card" style="margin-top:16px"><div class="card-h"><span>' + t("det.usage") + '</span></div><div class="card-b">');
        parts.push('<div class="grid cols-4">');
        mini(parts, t("common.requests"), d.requests ? fmtW(d.requests) : null);
        mini(parts, t("ov.input_tokens"), d.inputTokens ? fmtW(d.inputTokens) : null);
        mini(parts, t("ov.cached_tokens"), d.cachedTokens ? fmtW(d.cachedTokens) : null);
        mini(parts, t("ov.output_tokens"), d.outputTokens ? fmtW(d.outputTokens) : null);
        const dSavedV = d.netSaved != null ? d.netSaved : d.tokensSaved;
        mini(parts, t("ov.tokens_saved"), dSavedV ? fmtW(dSavedV) : null, dSavedV > 0);
        mini(parts, t("det.last_input"), (d.lastInputTokens || 0) > 0 ? fmtW(d.lastInputTokens) : null);
        parts.push("</div>");
        if (d.contextWindow && d.contextWindow > 0) {
            const pct = Math.min(100, Math.round((d.contextTokens / d.contextWindow) * 100));
            const cls = pct >= 90 ? "bar-fill danger" : pct >= 70 ? "bar-fill warn" : "bar-fill";
            parts.push('<div class="bar-row"><span class="dim small">' + t("common.context") + " / " + t("common.window") + '</span><div class="bar-track"><div class="' + cls + '" style="width:' + pct + '%"></div></div><span class="mono small">' + fmtW(d.contextTokens) + " / " + fmtW(d.contextWindow) + " (" + pct + "%)</span></div>");
        } else {
            parts.push('<div class="dim small" style="margin-top:10px">' + t("common.context") + ": " + fmtW(d.contextTokens || 0) + "</div>");
        }
        if ((d.retrieveCalls || 0) > 0) parts.push('<div class="dim small" style="margin-top:10px">' + t("det.ccr") + ' · <span class="mono">' + t("det.ccr_detail", { calls: d.retrieveCalls, hits: d.retrieveHits || 0, misses: d.retrieveMisses || 0 }) + "</span></div>");
        if ((d.storedBytes || 0) > 0) parts.push('<div class="dim small" style="margin-top:4px">' + t("det.store") + ' · <span class="mono">' + fmtB(d.storedBytes) + ((d.storeBytesSaved || 0) > 0 ? " / " + fmtB(d.storeBytesSaved) + " " + t("common.saved") : "") + "</span></div>");
        parts.push("</div></div>");
        const ledger = d.ledger || {};
        const lines = ledger.lines || [];
        parts.push('<div class="card" style="margin-top:16px"><div class="card-h"><span>' + t("det.trajectory") + '</span><span class="hint">' + t("det.trajectory_sub") + '</span></div><div class="card-b">');
        if (!lines.length) {
            parts.push('<div class="chart-empty">' + t("det.trajectory_empty") + "</div>");
        } else {
            parts.push('<div class="chart-wrap">' + trajectorySvg(lines, ledger.folds || [], d.contextWindow, d.systemPromptTokens || 0) + "</div>");
            parts.push('<div class="chart-legend">');
            parts.push(legendItem("background:var(--accent)", t("det.legend_input")));
            parts.push(legendItem("background:var(--accent);opacity:.4", t("det.legend_cached"), false));
            parts.push(legendItem("#cf222e", t("det.legend_fold"), true));
            parts.push(legendItem("#cf222e", t("det.legend_window"), true));
            // Swatches carry real backgrounds (a bare hex in style= renders nothing):
            parts.push(legendItem("background:#bf8700", t("det.cause_comp")));
            parts.push(legendItem("background:#8250df", t("det.cause_ttl")));
            parts.push(legendItem("background:#6e7681", t("det.cause_cold")));
            if (d.systemPromptTokens || lines.length >= 20) parts.push(legendItem("border:1.5px solid #8b949e;background:#f2f5f7;", d.systemPromptTokens ? t("det.legend_base") : t("det.legend_base_est")));
            parts.push("</div>");
            if ((ledger.linesOmitted || 0) > 0) parts.push('<div class="dim small" style="margin-top:6px">' + t("det.omitted", { n: ledger.linesOmitted }) + "</div>");
        }
        parts.push("</div></div>");
        const tot = ledger.totals;
        parts.push('<div class="card" style="margin-top:16px"><div class="card-h"><span>' + t("det.cache_econ") + "</span>" + (tot ? (tot.balanced ? ' <span class="badge ok">' + t("det.ce_balanced") + "</span>" : ' <span class="badge warn">' + t("det.ce_unbalanced") + "</span>") : "") + '</div><div class="card-b">');
        if (tot) {
            parts.push('<div class="grid cols-4">');
            mini(parts, t("det.ce_new"), fmtW(tot.newContent || 0));
            mini(parts, t("det.ce_comp"), fmtW(tot.compRepay || 0));
            mini(parts, t("det.ce_ttl"), fmtW(tot.ttlRepay || 0));
            mini(parts, t("det.ce_residual"), fmtW(tot.residual || 0));
            parts.push("</div>");
        }
        const folds = ledger.folds || [];
        parts.push('<div class="section-label" style="margin-top:14px">' + t("det.folds") + "</div>");
        if (!folds.length) parts.push('<div class="dim small">' + t("det.folds_empty") + "</div>");
        else {
            // Numeric headers align with their columns; long fold lists stay scannable by
            // showing the first 10; the rest stay behind an expander in a scrollable panel.
            const foldHead = '<tr><th class="num">#</th><th>' + t("det.fold_time") + '</th><th class="num">' + t("det.fold_s") + '</th><th class="num">' + t("det.fold_sigma") + '</th><th class="num">' + t("det.fold_h") + '</th><th class="num">' + t("det.fold_t") + "</th></tr>";
            const foldRow = (f, i) => '<tr><td class="num">' + (f.seq != null ? f.seq : i + 1) + '</td><td class="num">' + (f.at ? fmtDT(f.at) : t("common.none")) + '</td><td class="num">' + fmtW(f.S) + '</td><td class="num">' + fmtW(f.sigma) + '</td><td class="num">' + (f.hPct == null ? t("common.none") : f.hPct.toFixed(1) + "%") + '</td><td class="num">' + fmtW(f.T) + "</td></tr>";
            const FOLD_CAP = 10;
            parts.push('<table class="data"><thead>' + foldHead + '</thead><tbody>');
            folds.slice(0, FOLD_CAP).forEach((f, i) => parts.push(foldRow(f, i)));
            parts.push("</tbody></table>");
            if (folds.length > FOLD_CAP) {
                parts.push('<details style="margin-top:8px"><summary class="dim small" style="cursor:pointer">' + t("det.folds_more", { n: folds.length - FOLD_CAP }) + '</summary><div class="fold-scroll"><table class="data"><thead>' + foldHead + '</thead><tbody>');
                folds.slice(FOLD_CAP).forEach((f, i) => parts.push(foldRow(f, i + FOLD_CAP)));
                parts.push("</tbody></table></div></details>");
            }
        }
        parts.push("</div></div>");
        const blocks = d.blockDetails || [];
        const activeBlocks = blocks.filter((b) => b.active).length;
        parts.push('<div class="card" style="margin-top:16px"><div class="card-h"><span>' + t("det.blocks_title") + '</span><span class="hint">' + t("det.blocks_count", { total: blocks.length, active: activeBlocks }) + '</span></div><div class="card-b blocks-list">');
        if (!blocks.length) {
            parts.push('<div class="dim small" style="padding:8px 0">' + t("det.blocks_empty") + "</div>");
        } else {
            // #1426: copy-all / download blocks-markdown actions
            parts.push('<div style="display:flex;gap:8px;margin-bottom:10px"><button id="blocks-copy" class="btn sm">' + t("det.blocks_copy_md") + '</button><button id="blocks-dl" class="btn sm">' + t("det.blocks_download") + "</button></div>");
            blocks.forEach((b, i) => {
                // #1426: expose the compressed conversation span (mNNNNN refs) when the kernel tagged it
                const refRange = b.startRef ? (b.endRef && b.endRef !== b.startRef ? b.startRef + "–" + b.endRef : b.startRef) : null;
                // Active = still inside the current context window; inactive = archived history.
                const badge = b.active
                    ? '<span class="badge ok">' + t("det.block_active") + "</span>"
                    : '<span class="badge disk">' + t("det.block_inactive") + "</span>";
                parts.push('<details class="block-item"><summary><span class="bid">' + escapeHtml(b.blockId) + '</span>' + badge + '<span class="topic">' + escapeHtml(blockTopic(b)) + '</span><span class="meta">T' + String(b.tier) + " · " + fmtW(b.compressedTokens) + " · " + timeAgo(b.createdAt) + (refRange ? " · " + escapeHtml(refRange) : "") + '</span><button class="btn sm blk-copy" data-bi="' + i + '" style="margin-left:auto">' + t("common.copy") + '</button></summary><div class="body">' + escapeHtml(b.summary) + "</div></details>");
            });
        }
        parts.push("</div></div>");
        parts.push('<div class="card" style="margin-top:16px"><div class="card-h"><span>' + t("det.handoff") + '</span><span class="hint">' + t("det.handoff_hint") + '</span></div><div class="card-b">');
        // #1426: copy / download actions over the rendered handoff document
        parts.push('<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap"><button id="handoff-copy-md" class="btn sm">' + t("det.handoff_copy_md") + '</button><button id="handoff-dl" class="btn sm">' + t("det.handoff_download") + "</button></div>");
        if (d.handoffTruncated) parts.push('<div class="banner warn show" style="margin:0 0 10px">' + t("det.handoff_truncated") + "</div>");
        if (d.handoffMd) parts.push('<div class="handoff">' + renderHandoffMd(d.handoffMd) + "</div>");
        else if (d.handoffHtml) parts.push('<div class="handoff">' + d.handoffHtml + "</div>");
        else parts.push('<div class="dim small">' + t("common.empty") + "</div>");
        parts.push("</div></div>");
        return parts.join("");
    }
    async function loadDetail(id) {
        const host = $("session-detail-view");
        host.innerHTML = '<div class="empty"><span class="spin"></span> ' + t("common.loading") + "</div>";
        let d = null;
        try {
            d = await json("/__bili/sessions/" + encodeURIComponent(id) + "/detail");
        } catch (e) {}
        if (!d) {
            host.innerHTML = '<a class="btn sm" href="#/sessions">' + t("common.back") + "</a>"
                + '<div class="card" style="margin-top:12px"><div class="card-b"><div class="empty"><div class="big">🔍</div>' + t("det.not_found") + "<br>" + t("det.not_found_hint") + "</div></div></div>";
            return;
        }
        try {
            host.innerHTML = buildDetailHtml(d);
            bindHandoffActions(d);
            bindBlocksActions(d);
            const tc = $("title-copy");
            if (tc && d.title) tc.addEventListener("click", () => copyText(d.title, tc));
        } catch (e) {
            host.innerHTML = '<a class="btn sm" href="#/sessions">' + t("common.back") + '</a><div class="card" style="margin-top:12px"><div class="card-b"><div class="empty">⚠️ ' + escapeHtml(e.message) + "</div></div></div>";
        }
    }
    // Shared clipboard helper: flash "copied" on the clicked button.
    function copyText(text, btn) {
        const done = () => {
            const orig = btn.textContent;
            btn.textContent = "✓ " + t("common.copied");
            setTimeout(() => { btn.textContent = orig; }, 1200);
        };
        const fallback = () => {
            const ta = document.createElement("textarea");
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand("copy"); } catch (e) {}
            ta.remove();
            done();
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(fallback);
        else fallback();
    }
    function refRangeOf(b) {
        return b.startRef ? (b.endRef && b.endRef !== b.startRef ? b.startRef + "–" + b.endRef : b.startRef) : null;
    }
    function buildBlockMd(b) {
        const rr = refRangeOf(b);
        const L = [];
        L.push("## Block " + b.blockId + (b.topic ? " — " + b.topic : "") + (b.active ? "" : " (inactive)"));
        L.push("");
        L.push("tier " + b.tier + " · ~" + fmtW(b.compressedTokens) + " tokens" + (b.createdAt ? " · " + fmtDT(b.createdAt) : "") + (rr ? " · " + rr : ""));
        L.push("");
        L.push(String(b.summary || "").trim());
        return L.join("\\n");
    }
    function buildBlocksMd(d) {
        const L = [];
        L.push("# billion-context compression blocks");
        L.push("");
        if (d.title) L.push("- title: " + d.title);
        L.push("- session id: " + d.id);
        L.push("- blocks: " + d.blockDetails.length + " (" + d.blockDetails.filter((x) => x.active).length + " active)");
        d.blockDetails.forEach((b) => { L.push(""); L.push(buildBlockMd(b)); });
        return L.join("\\n");
    }
    function bindBlocksActions(d) {
        if (!d.blockDetails || !d.blockDetails.length) return;
        const cp = $("blocks-copy");
        if (cp) cp.addEventListener("click", () => copyText(buildBlocksMd(d), cp));
        const dl = $("blocks-dl");
        if (dl) dl.addEventListener("click", () => {
            const url = URL.createObjectURL(new Blob([buildBlocksMd(d)], { type: "text/markdown;charset=utf-8" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = "billion-context-blocks-" + String(d.id).replace(/[^A-Za-z0-9._-]/g, "_") + ".md";
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
        });
        // Per-block copy buttons live inside <summary>, so stop propagation/toggle.
        document.querySelectorAll(".blk-copy").forEach((btn) => {
            const bi = Number(btn.getAttribute("data-bi") || 0);
            const b = d.blockDetails[bi];
            if (!b) return;
            btn.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); copyText(buildBlockMd(b), btn); });
        });
    }
    function bindHandoffActions(d) {
        const copyBtn = $("handoff-copy-md");
        const dlBtn = $("handoff-dl");
        if (!d.handoffMd) {
            if (copyBtn) copyBtn.hidden = true;
            if (dlBtn) dlBtn.hidden = true;
            return;
        }
        const md = d.handoffMd;
        if (copyBtn) copyBtn.addEventListener("click", () => {
            const done = () => { copyBtn.textContent = t("common.copied"); setTimeout(() => { copyBtn.textContent = t("det.handoff_copy_md"); }, 1200); };
            const fallback = () => {
                const ta = document.createElement("textarea");
                ta.value = md;
                ta.style.position = "fixed";
                ta.style.opacity = "0";
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand("copy"); done(); } catch (e) { toast(t("toast.failed", { msg: e.message }), "err"); }
                ta.remove();
            };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(md).then(done, fallback);
            else fallback();
        });
        if (dlBtn) dlBtn.addEventListener("click", () => {
            const url = URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = "billion-context-handoff-" + String(d.id).replace(/[^A-Za-z0-9._-]/g, "_") + ".md";
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
        });
    }

    async function loadConfig() {
        try {
            const cfg = await json("/__bili/config");
            $("cfg-file").textContent = cfg.path || t("common.empty");
            const fileBtn = $("copy-cfg-file");
            if (fileBtn && cfg.path) fileBtn.setAttribute("data-copy", cfg.path);
            const errBox = $("cfg-parse-error");
            if (cfg.parseError) {
                errBox.hidden = false;
                errBox.classList.add("show");
                errBox.textContent = t("cfg.parse_error");
            } else {
                errBox.hidden = true;
                errBox.classList.remove("show");
                errBox.textContent = "";
            }
            // #1426: provider routes go back to being editable — the read-only rendering was a
            // regression from the web UI rewrite; the API already accepted PUT {providers}
            const providers = cfg.providers && typeof cfg.providers === "object" && !Array.isArray(cfg.providers) ? cfg.providers : {};
            $("providers-json").value = JSON.stringify(providers, null, 2);
            const broken = Boolean(cfg.parseError);
            ["providers-json", "compress-json"].forEach((id) => { const el = $(id); if (el) el.disabled = broken; });
            ["save-providers", "save-compress", "save-upstream"].forEach((id) => { const el = $(id); if (el) el.disabled = broken; });
            const compressObj = cfg.compress && typeof cfg.compress === "object" && !Array.isArray(cfg.compress) ? cfg.compress : {};
            $("compress-json").value = Object.keys(compressObj).length ? JSON.stringify(compressObj, null, 2) : "";
            const ptState = $("pt-state");
            const ptSource = $("pt-source");
            const clearPt = $("clear-passthrough");
            const pt = cfg.passthrough;
            // #1426: passthrough shows where it came from; env-driven cannot be cleared from here
            if (pt && pt.enabled) {
                ptState.className = "badge ok";
                ptState.textContent = t("cfg.pt_on");
                ptSource.textContent = pt.source === "env" ? t("sys.pt_env") : t("sys.pt_file");
                clearPt.hidden = pt.source !== "env";
            } else {
                ptState.className = "badge disk";
                ptState.textContent = t("cfg.pt_off");
                ptSource.textContent = "";
                clearPt.hidden = true;
            }
            loadUpstream(cfg);
        } catch (e) {
            toast(t("toast.failed", { msg: e.message }), "err");
        }
    }
    async function loadUpstream(cfg) {
        let up = null;
        try { up = await json("/__bili/upstream"); } catch (e) {}
        // #1426: mode/proxy are editable form fields again, not read-only labels
        const mode = (up && up.mode) || cfg.upstreamProxyMode || "auto";
        document.querySelectorAll('input[name="proxy-mode"]').forEach((el) => { el.checked = el.value === mode; });
        const pu = $("proxy-url");
        if (pu) pu.value = ((up && up.proxy) || cfg.upstreamProxy || "").replace(new RegExp("/+$"), "");
        const st = $("up-state");
        if (up && up.connected === true) { st.className = "badge ok"; st.textContent = "ok · " + (up.checkedAt ? timeAgo(up.checkedAt) : ""); }
        else if (up && up.connected === false) { st.className = "badge warn"; st.textContent = up.error ? String(up.error) : "error"; }
        else { st.className = "badge disk"; st.textContent = t("cfg.untested"); }
    }

    function route() {
        const hash = location.hash || "#/overview";
        let name = "overview";
        let detailId = null;
        const top = hash.match(new RegExp("^#/(overview|config|connect)$"));
        if (top) {
            name = top[1];
        } else {
            const ses = hash.match(new RegExp("^#/sessions(?:/(.+))?$")) || hash.match(new RegExp("^#/session/(.+)$"));
            if (ses) {
                name = "sessions";
                if (ses[1]) detailId = decodeURIComponent(ses[1]);
            }
        }
        PAGES.forEach((p) => {
            const sec = $("page-" + p);
            if (sec) sec.hidden = p !== name;
        });
        document.querySelectorAll(".nav a[data-nav]").forEach((a) => a.classList.toggle("active", a.getAttribute("data-nav") === name));
        current = name;
        if (name === "overview") loadOverview();
        else if (name === "sessions") loadSessions(detailId);
        else if (name === "config") loadConfig();
    }
    window.addEventListener("hashchange", route);

    function initStaticHandlers() {
        const tog = $("language-toggle");
        if (tog) tog.addEventListener("click", () => {
            locale = locale === "zh-CN" ? "en" : "zh-CN";
            try { localStorage.setItem("bili-language", locale); } catch (e) {}
            location.reload();
        });
        const search = $("ses-search");
        if (search) search.addEventListener("input", renderSessionTable);
        const testBtn = $("test-upstream");
        if (testBtn) testBtn.addEventListener("click", async () => {
            busy(testBtn, true);
            try {
                const r = await json("/__bili/upstream/test", { method: "POST" });
                // #1426: an HTTP >= 400 answer still proves the network path works — auth is the
                // client's job, so report reachability instead of a flat failure
                const st = $("up-state");
                st.className = r.status >= 400 ? "badge warn" : "badge ok";
                st.textContent = "HTTP " + r.status;
                toast(r.status >= 400 ? t("toast.upstream_reachable", { status: r.status }) : t("toast.connect_ok", { status: r.status }), "ok");
            } catch (e) {
                toast(t("toast.failed", { msg: e.message }), "err");
                const st = $("up-state");
                st.className = "badge warn";
                st.textContent = e.message;
            } finally {
                busy(testBtn, false);
            }
        });
        // #1426: restore the config editors lost in the web UI rewrite (PUT endpoints were already in place)
        const su = $("save-upstream");
        if (su) su.addEventListener("click", async () => {
            const modeEl = document.querySelector('input[name="proxy-mode"]:checked');
            const mode = modeEl ? modeEl.value : "auto";
            const pu = $("proxy-url");
            const val = pu ? pu.value.trim() : "";
            await putCfg(su, { upstreamProxyMode: mode, upstreamProxy: val || null });
        });
        const sp = $("save-providers");
        if (sp) sp.addEventListener("click", async () => {
            const el = $("providers-json");
            const raw = el ? el.value.trim() : "";
            if (!raw) { await putCfg(sp, { providers: {} }); return; }
            let parsed;
            try { parsed = JSON.parse(raw); } catch (e) { toast(t("cfg.invalid_json"), "err"); return; }
            if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) { toast(t("cfg.invalid_json"), "err"); return; }
            await putCfg(sp, { providers: parsed });
        });
        const sc = $("save-compress");
        if (sc) sc.addEventListener("click", async () => {
            const el = $("compress-json");
            const raw = el ? el.value.trim() : "";
            if (!raw) { await putCfg(sc, { compress: null }); return; }
            let parsed;
            try { parsed = JSON.parse(raw); } catch (e) { toast(t("cfg.invalid_json"), "err"); return; }
            await putCfg(sc, { compress: parsed });
        });
        const cp = $("clear-passthrough");
        if (cp) cp.addEventListener("click", async () => {
            busy(cp, true);
            try {
                await json("/__bili/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ passthrough: null }) });
                toast(t("toast.passthrough_cleared"), "ok");
                loadConfig();
            } catch (e) {
                toast(e.message, "err");
            } finally {
                busy(cp, false);
            }
        });
        document.addEventListener("click", (ev) => {
            const target = ev.target;
            if (!target || !target.closest) return;
            const btn = target.closest(".copy-btn");
            if (!btn) return;
            let text = btn.getAttribute("data-copy") || "";
            if (!text) {
                const row = btn.parentElement;
                const box = row && row.querySelector ? row.querySelector(".codebox") : null;
                if (box) text = box.textContent || "";
            }
            if (!text) return;
            const span = btn.querySelector("span");
            const orig = span ? span.textContent : "";
            const done = () => {
                if (span) { span.textContent = t("common.copied"); setTimeout(() => { span.textContent = orig || t("common.copy"); }, 1200); }
            };
            const fallback = () => {
                const ta = document.createElement("textarea");
                ta.value = text;
                ta.style.position = "fixed";
                ta.style.opacity = "0";
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand("copy"); done(); } catch (e) {}
                ta.remove();
            };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
            else fallback();
        });
    }

    hydrate();
    initStaticHandlers();
    route();
    setInterval(() => {
        if (document.hidden) return;
        if (current === "overview") loadOverview();
        else if (current === "sessions" && $("session-detail-view").hidden) refreshSessions(false);
    }, 5000);
})();`;
