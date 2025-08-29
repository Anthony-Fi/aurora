// Aurora JS: small, focused UX helpers
(function () {
  const root = document.documentElement;
  root.classList.remove('no-js');
  root.classList.add('js');

  // Mobile nav toggle
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('primary-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const opened = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(opened));
    });

    // Close on link click (mobile)
    nav.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', () => {
        if (window.matchMedia('(max-width: 720px)').matches) {
          nav.classList.remove('open');
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
    });
  }

  // Footer year
  const y = document.getElementById('year');
  if (y) y.textContent = String(new Date().getFullYear());

  // Header subtle shadow on scroll
  const header = document.querySelector('.site-header');
  const onScroll = () => {
    if (!header) return;
    const hasShadow = window.scrollY > 4;
    header.style.boxShadow = hasShadow ? '0 8px 20px -16px rgba(0,0,0,.6)' : 'none';
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // --- Accessibility: toggleable data tables for charts ---
  function bindToggleOnce(btnId, wrapId) {
    const btn = document.getElementById(btnId);
    const wrap = document.getElementById(wrapId);
    if (!btn || !wrap || btn.dataset.bound) return;
    // Make region programmatically focusable for keyboard users
    if (!wrap.hasAttribute('tabindex')) {
      wrap.setAttribute('tabindex', '-1');
    }

    // Determine access key and set it once
    let ak = '';
    if (btnId.includes('wind')) ak = 'w';
    else if (btnId.includes('kp')) ak = 'k';
    else if (btnId.includes('bx')) ak = 'b';
    if (ak) {
      try { btn.setAttribute('accesskey', ak); } catch (_) {}
    }

    const LS_KEY = `aurora.table.${wrapId}.visible`;
    const applyVisibility = (show) => {
      if (show) {
        wrap.removeAttribute('hidden');
        btn.setAttribute('aria-expanded', 'true');
        btn.textContent = 'Hide data table';
        if (ak) {
          const hint = ak.toUpperCase();
          btn.title = `${btn.textContent} (Shortcut: Alt+Shift+${hint})`;
        }
        try { localStorage.setItem(LS_KEY, '1'); } catch (_) {}
        // Move focus to region so its contents are reachable by keyboard
        try { wrap.focus({ preventScroll: false }); } catch (_) { try { wrap.focus(); } catch (_) {} }
      } else {
        wrap.setAttribute('hidden', '');
        btn.setAttribute('aria-expanded', 'false');
        btn.textContent = 'Show data table';
        if (ak) {
          const hint = ak.toUpperCase();
          btn.title = `${btn.textContent} (Shortcut: Alt+Shift+${hint})`;
        }
        try { localStorage.setItem(LS_KEY, '0'); } catch (_) {}
      }
    };

    // Restore previous visibility preference; default to current DOM state
    let initialShow = !wrap.hasAttribute('hidden');
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved === '1') initialShow = true;
      else if (saved === '0') initialShow = false;
    } catch (_) {}
    applyVisibility(initialShow);

    // Click handler toggles state and persists
    btn.addEventListener('click', () => {
      const willShow = wrap.hasAttribute('hidden');
      applyVisibility(willShow);
    });

    btn.dataset.bound = '1';
  }

  function setTableRows(tbodyEl, rows) {
    if (!tbodyEl) return;
    if (!Array.isArray(rows) || rows.length === 0) {
      tbodyEl.innerHTML = '';
      return;
    }
    const html = rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td>${r.length > 2 ? `<td>${esc(r[2])}</td>` : ''}</tr>`).join('');
    tbodyEl.innerHTML = html;
  }

  const fmtNum = (v, d) => Number.isFinite(v) ? (d != null ? Number(v).toFixed(d) : String(v)) : '--';

  // --- Accessibility helpers for charts (global) ---
  function updateWindAccessibility(sw, tz) {
    try {
      const tzChoice = tz || getSelectedTZ();
      const sumEl = document.getElementById('wind-summary');
      const tbody = document.getElementById('wind-table-body');
      if (sumEl) {
        const sNow = asFiniteNumber(sw.now && sw.now.speed) ?? lastFinite(sw.speed);
        const dNow = asFiniteNumber(sw.now && sw.now.density) ?? lastFinite(sw.density);
        const t = sw.updatedAt ? fmtHM(sw.updatedAt, tzChoice) : '--:--';
        const sat = (sw.source && sw.source.satellite) ? sw.source.satellite : '—';
        sumEl.textContent = `Latest solar wind at ${t} (${sat}): speed ${fmtNum(sNow, 0)} km/s, density ${fmtNum(dNow, 2)} p/cc.`;
      }
      if (tbody) {
        const times = Array.isArray(sw.times) ? sw.times : (Array.isArray(sw.labels) ? sw.labels : []);
        const spd = Array.isArray(sw.speed) ? sw.speed : [];
        const den = Array.isArray(sw.density) ? sw.density : [];
        const n = Math.min(times.length, spd.length, den.length);
        const rows = [];
        for (let i = 0; i < n; i++) {
          const tt = typeof times[i] === 'string' && times[i].includes('T') ? fmtHM(times[i], tzChoice) : String(times[i] ?? '');
          const s = Number(spd[i]);
          const d = Number(den[i]);
          rows.push([tt, fmtNum(s, 0), fmtNum(d, 2)]);
        }
        setTableRows(tbody, rows);
      }
    } catch (_) {}
  }

  function updateKpAccessibility(kp, tz) {
    try {
      const sumEl = document.getElementById('kp-summary');
      const tbody = document.getElementById('kp-table-body');
      if (sumEl && kp && Array.isArray(kp.values)) {
        // Find last finite
        let idx = -1;
        for (let i = kp.values.length - 1; i >= 0; i--) { const v = Number(kp.values[i]); if (Number.isFinite(v)) { idx = i; break; } }
        const val = idx >= 0 ? Number(kp.values[idx]) : NaN;
        const label = Array.isArray(kp.labels) && idx >= 0 ? String(kp.labels[idx]) : '';
        sumEl.textContent = `Latest Kp ${fmtNum(val, 0)}${label ? ` at ${label}` : ''}.`;
      }
      if (tbody && kp) {
        const labels = Array.isArray(kp.labels) ? kp.labels : [];
        const values = Array.isArray(kp.values) ? kp.values : [];
        const n = Math.min(labels.length, values.length);
        const rows = [];
        for (let i = 0; i < n; i++) {
          rows.push([String(labels[i] ?? ''), fmtNum(Number(values[i]), 0)]);
        }
        setTableRows(tbody, rows);
      }
    } catch (_) {}
  }

  function updateBxAccessibility(data, tz) {
    try {
      const tzChoice = tz || getSelectedTZ();
      const sumEl = document.getElementById('bx-summary');
      const tbody = document.getElementById('bx-table-body');
      const rows = Array.isArray(data.rows) ? data.rows : [];
      if (sumEl) {
        // last finite
        let idx = -1;
        for (let i = rows.length - 1; i >= 0; i--) { 
          const v = rows[i] && Number(rows[i].bx); 
          if (Number.isFinite(v)) { idx = i; break; } 
        }
        const bxVal = idx >= 0 ? Number(rows[idx].bx) : NaN;
        const bzVal = idx >= 0 && rows[idx].bz !== undefined ? Number(rows[idx].bz) : NaN;
        const timeIso = idx >= 0 ? rows[idx].time : data.updatedAt;
        const t = timeIso ? fmtHM(timeIso, tzChoice) : '--:--';
        const st = (data.station || 'KEV').toUpperCase();
        
        // Update summary to include both Bx and Bz
        if (Number.isFinite(bzVal)) {
          sumEl.textContent = `Latest Bx/Bz at ${t} (${st}): Bx ${fmtNum(bxVal, 1)} nT, Bz ${fmtNum(bzVal, 1)} nT.`;
        } else {
          sumEl.textContent = `Latest Bx at ${t} (${st}): ${fmtNum(bxVal, 1)} nT.`;
        }
      }
      if (tbody) {
        // Update table to include both Bx and Bz columns
        const out = rows.map((r) => [
          fmtHM(r.time, tzChoice), 
          fmtNum(Number(r.bx), 1),
          fmtNum(Number(r.bz), 1)
        ]);
        setTableRows(tbody, out);
      }
    } catch (_) {}
  }

  // Dashboard: fetch API data and render charts
  const $ = (id) => {
    if (!id) return null;
    const key = typeof id === 'string' && id[0] === '#' ? id.slice(1) : id;
    return document.getElementById(key);
  };

  // Timezone selector UI
  function initTZControls() {
    const sel = $('#tz-select');
    const note = $('#tz-note');
    if (!sel) return;
    // Populate
    sel.innerHTML = '';
    const optLocal = document.createElement('option');
    optLocal.value = 'local';
    const localName = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local'; } catch (_) { return 'Local'; } })();
    optLocal.textContent = `Browser local (${localName})`;
    sel.appendChild(optLocal);
    const zones = supportedTimeZones();
    zones.forEach((z) => {
      const o = document.createElement('option');
      o.value = z; o.textContent = z; sel.appendChild(o);
    });
    // Set current
    const curr = getSelectedTZ();
    sel.value = curr;
    if (note) note.textContent = `Showing times in ${curr === 'local' ? localName : curr}`;
    // Handle change
    sel.addEventListener('change', () => {
      const tz = sel.value || 'local';
      setSelectedTZ(tz);
      if (note) note.textContent = `Showing times in ${tz === 'local' ? localName : tz}`;
      rerenderForTZ(tz);
    });
  }

  function rerenderForTZ(tz) {
    const sw = state.data && state.data.solarwind;
    if (sw) {
      // Recompute labels for charts
      const labels = Array.isArray(sw.times) ? sw.times.map((t) => fmtHM(t, tz)) : sw.labels;
      try {
        const windCanvas = document.getElementById('chart-wind');
        const bzMiniCanvas = document.getElementById('chart-bz-mini');
        const vxbzMiniCanvas = document.getElementById('chart-vxbz-mini');
        const densityMiniCanvas = document.getElementById('chart-density-mini');
        const boyleMiniCanvas = document.getElementById('chart-boyle-mini');
        const windCtx = windCanvas ? windCanvas.getContext('2d') : null;
        const bzMiniCtx = bzMiniCanvas ? bzMiniCanvas.getContext('2d') : null;
        const vxbzMiniCtx = vxbzMiniCanvas ? vxbzMiniCanvas.getContext('2d') : null;
        const densityMiniCtx = densityMiniCanvas ? densityMiniCanvas.getContext('2d') : null;
        const boyleMiniCtx = boyleMiniCanvas ? boyleMiniCanvas.getContext('2d') : null;
        ensureWindChart(windCtx, labels, sw.speed, sw.density);
        if (bzMiniCtx) ensureBzMiniChart(bzMiniCtx, labels, sw.bz, sw.bt);
        if (vxbzMiniCtx) {
          const vxbzArr = (Array.isArray(sw.speed) && Array.isArray(sw.bz))
            ? sw.speed.map((s, i) => {
                const ss = Number(s); const bb = Number(sw.bz[i]);
                return (Number.isFinite(ss) && Number.isFinite(bb)) ? Number((ss * bb * 1e-3).toFixed(2)) : null;
              })
            : [];
          ensureVxBzMiniChart(vxbzMiniCtx, labels, vxbzArr);
        }
        if (densityMiniCtx) ensureDensityMiniChart(densityMiniCtx, labels, sw.density);
        if (boyleMiniCtx) {
          const boyleArr = (Array.isArray(sw.speed) && Array.isArray(sw.bz))
            ? sw.speed.map((s, i) => {
                const ss = Number(s); const bb = Number(sw.bz[i]);
                return (Number.isFinite(ss) && Number.isFinite(bb)) ? Number((ss * Math.abs(bb) / 1000).toFixed(2)) : null;
              })
            : [];
          ensureBoyleMiniChart(boyleMiniCtx, labels, boyleArr);
        }
      } catch (_) {}
      // Updated at
      const updEl = $('#updated-at');
      if (updEl) {
        if (sw.updatedAt) {
          updEl.textContent = fmtHM(sw.updatedAt, tz);
          try { updEl.title = fmtDateTime(sw.updatedAt, tz); } catch (_) {}
        }
      }
      // Mini caption
      const capEl = $('#mini-caption-bzbt');
      if (capEl) {
        const time = sw.updatedAt ? fmtHM(sw.updatedAt, tz) : '--:--';
        const sat = (sw.source && sw.source.satellite) ? sw.source.satellite : '—';
        const fmt = (v) => {
          if (v == null || !Number.isFinite(v)) return '--';
          const abs = Math.abs(v);
          const s = abs < 10 ? v.toFixed(1) : Math.round(v).toString();
          return s.replace(/\.0$/, '');
        };
        const bzNow = sw.now && Number.isFinite(sw.now.bz) ? sw.now.bz : null;
        const btNow = sw.now && Number.isFinite(sw.now.bt) ? sw.now.bt : null;
        capEl.innerHTML = `Bz and Bt ${esc(time)} <span class="sat">${esc(sat)}</span> &nbsp; Bz: <strong>${esc(fmt(bzNow))}</strong> nT / Bt: <strong>${esc(fmt(btNow))}</strong> nT`;
      }
      // Update mini captions to match TZ
      updateVxBzCard(sw, tz);
      updateDensityCaption(sw, tz);
      updateBoyleCaption(sw, tz);
      // Update accessibility summaries/tables
      updateWindAccessibility(sw, tz);
    }
    // Re-render Dst mini chart with new TZ if present
    if (state.data && state.data.dst) {
      try {
        const dst = state.data.dst;
        const canvas = document.getElementById('chart-dst-mini');
        const ctx = canvas ? canvas.getContext('2d') : null;
        const choice = tz || getSelectedTZ();
        const tarr = Array.isArray(dst.times) ? dst.times : [];
        const varr = Array.isArray(dst.values) ? dst.values : [];
        const sub = subsetLastHours(tarr, varr, 8);
        const labels = sub.times.map((t) => fmtHM(t, choice));
        ensureDstMiniChart(ctx, labels, sub.values);
        updateDstCaption(dst, choice);
      } catch (_) {}
    }
    // Re-render FMI Bx chart with new TZ if present
    if (state.data && state.data.fmiBx) {
      renderBxChart(state.data.fmiBx, tz);
      updateBxAccessibility(state.data.fmiBx, tz);
    }
    // Re-render Kp table/summary with TZ if useful (labels may be strings already)
    if (state.data && state.data.kp) {
      updateKpAccessibility(state.data.kp, tz);
    }
  }

  const state = {
    charts: { wind: null, kp: null, bzMini: null, vxbzMini: null, densityMini: null, boyleMini: null, bx: null, dstMini: null },
    data: { solarwind: null, kp: null, rx: null, fmiBx: null, dst: null },
  };

  const log = (...args) => {
    try { console.debug('[aurora]', ...args); } catch (_) {}
  };

  // Time & timezone helpers
  const pad2 = (n) => String(n).padStart(2, '0');
  const TZ_KEY = 'aurora.tz'; // 'local' or IANA TZ like 'Europe/Helsinki'
  // Simple HTML escape for safe innerHTML usage
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const getSelectedTZ = () => {
    try { return localStorage.getItem(TZ_KEY) || 'local'; } catch (_) { return 'local'; }
  };
  const setSelectedTZ = (tz) => {
    try { localStorage.setItem(TZ_KEY, tz || 'local'); } catch (_) {}
  };
  const supportedTimeZones = () => {
    try {
      if (typeof Intl.supportedValuesOf === 'function') {
        const vals = Intl.supportedValuesOf('timeZone');
        if (Array.isArray(vals) && vals.length) return vals;
      }
    } catch (_) {}
    return [
      'UTC','Europe/Helsinki','Europe/Stockholm','Europe/Oslo','Europe/Tallinn','Europe/Riga','Europe/Vilnius',
      'Europe/London','America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
      'Asia/Tokyo','Asia/Shanghai','Australia/Sydney'
    ];
  };
  const fmtHM = (iso, tz) => {
    if (!iso) return '--:--';
    const d = new Date(iso);
    const choice = tz || getSelectedTZ();
    if (choice === 'local') return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    try {
      return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: choice }).format(d);
    } catch (_) {
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    }
  };
  const fmtDateTime = (iso, tz) => {
    if (!iso) return '';
    const d = new Date(iso);
    const choice = tz || getSelectedTZ();
    const opts = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };
    try {
      return choice === 'local' ? d.toLocaleString(undefined, opts) : new Intl.DateTimeFormat(undefined, { ...opts, timeZone: choice }).format(d);
    } catch (_) { return d.toString(); }
  };

  async function fetchJson(url) {
    if (typeof window.fetch === 'function') {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        log('fetch fail', url, res.status);
        throw new Error(`HTTP ${res.status}`);
      }
      log('fetch ok', url);
      return res.json();
    }
    // Fallback for older browsers without fetch
    return new Promise((resolve, reject) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'text';
        xhr.onreadystatechange = function () {
          if (xhr.readyState !== 4) return;
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText)); }
            catch (e) { reject(e); }
          } else {
            log('xhr fail', url, xhr.status);
            reject(new Error('HTTP ' + xhr.status));
          }
        };
        xhr.onerror = function () { log('xhr error', url); reject(new Error('Network error')); };
        xhr.send();
      } catch (e) { reject(e); }
    });
  }

  function lastFinite(arr) {
    if (!Array.isArray(arr)) return null;
    for (let i = arr.length - 1; i >= 0; i--) {
      const v = Number(arr[i]);
      if (Number.isFinite(v)) return v;
    }
    return null;
  }

  function asFiniteNumber(v) {
    const n = typeof v === 'number' ? v : (v == null ? NaN : Number(v));
    return Number.isFinite(n) ? n : null;
  }

  // Return times/values filtered to only include the last `hours` hours relative to the last FINITE value's timestamp
  function subsetLastHours(times, values, hours) {
    if (!Array.isArray(times) || !Array.isArray(values) || times.length === 0) {
      return { times: times || [], values: values || [] };
    }
    // Anchor window to last finite value to avoid future placeholder hours
    let endIdx = -1;
    for (let i = Math.min(times.length, values.length) - 1; i >= 0; i--) {
      const v = Number(values[i]);
      if (Number.isFinite(v)) { endIdx = i; break; }
    }
    if (endIdx < 0) endIdx = Math.min(times.length, values.length) - 1;
    const endTs = times[endIdx];
    const endMs = Date.parse(endTs) || Date.now();
    const cutoff = endMs - (hours * 60 * 60 * 1000);
    const outT = [];
    const outV = [];
    for (let i = 0; i <= endIdx; i++) {
      const t = times[i];
      const ms = Date.parse(t);
      if (Number.isFinite(ms) && ms >= cutoff) {
        outT.push(t);
        outV.push(values[i]);
      }
    }
    // Fallback: if nothing matched (e.g., parse failure), just return last 8 points ending at endIdx
    if (outT.length === 0) {
      const start = Math.max(0, endIdx - 7);
      return { times: times.slice(start, endIdx + 1), values: values.slice(start, endIdx + 1) };
    }
    return { times: outT, values: outV };
  }

  async function loadDst() {
    try {
      const data = await fetchJson('/api/dst').catch(() => null);
      if (!data) return;
      state.data.dst = data;
      const canvas = document.getElementById('chart-dst-mini');
      const ctx = canvas ? canvas.getContext('2d') : null;
      const tz = getSelectedTZ();
      const times = Array.isArray(data.times) ? data.times : [];
      const values = Array.isArray(data.values) ? data.values : [];
      const sub = subsetLastHours(times, values, 8);
      const labels = sub.times.map((t) => fmtHM(t, tz));
      ensureDstMiniChart(ctx, labels, sub.values);
      updateDstCaption(data, tz);
    } catch (e) { log('loadDst error', e); }
  }

  function updateVxBzCard(sw, tz) {
    try {
      const capEl = $('#mini-caption-vxbz');
      const marker = $('#vxbz-marker');
      if (!sw) return;
      // Resolve latest finite values similar to metrics
      const now = sw.now || {};
      const fbz = asFiniteNumber(now.bz) ?? lastFinite(sw.bz);
      const fs  = asFiniteNumber(now.speed) ?? lastFinite(sw.speed);
      let mvm = null;
      if (Number.isFinite(fbz) && Number.isFinite(fs)) {
        // mV/m: km/s * nT * 1e-3
        mvm = fs * fbz * 1e-3;
      }
      const fmt = (v) => {
        if (!Number.isFinite(v)) return '--';
        const s = v.toFixed(1);
        return s.replace(/^-0\.0$/, '0.0');
      };
      // Optional: marker support if present
      if (marker) {
        const clamped = Number.isFinite(mvm) ? Math.max(-10, Math.min(10, mvm)) : 0;
        const leftPct = ((clamped + 10) / 20) * 100;
        marker.style.left = leftPct + '%';
        marker.classList.toggle('neg', Number.isFinite(mvm) && mvm < 0);
        marker.classList.toggle('pos', Number.isFinite(mvm) && mvm >= 0);
      }
      // Caption line similar to Bz mini caption
      if (capEl) {
        const tzChoice = tz || getSelectedTZ();
        const time = sw.updatedAt ? fmtHM(sw.updatedAt, tzChoice) : '--:--';
        const sat = (sw.source && sw.source.satellite) ? sw.source.satellite : '—';
        capEl.innerHTML = `V×Bz ${esc(time)} <span class="sat">${esc(sat)}</span> &nbsp; V×Bz: <strong>${esc(fmt(mvm))}</strong> mV/m`;
      }
    } catch (_) {}
  }

  function updateDensityCaption(sw, tz) {
    try {
      const cap = document.getElementById('mini-caption-density');
      if (!cap || !sw) return;
      const tzChoice = tz || getSelectedTZ();
      const time = sw.updatedAt ? fmtHM(sw.updatedAt, tzChoice) : '--:--';
      const sat = (sw.source && sw.source.satellite) ? sw.source.satellite : '—';
      const d = asFiniteNumber(sw.now && sw.now.density) ?? lastFinite(sw.density);
      const val = Number.isFinite(d) ? d.toFixed(2) : '--';
      cap.innerHTML = `Density ${esc(time)} <span class="sat">${esc(sat)}</span> &nbsp; Density: <strong>${esc(val)}</strong> p/cc`;
    } catch (_) {}
  }

  function updateBoyleCaption(sw, tz) {
    try {
      const cap = document.getElementById('mini-caption-boyle');
      if (!cap || !sw) return;
      const tzChoice = tz || getSelectedTZ();
      const time = sw.updatedAt ? fmtHM(sw.updatedAt, tzChoice) : '--:--';
      const sat = (sw.source && sw.source.satellite) ? sw.source.satellite : '—';
      const fbz = asFiniteNumber(sw.now && sw.now.bz) ?? lastFinite(sw.bz);
      const fs  = asFiniteNumber(sw.now && sw.now.speed) ?? lastFinite(sw.speed);
      const boyle = (Number.isFinite(fs) && Number.isFinite(fbz)) ? Number((fs * Math.abs(fbz) / 1000).toFixed(2)) : null;
      const val = Number.isFinite(boyle) ? String(boyle) : '--';
      cap.innerHTML = `Boyle ${esc(time)} <span class="sat">${esc(sat)}</span> &nbsp; Boyle: <strong>${esc(val)}</strong>`;
    } catch (_) {}
  }

  function computeDerivedFrom(speed, bz) {
    if (!Number.isFinite(speed) || !Number.isFinite(bz)) return { boyle: null, vxbz: null };
    const boyle = Number((speed * Math.abs(bz) / 1000).toFixed(2));
    const vxbz = Number((speed * bz).toFixed(1));
    return { boyle, vxbz };
  }

  function updateMetrics(sw, kp, rx) {
    if (sw) {
      const { bz, bt, speed, density } = (sw.now || {});
      // Resolve with strict finite checks then array fallbacks
      const fbz = asFiniteNumber(bz) ?? lastFinite(sw.bz);
      const fbt = asFiniteNumber(bt) ?? lastFinite(sw.bt);
      const fs  = asFiniteNumber(speed) ?? lastFinite(sw.speed);
      const fd  = asFiniteNumber(density) ?? lastFinite(sw.density);
      log('metrics resolved', { bz: fbz, bt: fbt, speed: fs, density: fd });
      if ($('#metric-bz')) $('#metric-bz').textContent = Number.isFinite(fbz) ? fbz.toFixed(1) : '--';
      if ($('#metric-bt')) $('#metric-bt').textContent = Number.isFinite(fbt) ? fbt.toFixed(1) : '--';
      if ($('#metric-speed')) $('#metric-speed').textContent = Number.isFinite(fs) ? fs.toFixed(0) : '--';
      if ($('#metric-density')) $('#metric-density').textContent = Number.isFinite(fd) ? fd.toFixed(2) : '--';
      const d = computeDerivedFrom(fs, fbz);
      if ($('#metric-boyle')) $('#metric-boyle').textContent = Number.isFinite(d.boyle) ? String(d.boyle) : '--';
      if ($('#metric-vxbz')) $('#metric-vxbz').textContent = Number.isFinite(d.vxbz) ? String(d.vxbz) : '--';
    }

    if (rx && rx.now && $('#rx-badge')) {
      const badge = $('#rx-badge');
      badge.textContent = rx.now;
      badge.classList.remove('low', 'moderate', 'high');
      badge.classList.add(rx.now);
    }
  }

  function ensureWindChart(ctx, labels, speed, density) {
    if (!ctx || !window.Chart) return null;
    const rootStyle = getComputedStyle(document.documentElement);
    const muted = rootStyle.getPropertyValue('--muted').trim() || '#9aa4b2';
    if (state.charts.wind) {
      state.charts.wind.data.labels = labels;
      state.charts.wind.data.datasets[0].data = speed;
      state.charts.wind.data.datasets[1].data = density;
      state.charts.wind.update();
      return state.charts.wind;
    }
    state.charts.wind = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Speed (km/s)', data: speed, yAxisID: 'y1', borderColor: '#7c5cff', backgroundColor: 'rgba(124,92,255,.25)', tension: .25, fill: true, pointRadius: 0 },
          { label: 'Density (p/cc)', data: density, yAxisID: 'y2', borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.15)', tension: .25, fill: true, pointRadius: 0 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: muted } },
          tooltip: { mode: 'index', intersect: false },
        },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { ticks: { color: muted }, grid: { color: 'rgba(255,255,255,0.06)' } },
          y1: { type: 'linear', position: 'left', ticks: { color: '#7c5cff' }, grid: { color: 'rgba(255,255,255,0.06)' } },
          y2: { type: 'linear', position: 'right', ticks: { color: '#22c55e' }, grid: { drawOnChartArea: false } },
        },
      },
    });
    return state.charts.wind;
  }

  function ensureKpChart(ctx, labels, values) {
    if (!ctx || !window.Chart) return null;
    const rootStyle = getComputedStyle(document.documentElement);
    const muted = rootStyle.getPropertyValue('--muted').trim() || '#9aa4b2';
    if (state.charts.kp) {
      state.charts.kp.data.labels = labels;
      state.charts.kp.data.datasets[0].data = values;
      state.charts.kp.update();
      return state.charts.kp;
    }
    state.charts.kp = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Kp',
            data: values,
            backgroundColor: values.map((v) => (v >= 5 ? 'rgba(239,68,68,.7)' : v >= 4 ? 'rgba(234,179,8,.7)' : 'rgba(34,197,94,.7)')),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: muted }, grid: { display: false } },
          y: { min: 0, max: 9, ticks: { stepSize: 1, color: muted }, grid: { color: 'rgba(255,255,255,0.06)' } },
        },
      },
    });
    return state.charts.kp;
  }

  function ensureBzMiniChart(ctx, labels, bz, bt) {
    if (!ctx || !window.Chart) return null;
    const rootStyle = getComputedStyle(document.documentElement);
    const muted = rootStyle.getPropertyValue('--muted').trim() || '#9aa4b2';
    if (state.charts.bzMini) {
      state.charts.bzMini.data.labels = labels;
      state.charts.bzMini.data.datasets[0].data = bz;
      if (state.charts.bzMini.data.datasets[1]) {
        state.charts.bzMini.data.datasets[1].data = bt;
      }
      state.charts.bzMini.update();
      return state.charts.bzMini;
    }
    const zeroLine = {
      id: 'zeroLine',
      afterDraw(chart) {
        const y = chart.scales && chart.scales.y ? chart.scales.y : null;
        if (!y) return;
        const yZero = y.getPixelForValue(0);
        const { left, right } = chart.chartArea;
        const ctx2 = chart.ctx;
        ctx2.save();
        ctx2.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx2.lineWidth = 1;
        ctx2.beginPath();
        ctx2.moveTo(left, yZero);
        ctx2.lineTo(right, yZero);
        ctx2.stroke();
        ctx2.restore();
      },
    };
    state.charts.bzMini = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Bz (nT)', data: bz, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.15)', tension: .25, fill: true, pointRadius: 0 },
          { label: 'Bt (nT)', data: bt, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.12)', tension: .25, fill: false, pointRadius: 0 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { display: true, color: muted, autoSkip: true, maxTicksLimit: 6 }, grid: { display: false } },
          y: { ticks: { display: true, color: muted, maxTicksLimit: 5 }, grid: { color: 'rgba(255,255,255,0.06)' } },
        },
      },
      plugins: [zeroLine],
    });
    return state.charts.bzMini;
  }

  function ensureVxBzMiniChart(ctx, labels, vxbz) {
    if (!ctx || !window.Chart) return null;
    const rootStyle = getComputedStyle(document.documentElement);
    const muted = rootStyle.getPropertyValue('--muted').trim() || '#9aa4b2';
    if (state.charts.vxbzMini) {
      state.charts.vxbzMini.data.labels = labels;
      state.charts.vxbzMini.data.datasets[0].data = vxbz;
      state.charts.vxbzMini.update();
      return state.charts.vxbzMini;
    }
    const zeroLine = {
      id: 'zeroLineVxBz',
      afterDraw(chart) {
        const y = chart.scales && chart.scales.y ? chart.scales.y : null;
        if (!y) return;
        const yZero = y.getPixelForValue(0);
        const { left, right } = chart.chartArea;
        const ctx2 = chart.ctx;
        ctx2.save();
        ctx2.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx2.lineWidth = 1;
        ctx2.beginPath();
        ctx2.moveTo(left, yZero);
        ctx2.lineTo(right, yZero);
        ctx2.stroke();
        ctx2.restore();
      },
    };
    state.charts.vxbzMini = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'V×Bz (mV/m)', data: vxbz, borderColor: '#7c5cff', backgroundColor: 'rgba(124,92,255,.20)', tension: .25, fill: true, pointRadius: 0 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { display: true, color: muted, autoSkip: true, maxTicksLimit: 6 }, grid: { display: false } },
          y: { ticks: { display: true, color: muted, maxTicksLimit: 5 }, grid: { color: 'rgba(255,255,255,0.06)' } },
        },
      },
      plugins: [zeroLine],
    });
    return state.charts.vxbzMini;
  }

  function ensureDensityMiniChart(ctx, labels, density) {
    if (!ctx || !window.Chart) return null;
    const rootStyle = getComputedStyle(document.documentElement);
    const muted = rootStyle.getPropertyValue('--muted').trim() || '#9aa4b2';
    if (state.charts.densityMini) {
      state.charts.densityMini.data.labels = labels;
      state.charts.densityMini.data.datasets[0].data = density;
      state.charts.densityMini.update();
      return state.charts.densityMini;
    }
    state.charts.densityMini = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Density (p/cc)', data: density, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.15)', tension: .25, fill: true, pointRadius: 0 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { display: true, color: muted, autoSkip: true, maxTicksLimit: 6 }, grid: { display: false } },
          y: { ticks: { display: true, color: muted, maxTicksLimit: 5 }, grid: { color: 'rgba(255,255,255,0.06)' } },
        },
      },
    });
    return state.charts.densityMini;
  }

  function ensureBoyleMiniChart(ctx, labels, boyle) {
    if (!ctx || !window.Chart) return null;
    const rootStyle = getComputedStyle(document.documentElement);
    const muted = rootStyle.getPropertyValue('--muted').trim() || '#9aa4b2';
    if (state.charts.boyleMini) {
      state.charts.boyleMini.data.labels = labels;
      state.charts.boyleMini.data.datasets[0].data = boyle;
      state.charts.boyleMini.update();
      return state.charts.boyleMini;
    }
    state.charts.boyleMini = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Boyle index', data: boyle, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,.18)', tension: .25, fill: true, pointRadius: 0 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { display: true, color: muted, autoSkip: true, maxTicksLimit: 6 }, grid: { display: false } },
          y: { ticks: { display: true, color: muted, maxTicksLimit: 5 }, grid: { color: 'rgba(255,255,255,0.06)' } },
        },
      },
    });
    return state.charts.boyleMini;
  }

  function ensureDstMiniChart(ctx, labels, values) {
    if (!ctx || !window.Chart) return null;
    const rootStyle = getComputedStyle(document.documentElement);
    const muted = rootStyle.getPropertyValue('--muted').trim() || '#9aa4b2';
    // Resolve styles from last finite value
    const dstLineStyles = (vals) => {
      let last = null;
      if (Array.isArray(vals)) {
        for (let i = vals.length - 1; i >= 0; i--) {
          const v = Number(vals[i]);
          if (Number.isFinite(v)) { last = v; break; }
        }
      }
      let border = '#22c55e'; // green
      let bg = 'rgba(34,197,94,.18)';
      if (Number.isFinite(last) && last < 0) {
        if (last <= -101) { border = '#ef4444'; bg = 'rgba(239,68,68,.18)'; } // red
        else { border = '#f59e0b'; bg = 'rgba(245,158,11,.18)'; } // yellow
      }
      return { border, bg };
    };
    const styles = dstLineStyles(values);
    if (state.charts.dstMini) {
      state.charts.dstMini.data.labels = labels;
      state.charts.dstMini.data.datasets[0].data = values;
      state.charts.dstMini.data.datasets[0].borderColor = styles.border;
      state.charts.dstMini.data.datasets[0].backgroundColor = styles.bg;
      state.charts.dstMini.update();
      return state.charts.dstMini;
    }
    const zeroLine = {
      id: 'zeroLineDst',
      afterDraw(chart) {
        const y = chart.scales && chart.scales.y ? chart.scales.y : null;
        if (!y) return;
        const yZero = y.getPixelForValue(0);
        const { left, right } = chart.chartArea;
        const ctx2 = chart.ctx;
        ctx2.save();
        ctx2.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx2.lineWidth = 1;
        ctx2.beginPath();
        ctx2.moveTo(left, yZero);
        ctx2.lineTo(right, yZero);
        ctx2.stroke();
        ctx2.restore();
      },
    };
    state.charts.dstMini = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Dst (nT)', data: values, borderColor: styles.border, backgroundColor: styles.bg, tension: .25, fill: true, pointRadius: 0 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { display: true, color: muted, autoSkip: true, maxTicksLimit: 6 }, grid: { display: false } },
          y: { min: -50, max: 50, ticks: { display: true, color: muted, maxTicksLimit: 5 }, grid: { color: 'rgba(255,255,255,0.06)' } },
        },
      },
      plugins: [zeroLine],
    });
    return state.charts.dstMini;
  }

  function classifyDst(v) {
    if (!Number.isFinite(v)) return { level: 'low', label: 'unknown' };
    // Ranges per plan.txt:
    // 0..-30 Quiet to weak disturbance
    // -30..-50 Minor storm
    // -50..-100 Moderate storm
    // -100..-250 Intense storm
    // < -250 Severe storm
    if (v <= -250) return { level: 'high', label: 'severe storm' };
    if (v <= -100) return { level: 'high', label: 'intense storm' };
    if (v <= -50) return { level: 'moderate', label: 'moderate storm' };
    if (v <= -30) return { level: 'moderate', label: 'minor storm' };
    return { level: 'low', label: 'quiet' };
  }

  function updateDstCaption(dst, tz) {
    try {
      const cap = document.getElementById('mini-caption-dst');
      if (!cap || !dst) return;
      const tzChoice = tz || getSelectedTZ();
      const times = Array.isArray(dst.times) ? dst.times : [];
      const values = Array.isArray(dst.values) ? dst.values : [];
      let idx = -1;
      for (let i = Math.min(times.length, values.length) - 1; i >= 0; i--) {
        const v = Number(values[i]);
        if (Number.isFinite(v)) { idx = i; break; }
      }
      const lastVal = idx >= 0 ? Number(values[idx]) : (Number.isFinite(dst.now) ? Number(dst.now) : NaN);
      const timeIso = idx >= 0 ? times[idx] : (dst.updatedAt || '');
      const time = timeIso ? fmtHM(timeIso, tzChoice) : '--:--';
      const valStr = Number.isFinite(lastVal) ? String(lastVal) : '--';
      const cls = classifyDst(lastVal);
      cap.innerHTML = `Dst: <strong>${esc(valStr)}</strong> nT at ${esc(time)} · <span class="dst-badge ${esc(cls.level)}">${esc(cls.label)}</span> · Kyoto WDC`;
    } catch (_) {}
  }

  // --- FMI Bx: frontend helpers ---
  // Friendly station name map (extend as needed)
  const FMI_STATION_NAMES = {
    KEV: 'Kevo',
    MAS: 'Masi',
    KIL: 'Kilpisjärvi',
    IVA: 'Ivalo',
    MUO: 'Muonio',
    PEL: 'Pello',
    RAN: 'Ranua',
    OUJ: 'Oulujärvi',
    MEK: 'Mekrijärvi',
    HAN: 'Hankasalmi',
    NUR: 'Nurmijärvi Geophysical Observatory',
    TAR: 'Tartu',
    // Not in default station list served by our API but present on IMAGE pages
    SOD: 'Sodankylä',
  };
  // --- Updated: Dynamic y-axis scaling for Bx/Bz chart ---
  // --- Dual y-axis: Bx left (y1), Bz right (y2) ---
  function ensureBxChart(ctx, labels, bx, bz, bxMin, bxMax, bzMin, bzMax) {
    if (!ctx || !window.Chart) return null;
    const rootStyle = getComputedStyle(document.documentElement);
    const muted = rootStyle.getPropertyValue('--muted').trim() || '#9aa4b2';
    const hasBz = Array.isArray(bz) && bz.length > 0;
    if (state.charts.bx) {
      state.charts.bx.data.labels = labels;
      state.charts.bx.data.datasets[0].data = bx;
      if (hasBz) {
        if (state.charts.bx.data.datasets.length > 1) {
          state.charts.bx.data.datasets[1].data = bz;
        } else {
          state.charts.bx.data.datasets.push({ 
            label: 'Bz (nT)', 
            data: bz, 
            borderColor: '#ef4444', 
            backgroundColor: 'rgba(239,68,68,.15)', 
            tension: .25, 
            fill: true, 
            pointRadius: 0,
            yAxisID: 'y2'
          });
        }
      } else if (state.charts.bx.data.datasets.length > 1) {
        state.charts.bx.data.datasets.splice(1, 1);
      }
      // Update both y-axes scaling
      if (state.charts.bx.options && state.charts.bx.options.scales) {
        if (state.charts.bx.options.scales.y1) {
          state.charts.bx.options.scales.y1.min = bxMin;
          state.charts.bx.options.scales.y1.max = bxMax;
        }
        if (state.charts.bx.options.scales.y2) {
          state.charts.bx.options.scales.y2.min = bzMin;
          state.charts.bx.options.scales.y2.max = bzMax;
        }
      }
      state.charts.bx.update();
      return state.charts.bx;
    }
    const zeroLine = {
      id: 'zeroLineBx',
      afterDraw(chart) {
        const y = chart.scales && chart.scales.y1 ? chart.scales.y1 : null;
        if (!y) return;
        const yZero = y.getPixelForValue(0);
        const { left, right } = chart.chartArea;
        const ctx2 = chart.ctx;
        ctx2.save();
        ctx2.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx2.lineWidth = 1;
        ctx2.beginPath();
        ctx2.moveTo(left, yZero);
        ctx2.lineTo(right, yZero);
        ctx2.stroke();
        ctx2.restore();
      },
    };
    const datasets = [
      { label: 'Bx (nT)', data: bx, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.15)', tension: .25, fill: true, pointRadius: 0, yAxisID: 'y1' }
    ];
    if (hasBz) {
      datasets.push({ 
        label: 'Bz (nT)', 
        data: bz, 
        borderColor: '#ef4444', 
        backgroundColor: 'rgba(239,68,68,.15)', 
        tension: .25, 
        fill: true, 
        pointRadius: 0,
        yAxisID: 'y2'
      });
    }
    state.charts.bx = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { 
          legend: { 
            display: hasBz, // Only show legend if we have both Bx and Bz
            labels: { color: muted }
          } 
        },
        scales: {
          x: { ticks: { display: true, color: muted, autoSkip: true, maxTicksLimit: 6 }, grid: { display: false } },
          y1: {
            type: 'linear',
            position: 'left',
            min: bxMin,
            max: bxMax,
            title: { display: true, text: 'Bx (nT)', color: '#3b82f6' },
            ticks: { display: true, color: '#3b82f6', maxTicksLimit: 5 },
            grid: { color: 'rgba(59,130,246,0.08)' }
          },
          y2: {
            type: 'linear',
            position: 'right',
            min: bzMin,
            max: bzMax,
            title: { display: true, text: 'Bz (nT)', color: '#ef4444' },
            ticks: { display: true, color: '#ef4444', maxTicksLimit: 5 },
            grid: { drawOnChartArea: false }
          }
        },
      },
      plugins: [zeroLine],
    });
    return state.charts.bx;
  }
  function populateBxStationOptions(stations, selected) {
    const sel = $('#bx-station');
    if (!sel || !Array.isArray(stations) || !stations.length) return;
    // Only populate once to avoid duplicating options on periodic refresh
    if (sel.options.length <= 1) {
      sel.innerHTML = stations.map((s) => `<option value="${s}">${s}</option>`).join('');
    }
    if (selected) sel.value = selected;
    if (!sel.dataset.bxBound) {
      sel.addEventListener('change', () => {
        const st = sel.value || 'KEV';
        loadBx(st);
      });
      sel.dataset.bxBound = '1';
    }
    // Bind range selector once
    const rangeSel = $('#bx-range');
    if (rangeSel && !rangeSel.dataset.bxRangeBound) {
      rangeSel.addEventListener('change', () => {
        loadBx();
      });
      rangeSel.dataset.bxRangeBound = '1';
    }
  }

  // --- Updated: Pass dynamic min/max to chart ---
  // --- Dual y-axis: Pass separate min/max for Bx and Bz ---
  function renderBxChart(data, tz) {
    try {
      const cap = $('#bx-caption');
      const canvas = $('#chart-bx');
      const ctx = canvas ? canvas.getContext('2d') : null;
      if (!ctx || !data) return;
      const rows = Array.isArray(data.rows) ? data.rows : [];
      const choice = tz || getSelectedTZ();
      const labels = rows.map((r) => r && r.time ? fmtHM(r.time, choice) : '--:--');
      const bxValues = rows.map((r) => {
        const bxv = r ? Number(r.bx) : NaN;
        return Number.isFinite(bxv) ? Number(bxv.toFixed(1)) : null;
      });
      const bzValues = rows.map((r) => {
        const bzv = r ? Number(r.bz) : NaN;
        return Number.isFinite(bzv) ? Number(bzv.toFixed(1)) : null;
      });
      // Compute min/max for both axes, margin of 5
      let bxMin = typeof data.minX === 'number' ? Math.floor(data.minX - 5) : undefined;
      let bxMax = typeof data.maxX === 'number' ? Math.ceil(data.maxX + 5) : undefined;
      let bzMin = typeof data.minZ === 'number' ? Math.floor(data.minZ - 5) : undefined;
      let bzMax = typeof data.maxZ === 'number' ? Math.ceil(data.maxZ + 5) : undefined;
      ensureBxChart(ctx, labels, bxValues, bzValues, bxMin, bxMax, bzMin, bzMax);
      if (cap) {
        const t = data.updatedAt ? fmtHM(data.updatedAt, choice) : '--:--';
        const st = (data.station || 'KEV').toUpperCase();
        const fullname = FMI_STATION_NAMES[st] ? ` - ${FMI_STATION_NAMES[st]}` : '';
        cap.textContent = `Updated at ${t} · FMI IMAGE (${st})${fullname}`;
      }
    } catch (_) {}
  }

  // --- Updated: Load FMI Bx/Bz from new real-time text endpoint ---
  async function loadBx(station) {
    try {
      const sel = $('#bx-station');
      const st = (station || (sel && sel.value) || 'KEV').toUpperCase();
      // No range for textdata endpoint, always returns 24h
      const data = await fetchJson(`/api/fmi/textdata?station=${encodeURIComponent(st)}`).catch(() => null);
      if (!data) return;
      // Adapt to new structure
      const rows = (data.times || []).map((t, i) => ({
        time: t,
        bx: data.bx ? data.bx[i] : null,
        bz: data.bz ? data.bz[i] : null,
      }));
      state.data.fmiBx = {
        station: data.station,
        rows,
        updatedAt: rows.length ? rows[rows.length-1].time : null,
        minX: data.minX, maxX: data.maxX, minZ: data.minZ, maxZ: data.maxZ
      };
      populateBxStationOptions([data.station], data.station);
      renderBxChart(state.data.fmiBx, getSelectedTZ());
      updateBxAccessibility(state.data.fmiBx, getSelectedTZ());
    } catch (e) { log('loadBx error', e); }
  }

  async function loadDashboard() {
    try {
      const [sw, kp, rx] = await Promise.all([
        fetchJson('/api/solarwind').catch(() => null),
        fetchJson('/api/kp').catch(() => null),
        fetchJson('/api/rx').catch(() => null),
      ]);
      log('data', { sw, kp, rx });
      if (sw && sw.now) log('now', sw.now);
      state.data = { solarwind: sw, kp, rx };
      // Set source badge if available
      const srcEl = document.getElementById('source-sat');
      if (srcEl) {
        if (sw && sw.source && (sw.source.satellite || sw.source.provider)) {
          const sat = sw.source.satellite || '—';
          const prov = sw.source.provider || '';
          srcEl.textContent = prov ? `${sat} · ${prov}` : sat;
        } else {
          srcEl.textContent = '--';
        }
      }
      // Set updated-at time if available
      const updEl = document.getElementById('updated-at');
      if (updEl) {
        const tz = getSelectedTZ();
        if (sw && sw.updatedAt) {
          updEl.textContent = fmtHM(sw.updatedAt, tz);
          try { updEl.title = fmtDateTime(sw.updatedAt, tz); } catch (_) {}
        } else {
          updEl.textContent = '--:--';
          updEl.removeAttribute('title');
        }
      }
      updateMetrics(sw, kp, rx);
      var windCanvas = document.getElementById('chart-wind');
      var kpCanvas = document.getElementById('chart-kp');
      var windCtx = windCanvas ? windCanvas.getContext('2d') : null;
      var kpCtx = kpCanvas ? kpCanvas.getContext('2d') : null;
      var bzMiniCanvas = document.getElementById('chart-bz-mini');
      var bzMiniCtx = bzMiniCanvas ? bzMiniCanvas.getContext('2d') : null;
      var vxbzMiniCanvas = document.getElementById('chart-vxbz-mini');
      var vxbzMiniCtx = vxbzMiniCanvas ? vxbzMiniCanvas.getContext('2d') : null;
      var densityMiniCanvas = document.getElementById('chart-density-mini');
      var densityMiniCtx = densityMiniCanvas ? densityMiniCanvas.getContext('2d') : null;
      var boyleMiniCanvas = document.getElementById('chart-boyle-mini');
      var boyleMiniCtx = boyleMiniCanvas ? boyleMiniCanvas.getContext('2d') : null;
      if (!window.Chart) log('Chart.js missing');
      if (sw) {
        const tz = getSelectedTZ();
        const labels = Array.isArray(sw.times) ? sw.times.map((t) => fmtHM(t, tz)) : sw.labels;
        ensureWindChart(windCtx, labels, sw.speed, sw.density);
        if (bzMiniCtx) ensureBzMiniChart(bzMiniCtx, labels, sw.bz, sw.bt);
        if (vxbzMiniCtx) {
          const vxbzArr = (Array.isArray(sw.speed) && Array.isArray(sw.bz))
            ? sw.speed.map((s, i) => {
                const ss = Number(s); const bb = Number(sw.bz[i]);
                return (Number.isFinite(ss) && Number.isFinite(bb)) ? Number((ss * bb * 1e-3).toFixed(2)) : null;
              })
            : [];
          ensureVxBzMiniChart(vxbzMiniCtx, labels, vxbzArr);
        }
        if (densityMiniCtx) ensureDensityMiniChart(densityMiniCtx, labels, sw.density);
        if (boyleMiniCtx) {
          const boyleArr = (Array.isArray(sw.speed) && Array.isArray(sw.bz))
            ? sw.speed.map((s, i) => {
                const ss = Number(s); const bb = Number(sw.bz[i]);
                return (Number.isFinite(ss) && Number.isFinite(bb)) ? Number((ss * Math.abs(bb) / 1000).toFixed(2)) : null;
              })
            : [];
          ensureBoyleMiniChart(boyleMiniCtx, labels, boyleArr);
        }
        updateDensityCaption(sw, tz);
        updateBoyleCaption(sw, tz);
        // Populate wind accessibility features
        updateWindAccessibility(sw, tz);
        // Update mini caption with aligned time and now values (match Updated at)
        const capEl = document.getElementById('mini-caption-bzbt');
        if (capEl && sw) {
          const time = sw.updatedAt ? fmtHM(sw.updatedAt, tz) : '--:--';
          const sat = (sw.source && sw.source.satellite) ? sw.source.satellite : '—';
          const fmt = (v) => {
            if (v == null || !Number.isFinite(v)) return '--';
            const abs = Math.abs(v);
            const s = abs < 10 ? v.toFixed(1) : Math.round(v).toString();
            return s.replace(/\.0$/, '');
          };
          const bzNow = sw.now && Number.isFinite(sw.now.bz) ? sw.now.bz : null;
          const btNow = sw.now && Number.isFinite(sw.now.bt) ? sw.now.bt : null;
          capEl.innerHTML = `Bz and Bt ${esc(time)} <span class="sat">${esc(sat)}</span> &nbsp; Bz: <strong>${esc(fmt(bzNow))}</strong> nT / Bt: <strong>${esc(fmt(btNow))}</strong> nT`;
        }
        // Update VxBz card
        updateVxBzCard(sw, tz);
        log('wind chart updated');
      } else {
        log('no solarwind data');
      }
      if (kp) {
        ensureKpChart(kpCtx, kp.labels, kp.values);
        log('kp chart updated');
        updateKpAccessibility(kp, getSelectedTZ());
      } else {
        log('no kp data');
      }
      // Load/update FMI Bx after core dashboard
      await loadBx();
    } catch (e) {
      log('loadDashboard error', e);
      // keep placeholders if failure
    }
  }

  // init timezone controls, then initial load + periodic refresh (2 min)
  initTZControls();
  loadDashboard();
  setInterval(loadDashboard, 2 * 60 * 1000);
  // Also auto-refresh Bx chart every 2 minutes
  setInterval(loadBx, 2 * 60 * 1000);

  // Dst initial load + hourly refresh
  loadDst();
  setInterval(loadDst, 60 * 60 * 1000);

  // Initialize FMI radar map (Leaflet)
  function initRadarMap() {
    try {
      const el = document.getElementById('radar-map');
      if (!el || !window.L) return;
      const overlay = el.querySelector('.map-overlay');
      const map = L.map(el, { zoomControl: true, attributionControl: true });
      // Segmented toggle controls (optional in DOM)
      const toggleWrap = document.getElementById('radar-layer-toggle');
      const radioDbzv = document.getElementById('radar-layer-dbzv');
      const radioRr = document.getElementById('radar-layer-rr');
      const LS_KEY = 'aurora.radar.layer';
      let layerVal = 'dbzv';
      try {
        const saved = localStorage.getItem(LS_KEY);
        if (saved === 'rr' || saved === 'dbzv') layerVal = saved;
      } catch (_) {}
      function wmsLayerName(v) {
        switch (v) {
          case 'rr': return 'Radar:suomi_rr_eureffin';
          case 'dbzv': return 'Radar:radar_ppi_fikau_dbzv';
          default: return 'Radar:radar_ppi_fikau_dbzv';
        }
      }
      function layerText(val) { return val === 'rr' ? 'rainfall rate' : 'reflectivity'; }
      function updateAria() {
        try { el.setAttribute('aria-label', `FMI radar ${layerText(layerVal)} over Finland`); } catch (_) {}
      }
      // Sync radios to current value if present
      try {
        if (radioDbzv && radioRr) {
          if (layerVal === 'rr') { radioRr.checked = true; }
          else { radioDbzv.checked = true; }
        }
      } catch (_) {}
      // Finland-centric view
      map.setView([64.9, 26.0], 5);
      // Base map
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);
      // FMI radar WMS via backend proxy
      const wms = L.tileLayer.wms('/api/fmi/radar', {
        layers: wmsLayerName(layerVal),
        styles: '',
        format: 'image/png',
        transparent: true,
        version: '1.1.1',
      }).addTo(map);
      updateAria();
      // tileSize: 256,
      // }).addTo(map);
      // Error handling
      const onErr = () => {
        el.classList.add('error');
        if (overlay) overlay.textContent = 'Radar tiles temporarily unavailable. Showing base map only.';
      };
      wms.on('tileerror', onErr);
      wms.on('load', () => {
        el.classList.remove('error');
      });
      // Periodic refresh to get recent radar frames (cache-busting param)
      setInterval(() => { try { wms.setParams({ t: Date.now() }); } catch (_) {} }, 2 * 60 * 1000);

      // Hook segmented toggle changes
      function applyLayer(next) {
        const nv = next === 'rr' ? 'rr' : 'dbzv';
        layerVal = nv;
        try { wms.setParams({ layers: wmsLayerName(nv), styles: '', t: Date.now() }); } catch (_) {}
        updateAria();
        try { localStorage.setItem(LS_KEY, nv); } catch (_) {}
        // Keep radios in sync
        try {
          if (radioDbzv && radioRr) {
            radioDbzv.checked = nv === 'dbzv';
            radioRr.checked = nv === 'rr';
          }
        } catch (_) {}
      }
      try {
        if (radioDbzv) radioDbzv.addEventListener('change', (e) => { if (e.target && e.target.checked) applyLayer('dbzv'); });
        if (radioRr) radioRr.addEventListener('change', (e) => { if (e.target && e.target.checked) applyLayer('rr'); });
        // Also allow clicking labels to toggle (radios handle this natively)
      } catch (_) {}
    } catch (e) {
      try { console.error('initRadarMap error', e); } catch (_) {}
    }
  }
  initRadarMap();

  // Bind table toggles once DOM is ready (IIFE already running after parse)
  bindToggleOnce('toggle-wind-table', 'wind-table-wrap');
  bindToggleOnce('toggle-kp-table', 'kp-table-wrap');
  bindToggleOnce('toggle-bx-table', 'bx-table-wrap');

  // Solar & Lunar data functionality
  function getMoonPhaseName(phase) {
    // phase is a percentage (0-100)
    if (phase < 0 || phase > 100) return 'Unknown';
    if (phase < 6.25) return 'New Moon';
    if (phase < 18.75) return 'Waxing Crescent';
    if (phase < 31.25) return 'First Quarter';
    if (phase < 43.75) return 'Waxing Gibbous';
    if (phase < 56.25) return 'Full Moon';
    if (phase < 68.75) return 'Waning Gibbous';
    if (phase < 81.25) return 'Last Quarter';
    if (phase < 93.75) return 'Waning Crescent';
    return 'New Moon';
  }

  function formatTime(dateObj) {
    if (!dateObj || !dateObj.date) return '--:--';
    const d = new Date(dateObj.date);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Helsinki' });
  }

  function formatTimeRange(startObj, endObj) {
    const start = formatTime(startObj);
    const end = formatTime(endObj);
    if (start === '--:--' || end === '--:--') return '--:-- to --:--';
    return `${start} to ${end}`;
  }

  const SOLARLUNAR_LOCATIONS = {
  helsinki: { name: 'Helsinki, Finland', lat: 60.1699, lon: 24.9384 },
  lahti: { name: 'Lahti, Finland', lat: 60.9827, lon: 25.6615 },
  jyvaskyla: { name: 'Jyväskylä, Finland', lat: 62.2426, lon: 25.7473 },
  oulu: { name: 'Oulu, Finland', lat: 65.0121, lon: 25.4651 },
  rovaniemi: { name: 'Rovaniemi, Finland', lat: 66.5039, lon: 25.7294 },
  sodankyla: { name: 'Sodankylä, Finland', lat: 67.3616, lon: 26.6417 },
  utsjoki: { name: 'Utsjoki, Finland', lat: 69.9072, lon: 27.0276 }
};

async function fetchSolarLunarData(lat, lon) {
  try {
    const url = `/api/solarlunar?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching solar/lunar data:', error);
    throw error;
  }
}

function updateSolarLunarDisplay(data, locationKey) {
  // Update solar data
  document.getElementById('sunrise-time').textContent = formatTime(data.solar.sunrise);
  document.getElementById('sunset-time').textContent = formatTime(data.solar.sunset);
  document.getElementById('sun-altitude').textContent = data.solar.sunAltitude !== undefined ? 
    `${data.solar.sunAltitude.toFixed(1)}°` : '--°';
  document.getElementById('sun-azimuth').textContent = data.solar.sunAzimuth !== undefined ? 
    `${data.solar.sunAzimuth.toFixed(1)}°` : '--°';

  // Update lunar data
  document.getElementById('moonrise-time').textContent = formatTime(data.lunar.moonrise);
  document.getElementById('moonset-time').textContent = formatTime(data.lunar.moonset);
  document.getElementById('moon-phase').textContent = data.lunar.moonPhase !== undefined ? 
    `${data.lunar.moonPhase.toFixed(1)}%` : '--%';
  document.getElementById('moon-phase-name').textContent = data.lunar.moonPhaseName || '--';

  // Update twilight data
  document.getElementById('blue-hour').textContent = formatTimeRange(
    data.twilight.blueHour?.dawn?.start, data.twilight.blueHour?.dawn?.end);
  document.getElementById('golden-hour').textContent = formatTimeRange(
    data.twilight.goldenHour?.dawn?.start, data.twilight.goldenHour?.dawn?.end);

  // Update caption with last updated time
  const now = new Date();
  document.getElementById('solarlunar-updated').textContent = 
    now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Helsinki' });
}

function initSolarLunar() {
  const dropdown = document.getElementById('solarlunar-location');
  let currentLocationKey = dropdown ? dropdown.value : 'helsinki';
  let refreshTimer = null;

  async function updateForLocation(locKey) {
    const loc = SOLARLUNAR_LOCATIONS[locKey] || SOLARLUNAR_LOCATIONS['helsinki'];
    try {
      const data = await fetchSolarLunarData(loc.lat, loc.lon);
      updateSolarLunarDisplay(data, locKey);
    } catch (error) {
      console.error('Error initializing solar/lunar panel:', error);
      document.getElementById('solarlunar-content').innerHTML = '<div class="error">Failed to load solar and lunar data.</div>';
    }
  }

  // Initial fetch
  updateForLocation(currentLocationKey);

  // Dropdown change event
  if (dropdown) {
    dropdown.addEventListener('change', (e) => {
      currentLocationKey = e.target.value;
      updateForLocation(currentLocationKey);
    });
  }

  // Periodic refresh every 10 minutes
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    updateForLocation(currentLocationKey);
  }, 10 * 60 * 1000);
}

// Initialize solar/lunar panel
initSolarLunar();

})();
