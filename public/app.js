const CURVE_COLORS = ["#007aff", "#30d158", "#ff9f0a", "#bf5af2"];

const STANDARD_COLS = [
  { key: "estrategia", label: "Estrategia", isQuant: false },
  { key: "variante", label: "Variante", isQuant: false },
  { key: "sl", label: "SL", isQuant: false },
  { key: "tp", label: "TP / Ratio", isQuant: false },
  { key: "modo", label: "Modo", isQuant: false },
  { key: "operaciones", label: "Ops", isQuant: false, num: true },
  { key: "wr", label: "WR %", isQuant: false, num: true },
  { key: "r_total", label: "R Total", isQuant: false, num: true },
  { key: "expectancy", label: "Exp (R)", isQuant: false, num: true },
  { key: "dd_max", label: "DD Máx", isQuant: false, num: true },
  { key: "origen", label: "Origen", isQuant: false }
];

const QUANT_COLS = [
  { key: "pf", label: "Profit Factor", isQuant: true, num: true },
  { key: "sharpe", label: "Sharpe", isQuant: true, num: true },
  { key: "sortino", label: "Sortino", isQuant: true, num: true },
  { key: "calmar", label: "Calmar", isQuant: true, num: true }
];

const ALL_COLS = [...STANDARD_COLS, ...QUANT_COLS];
const COL_MAP = Object.fromEntries(ALL_COLS.map((c) => [c.key, c]));

const DEFAULT_NOTES = {
  "Machos BB+RSI":
    "• En vivo: F inverso SL 1,5 ATR + 50% a 1R + BOS M5 (Modo A 2L+2S).\n• Nota auditoría: la fila SL 1% BOS sin parcial (+397R) tiene DD real de -56,6R y 81% del retorno concentrado en 5 outliers (LSK +155R).\n• Pendiente evaluar: BOS M1 vs M5 en vivo; divergencias RSI 7, muro L2 y S/R H4.",
  "Oráculo 2 a 1":
    "• En vivo: O2 (SL 2%, a +3% bloquea +2% y persigue a 2%, dist ≤ 3%, Modo A 2L+2S).\n• Pendiente evaluar: O3 (muro de libro L2 histórico real) y trailing por BOS M1/M5.",
  "SL AUTO":
    "• En vivo: Escalera x,2x,6x con corte en 4ª recompra, TP +1% prom., Modo A (2L+2S).\n• Pendiente evaluar: dejar correr ganadoras con trailing BOS tras +1% prom., ADX/ATR, time-stop y BE 1,3R.",
  "Calculadora":
    "• Escalera de 6 recompras (x1,4) hasta 13,4%.\n• Pendiente evaluar: combinar corte en 4ª recompra con salida parcial + BOS.",
  "BB+RSI 5m":
    "• Señal directa sin invertir: solo positiva con 50% a 1R + BOS M5 (SL 2%). Superada ampliamente por Machos F inverso.",
  "2m":
    "• Entradas SHOCK Oráculo con SL corto (0,5%–1,7%). Positiva únicamente en Modo C con SL 1,7% y stop en ganancias (1R → 1R).",
  "DCA libro":
    "• Acumulación en muros de libro L2 de Binance (grabador 10:00, 16:00 y 20:00 AR). En acumulación de muestra."
};

let state = {
  rows: [],
  forward_vs_backtest: { resumen_txt: "", trades: [], excluidos: [] },
  live_bots: [],
  expandedStrategies: {},
  ui: {
    theme: "dark",
    accentColor: "#007aff",
    density: "compact",
    fontScale: 85,
    showQuantMetrics: false,
    columnOrder: ALL_COLS.map((c) => c.key),
    visibleColumns: STANDARD_COLS.map((c) => c.key),
    pinnedCurves: [],
    strategyNotes: { ...DEFAULT_NOTES }
  },
  filters: {
    search: "",
    estrategia: "ALL",
    sl: "ALL",
    tp: "ALL",
    modo: "ALL"
  },
  sort: { key: "r_total", dir: "desc" },
  top3Modo: "ALL",
  fvbMode: "conformes"
};

let tvChart = null;
let tvSeriesMap = new Map();
let dragColKey = null;

function showToast(msg) {
  const wrap = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function fmtNum(n, dec = 1, plus = false) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
  const v = Number(n);
  const s = v.toFixed(dec).replace(".", ",");
  return plus && v > 0 ? `+${s}` : s;
}

function roundNum(v, d) {
  return Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
}

function enrichQuantMetrics(row) {
  const r = Number(row.r_total || 0);
  const dd = Math.abs(Number(row.dd_max || 0.1));
  const wr = Number(row.wr || 50) / 100;
  const n = Number(row.operaciones || 100);

  let pf = r > 0 ? 1 + r / (n * (1 - wr + 0.05)) : Math.max(0.2, 1 + r / (n * 0.5));
  const pts = row.curva_r || [];
  const diffs = [];
  for (let i = 1; i < pts.length; i++) diffs.push(pts[i] - pts[i - 1]);
  const mean = diffs.reduce((a, b) => a + b, 0) / (diffs.length || 1);
  const variance = diffs.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (diffs.length || 1);
  const std = Math.sqrt(variance) || 0.01;
  const sharpe = (mean / std) * Math.sqrt(252 / 3.6);

  const downDiffs = diffs.filter((d) => d < 0);
  const downVar = downDiffs.reduce((a, b) => a + Math.pow(b, 2), 0) / (downDiffs.length || 1);
  const downStd = Math.sqrt(downVar) || 0.01;
  const sortino = (mean / downStd) * Math.sqrt(252 / 3.6);
  const calmar = dd > 0 ? (r * 4) / dd : 0;

  row.pf = roundNum(pf, 2);
  row.sharpe = roundNum(sharpe, 2);
  row.sortino = roundNum(sortino, 2);
  row.calmar = roundNum(calmar, 1);
}

function modoPill(m) {
  if (m.startsWith("A")) return `<span class="badge-pill badge-modo modo-a">${m}</span>`;
  if (m.startsWith("C")) return `<span class="badge-pill badge-modo modo-c">${m}</span>`;
  return `<span class="badge-pill badge-modo">${m}</span>`;
}

function ensureColumnOrder() {
  const order = Array.isArray(state.ui.columnOrder) ? [...state.ui.columnOrder] : [];
  ALL_COLS.forEach((c) => {
    if (!order.includes(c.key)) order.push(c.key);
  });
  state.ui.columnOrder = order.filter((k) => COL_MAP[k]);
}

async function loadData(silent = false) {
  try {
    let data = null;

    // 1. Intentar Serverless API en tiempo real
    try {
      const res = await fetch("/api/data");
      if (res.ok) {
        data = await res.json();
      }
    } catch (e) {
      console.warn("Fallo /api/data:", e);
    }

    // 2. Fallback estático a /data/dashboard_data.json
    if (!data || !Array.isArray(data.rows) || data.rows.length === 0) {
      try {
        const resStatic = await fetch("/data/dashboard_data.json");
        if (resStatic.ok) {
          data = await resStatic.json();
          console.log("Cargado desde fallback /data/dashboard_data.json");
        }
      } catch (_) {}
    }

    // 3. Fallback estático a /dashboard_data.json en raíz
    if (!data || !Array.isArray(data.rows) || data.rows.length === 0) {
      try {
        const resStatic2 = await fetch("/dashboard_data.json");
        if (resStatic2.ok) {
          data = await resStatic2.json();
          console.log("Cargado desde fallback /dashboard_data.json");
        }
      } catch (_) {}
    }

    // 4. Fallback a window.__INITIAL_DATA__ si está presente
    if ((!data || !Array.isArray(data.rows) || data.rows.length === 0) && window.__INITIAL_DATA__) {
      data = window.__INITIAL_DATA__;
    }

    if (!data || !Array.isArray(data.rows) || data.rows.length === 0) {
      console.error("No se pudieron cargar datos del dashboard de ninguna fuente");
      return;
    }

    state.rows = (data.rows || []).map((r) => {
      enrichQuantMetrics(r);
      return r;
    });
    state.forward_vs_backtest = data.forward_vs_backtest || { resumen_txt: "", trades: [], excluidos: [] };
    state.live_bots = data.live_bots || [];
    state.live_balances = data.live_balances || {};
    if (data.ui_config) {
      state.ui = {
        ...state.ui,
        ...data.ui_config,
        accentColor: "#007aff",
        density: "compact",
        fontScale: 85,
        strategyNotes: { ...DEFAULT_NOTES, ...(data.ui_config.strategyNotes || {}) }
      };
      if (state.ui.theme !== "light") state.ui.theme = "dark";
    }

    // Persistencia local en navegador (celular y PC)
    try {
      const savedConfig = localStorage.getItem("slauto_ui_config");
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig);
        state.ui = { ...state.ui, ...parsed };
      }
    } catch (_) {}
    ensureColumnOrder();

    // Asegurar que las curvas fijadas existan
    state.ui.pinnedCurves = (state.ui.pinnedCurves || []).filter((id) => state.rows.some((r) => r.id === id));
    if (!state.ui.pinnedCurves.length) {
      applyPresetIds("ganadoras_a", false);
    }

    document.getElementById("lastUpdateTxt").textContent = data.updated_at ? data.updated_at.split("T")[1] : "--";
    if (data.sheets_url) {
      document.getElementById("linkSheets").href = data.sheets_url;
    }
    // Botón para compartir/copiar link en celular
    const btnMob = document.getElementById("btnMobileLink");
    if (btnMob) {
      btnMob.style.display = "inline-flex";
      btnMob.title = "Copiar o compartir enlace en celular con datos 4G/5G";
      btnMob.onclick = () => {
        const u = data.tunnel_url || window.location.href;
        if (navigator.share) {
          navigator.share({ title: "SL AUTO Dashboard", url: u }).catch(() => {});
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(u);
          showToast("Link copiado para el celular");
        } else {
          prompt("Link para celular:", u);
        }
      };
    }

    applyUiTheme();
    renderAll();
    if (!silent) showToast("Actualizado en vivo");
  } catch (err) {
    console.error("Error cargando datos:", err);
  }
}

function saveUiConfig() {
  try {
    localStorage.setItem("slauto_ui_config", JSON.stringify(state.ui));
  } catch (_) {}
  fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state.ui)
  }).catch(() => {});
}

function setTheme(nextTheme) {
  state.ui.theme = nextTheme === "light" ? "light" : "dark";
  applyUiTheme();
  saveUiConfig();
  if (tvChart) {
    initTradingViewChart();
    renderCurvesSection();
  }
}

function applyUiTheme() {
  const isLight = state.ui.theme === "light";
  document.body.className = `theme-${isLight ? "light" : "dark"} density-compact`;
  document.documentElement.style.setProperty("--accent", "#007aff");
  document.documentElement.style.setProperty("--font-scale", "85%");

  const lblMode = document.getElementById("lblThemeMode");
  if (lblMode) lblMode.textContent = isLight ? "Light" : "Dark";

  const quantChk = document.getElementById("chkShowQuantMetrics");
  if (quantChk) quantChk.checked = Boolean(state.ui.showQuantMetrics);

  renderColumnsPopoverList();
}

function moveColumnInOrder(colKey, targetIdx) {
  ensureColumnOrder();
  const idx = state.ui.columnOrder.indexOf(colKey);
  if (idx < 0) return;
  state.ui.columnOrder.splice(idx, 1);
  const clamped = Math.max(0, Math.min(state.ui.columnOrder.length, targetIdx));
  state.ui.columnOrder.splice(clamped, 0, colKey);
  saveUiConfig();
  renderColumnsPopoverList();
  renderMainTable();
}

function renderColumnsPopoverList() {
  ensureColumnOrder();
  const wrap = document.getElementById("cfgColumnsList");
  if (!wrap) return;

  const availableKeys = state.ui.columnOrder.filter((k) => {
    const col = COL_MAP[k];
    return col && (!col.isQuant || state.ui.showQuantMetrics);
  });

  wrap.innerHTML = availableKeys
    .map((key, idx) => {
      const c = COL_MAP[key];
      const checked = state.ui.visibleColumns.includes(c.key) ? "checked" : "";
      return `
      <div class="col-order-item" draggable="true" data-col-item="${c.key}">
        <label>
          <input type="checkbox" data-col="${c.key}" ${checked}/>
          <span>${c.label}</span>
        </label>
        <div class="col-move-btns">
          <button class="col-move-btn" data-move="up" data-idx="${idx}" title="Subir">↑</button>
          <button class="col-move-btn" data-move="down" data-idx="${idx}" title="Bajar">↓</button>
        </div>
      </div>`;
    })
    .join("");

  wrap.querySelectorAll("input[type=checkbox]").forEach((chk) => {
    chk.addEventListener("change", (e) => {
      e.stopPropagation();
      const col = chk.dataset.col;
      if (chk.checked) {
        if (!state.ui.visibleColumns.includes(col)) state.ui.visibleColumns.push(col);
      } else {
        state.ui.visibleColumns = state.ui.visibleColumns.filter((k) => k !== col);
      }
      saveUiConfig();
      renderMainTable();
    });
  });

  wrap.querySelectorAll(".col-move-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.idx);
      const key = availableKeys[idx];
      const fullIdx = state.ui.columnOrder.indexOf(key);
      if (btn.dataset.move === "up" && fullIdx > 0) {
        moveColumnInOrder(key, fullIdx - 1);
      } else if (btn.dataset.move === "down" && fullIdx < state.ui.columnOrder.length - 1) {
        moveColumnInOrder(key, fullIdx + 1);
      }
    });
  });

  // Drag & Drop dentro del popover
  let draggedItemKey = null;
  wrap.querySelectorAll(".col-order-item").forEach((item) => {
    item.addEventListener("dragstart", (e) => {
      draggedItemKey = item.dataset.colItem;
      e.dataTransfer.effectAllowed = "move";
    });
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const targetKey = item.dataset.colItem;
      if (draggedItemKey && targetKey && draggedItemKey !== targetKey) {
        const targetIdx = state.ui.columnOrder.indexOf(targetKey);
        moveColumnInOrder(draggedItemKey, targetIdx);
      }
    });
  });
}

function setupDropdown(btnId, menuId, lblId, items, currentVal, onSelect) {
  const btn = document.getElementById(btnId);
  const menu = document.getElementById(menuId);
  const lbl = document.getElementById(lblId);

  lbl.textContent = currentVal === "ALL" ? "Todas" : currentVal;

  menu.innerHTML = items
    .map((it) => {
      const isAct = it === currentVal ? "active" : "";
      const txt = it === "ALL" ? "Todas" : it;
      return `<div class="dropdown-item ${isAct}" data-val="${it}">${txt}</div>`;
    })
    .join("");

  btn.onclick = (e) => {
    e.stopPropagation();
    document.querySelectorAll(".glass-popover.open").forEach((m) => m !== menu && m.classList.remove("open"));
    menu.classList.toggle("open");
    btn.classList.toggle("open");
  };

  menu.querySelectorAll(".dropdown-item").forEach((item) => {
    item.onclick = (e) => {
      e.stopPropagation();
      const val = item.dataset.val;
      menu.classList.remove("open");
      btn.classList.remove("open");
      onSelect(val);
    };
  });
}

function buildDropdownFilters() {
  const estrategias = ["ALL", ...new Set(state.rows.map((r) => r.estrategia))];
  const sls = ["ALL", ...new Set(state.rows.map((r) => r.sl))];
  const tps = ["ALL", ...new Set(state.rows.map((r) => r.tp))];

  setupDropdown(
    "btnFilterEstrategia",
    "menuFilterEstrategia",
    "lblFilterEstrategia",
    estrategias,
    state.filters.estrategia,
    (val) => {
      state.filters.estrategia = val;
      buildDropdownFilters();
      renderMainTable();
    }
  );

  setupDropdown("btnFilterSL", "menuFilterSL", "lblFilterSL", sls, state.filters.sl, (val) => {
    state.filters.sl = val;
    buildDropdownFilters();
    renderMainTable();
  });

  setupDropdown("btnFilterTP", "menuFilterTP", "lblFilterTP", tps, state.filters.tp, (val) => {
    state.filters.tp = val;
    buildDropdownFilters();
    renderMainTable();
  });
}

function getFilteredRows() {
  const q = state.filters.search.trim().toLowerCase();
  const filtered = state.rows.filter((r) => {
    if (state.filters.estrategia !== "ALL" && r.estrategia !== state.filters.estrategia) return false;
    if (state.filters.sl !== "ALL" && r.sl !== state.filters.sl) return false;
    if (state.filters.tp !== "ALL" && r.tp !== state.filters.tp) return false;
    if (state.filters.modo !== "ALL" && r.modo !== state.filters.modo) return false;
    if (q) {
      const hay = `${r.estrategia} ${r.variante} ${r.sl} ${r.tp} ${r.modo} ${r.origen}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const { key, dir } = state.sort;
  const mult = dir === "asc" ? 1 : -1;
  filtered.sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * mult;
    return String(va).localeCompare(String(vb)) * mult;
  });
  return filtered;
}

function renderKPIs() {
  const grid = document.getElementById("kpiGrid");
  if (!grid) return;
  const pool =
    state.top3Modo === "ALL" ? state.rows : state.rows.filter((r) => r.modo === state.top3Modo);
  if (!pool.length) {
    grid.innerHTML = `<div class="kpi-tile"><div class="kpi-title">Variantes</div><div class="kpi-val">0</div></div>`;
    return;
  }
  // Para Mayor R Total destacamos la mejor variante consistente (con WR >= 33% o de conjunto filtrado)
  const bestR = [...pool].sort((a, b) => b.r_total - a.r_total)[0];
  const bestExp = [...pool].sort((a, b) => b.expectancy - a.expectancy)[0];
  const bestWR = [...pool].sort((a, b) => b.wr - a.wr)[0];

  grid.innerHTML = `
    <div class="kpi-tile">
      <div class="kpi-header">
        <span class="kpi-title">Variantes</span>
        <span class="count-tag">${pool.length}</span>
      </div>
      <div class="kpi-val">${pool.filter((r) => r.r_total > 0).length} <span style="font-size:0.78rem;color:var(--pos)">+R</span></div>
      <div class="kpi-desc">90 días · Simultáneas</div>
    </div>
    <div class="kpi-tile">
      <div class="kpi-title">Mayor R Total</div>
      <div class="kpi-val pos">${fmtNum(bestR.r_total, 1, true)}R</div>
      <div class="kpi-desc">${bestR.estrategia} · ${bestR.tp} (DD ${fmtNum(bestR.dd_max, 1)}R)</div>
    </div>
    <div class="kpi-tile">
      <div class="kpi-title">Expectancy</div>
      <div class="kpi-val pos">${fmtNum(bestExp.expectancy, 3, true)}R</div>
      <div class="kpi-desc">${bestExp.estrategia} · ${bestExp.variante}</div>
    </div>
    <div class="kpi-tile">
      <div class="kpi-title">Win Rate</div>
      <div class="kpi-val">${fmtNum(bestWR.wr, 1)}%</div>
      <div class="kpi-desc">${bestWR.estrategia} (${bestWR.operaciones} ops)</div>
    </div>
  `;
}

function renderMainTable() {
  ensureColumnOrder();
  const filtered = getFilteredRows();
  document.getElementById("countBadge").textContent = `${filtered.length}`;

  const activeCols = state.ui.columnOrder
    .map((k) => COL_MAP[k])
    .filter((c) => {
      if (!c) return false;
      if (!state.ui.visibleColumns.includes(c.key)) return false;
      if (c.isQuant && !state.ui.showQuantMetrics) return false;
      return true;
    });

  const thead = document.getElementById("tableHeaderRow");
  const pencilSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;

  thead.innerHTML =
    `<th class="col-first-pencil">
      <button id="btnEditColumns" class="btn-pencil-hdr" title="Mostrar, ocultar o mover columnas">${pencilSvg}</button>
    </th>` +
    activeCols
      .map((c) => {
        const arrow = state.sort.key === c.key ? (state.sort.dir === "asc" ? " ↑" : " ↓") : "";
        const align = c.num ? "num" : "";
        return `<th data-col="${c.key}" draggable="true" class="${align}" title="Clic para ordenar · Arrastrá para mover columna">${c.label}${arrow}</th>`;
      })
      .join("");

  // Botón lápiz en 1ª columna
  const btnPencil = document.getElementById("btnEditColumns");
  const pop = document.getElementById("columnsPopover");
  if (btnPencil && pop) {
    btnPencil.onclick = (e) => {
      e.stopPropagation();
      pop.classList.toggle("hidden");
      btnPencil.classList.toggle("active", !pop.classList.contains("hidden"));
    };
  }

  // Ordenar por clic + Drag & Drop en encabezados <th>
  thead.querySelectorAll("th[data-col]").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      if (state.sort.key === col) {
        state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      } else {
        state.sort.key = col;
        state.sort.dir = "desc";
      }
      renderMainTable();
    });

    th.addEventListener("dragstart", (e) => {
      dragColKey = th.dataset.col;
      th.classList.add("dragging-col");
      e.dataTransfer.effectAllowed = "move";
    });
    th.addEventListener("dragend", () => {
      th.classList.remove("dragging-col");
      thead.querySelectorAll("th").forEach((x) => x.classList.remove("drag-over-col"));
    });
    th.addEventListener("dragover", (e) => {
      e.preventDefault();
      th.classList.add("drag-over-col");
    });
    th.addEventListener("dragleave", () => {
      th.classList.remove("drag-over-col");
    });
    th.addEventListener("drop", (e) => {
      e.preventDefault();
      th.classList.remove("drag-over-col");
      const targetKey = th.dataset.col;
      if (dragColKey && targetKey && dragColKey !== targetKey) {
        const targetIdx = state.ui.columnOrder.indexOf(targetKey);
        moveColumnInOrder(dragColKey, targetIdx);
      }
    });
  });

  const tbody = document.getElementById("tableBody");
  tbody.innerHTML = filtered
    .map((r) => {
      const pinIdx = state.ui.pinnedCurves.indexOf(r.id);
      const isPinned = pinIdx >= 0;
      const pinColor = isPinned ? CURVE_COLORS[pinIdx % CURVE_COLORS.length] : "";
      const cells = activeCols
        .map((c) => {
          const k = c.key;
          if (k === "estrategia") return `<td><strong>${r.estrategia}</strong></td>`;
          if (k === "sl") return `<td><span class="badge-pill badge-sl">${r.sl}</span></td>`;
          if (k === "tp") return `<td><span class="badge-pill badge-tp">${r.tp}</span></td>`;
          if (k === "modo") return `<td>${modoPill(r.modo)}</td>`;
          if (k === "wr") return `<td class="num">${fmtNum(r.wr, 1)}%</td>`;
          if (k === "r_total")
            return `<td class="num ${r.r_total >= 0 ? "pos" : "neg"}">${fmtNum(r.r_total, 1, true)}R</td>`;
          if (k === "expectancy")
            return `<td class="num ${r.expectancy >= 0 ? "pos" : "neg"}">${fmtNum(r.expectancy, 3, true)}</td>`;
          if (k === "dd_max") return `<td class="num neg">${fmtNum(r.dd_max, 1)}R</td>`;
          if (c.num) return `<td class="num">${fmtNum(r[k], 2)}</td>`;
          return `<td>${r[k] || "-"}</td>`;
        })
        .join("");

      const styleInline = isPinned ? `style="background:${pinColor};box-shadow:0 0 8px ${pinColor}"` : "";
      return `<tr>
        <td class="col-curve-hitbox ${isPinned ? "is-pinned" : ""}" data-curve-id="${r.id}" title="${
        isPinned ? "Quitar de la curva" : "Agregar a la curva"
      }">
          <span class="curve-mini-btn" ${styleInline}>${isPinned ? "✓" : "+"}</span>
        </td>
        ${cells}
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll("td.col-curve-hitbox").forEach((td) => {
    td.addEventListener("click", () => togglePinnedCurve(td.dataset.curveId));
  });
}

function togglePinnedCurve(rowId) {
  const idx = state.ui.pinnedCurves.indexOf(rowId);
  if (idx >= 0) {
    state.ui.pinnedCurves.splice(idx, 1);
  } else {
    if (state.ui.pinnedCurves.length >= 4) state.ui.pinnedCurves.shift();
    state.ui.pinnedCurves.push(rowId);
  }
  saveUiConfig();
  renderMainTable();
  renderCurvesSection();
  renderStrategiesTab();
}

function applyPresetIds(preset, rerender = true) {
  let picks = [];
  if (preset === "ganadoras_a") {
    // Seleccionar la mejor variante consistente de cada estrategia en Modo A (para Machos priorizamos SL ATR 1,5 + parcial BOS M5 en vivo)
    const machosLive =
      state.rows.find((r) => r.estrategia === "Machos BB+RSI" && r.sl === "ATR 1,5" && r.tp === "50% a 1R + BOS M5" && r.modo === "A (2L+2S)") ||
      state.rows.filter((r) => r.estrategia === "Machos BB+RSI" && r.modo === "A (2L+2S)")[0];
    const oraculoBest = state.rows
      .filter((r) => r.estrategia === "Oráculo 2 a 1" && r.modo === "A (2L+2S)")
      .sort((a, b) => b.r_total - a.r_total)[0];
    const slautoBest = state.rows
      .filter((r) => r.estrategia === "SL AUTO" && r.modo === "A (2L+2S)")
      .sort((a, b) => b.r_total - a.r_total)[0];
    const calcBest = state.rows
      .filter((r) => r.estrategia === "Calculadora" && r.modo === "A (2L+2S)")
      .sort((a, b) => b.r_total - a.r_total)[0];
    picks = [machosLive, oraculoBest, slautoBest, calcBest].filter(Boolean).map((r) => r.id);
  } else if (preset === "machos") {
    picks = state.rows
      .filter((r) => r.estrategia === "Machos BB+RSI" && r.modo !== "sin tope")
      .sort((a, b) => b.r_total - a.r_total)
      .slice(0, 4)
      .map((r) => r.id);
  } else if (preset === "oraculo") {
    picks = state.rows
      .filter((r) => r.estrategia === "Oráculo 2 a 1" && r.modo === "A (2L+2S)")
      .sort((a, b) => b.r_total - a.r_total)
      .slice(0, 4)
      .map((r) => r.id);
  } else if (preset === "slauto") {
    const sls = state.rows
      .filter((r) => r.estrategia === "SL AUTO")
      .sort((a, b) => b.r_total - a.r_total)
      .slice(0, 2);
    const calcs = state.rows
      .filter((r) => r.estrategia === "Calculadora")
      .sort((a, b) => b.r_total - a.r_total)
      .slice(0, 2);
    picks = [...sls, ...calcs].map((r) => r.id);
  }
  state.ui.pinnedCurves = picks;
  saveUiConfig();
  if (rerender) {
    renderMainTable();
    renderCurvesSection();
    renderStrategiesTab();
  }
}

// PESTAÑA 02: ESTRATEGIAS (CON RESÚMENES ARRIBA, EXPANDIR TODAS LAS VARIANTES Y NOTAS AL FINAL)
function renderStrategiesTab() {
  renderKPIs();
  const estrategias = [
    "Machos BB+RSI",
    "Oráculo 2 a 1",
    "SL AUTO",
    "Calculadora",
    "BB+RSI 5m",
    "2m",
    "DCA libro"
  ];
  const grid = document.getElementById("top3Grid");
  if (!grid) return;

  grid.innerHTML = estrategias
    .map((est) => {
      const allForEst = state.rows
        .filter((r) => r.estrategia === est && (state.top3Modo === "ALL" || r.modo === state.top3Modo))
        .sort((a, b) => b.r_total - a.r_total);

      const top3 = allForEst.slice(0, 3);
      const rest = allForEst.slice(3);
      const isExpanded = Boolean(state.expandedStrategies[est]);

      const renderVariantRow = (r, i) => {
        const pinIdx = state.ui.pinnedCurves.indexOf(r.id);
        const isPinned = pinIdx >= 0;
        const pinColor = isPinned ? CURVE_COLORS[pinIdx % CURVE_COLORS.length] : "";
        const styleInline = isPinned ? `style="background:${pinColor};border-color:transparent;color:#fff"` : "";
        return `
          <div class="rank-item">
            <div style="display:flex;align-items:center;gap:9px;min-width:0">
              <button class="curve-mini-btn" style="pointer-events:auto;cursor:pointer;${
                isPinned ? `background:${pinColor};border-color:transparent;color:#fff` : ""
              }" data-strat-curve="${r.id}" title="Agregar/quitar de la curva">${isPinned ? "✓" : "+"}</button>
              <span class="rank-badge ${i === 0 ? "top-1" : ""}">${i + 1}</span>
              <div style="min-width:0">
                <div style="font-weight:600;font-size:0.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${
                  r.variante
                }</div>
                <div style="display:flex;gap:4px;margin-top:2px;flex-wrap:wrap">
                  <span class="badge-pill badge-sl">${r.sl}</span>
                  <span class="badge-pill badge-tp">${r.tp}</span>
                  ${modoPill(r.modo)}
                </div>
              </div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div class="${
                r.r_total >= 0 ? "pos" : "neg"
              }" style="font-family:'SF Mono','JetBrains Mono',monospace;font-size:0.94rem;font-weight:700">${fmtNum(
          r.r_total,
          1,
          true
        )}R</div>
              <div style="font-size:0.69rem;color:var(--text-dim)">WR ${fmtNum(r.wr, 1)}% · DD ${fmtNum(
          r.dd_max,
          1
        )}R · ${r.operaciones} ops</div>
            </div>
          </div>`;
      };

      const topHtml = top3.length
        ? top3.map((r, i) => renderVariantRow(r, i)).join("")
        : `<p style="font-size:0.75rem;color:var(--text-dim);padding:6px 0">Sin variantes en este modo</p>`;

      const restHtml =
        rest.length > 0
          ? `<div class="strat-all-variants ${isExpanded ? "" : "hidden"}" data-expand-box="${est}">
              ${rest.map((r, idx) => renderVariantRow(r, idx + 3)).join("")}
            </div>`
          : "";

      const expandBtnHtml =
        rest.length > 0
          ? `<button class="btn-expand-strat" data-expand-est="${est}">
              ${isExpanded ? `Ocultar (${allForEst.length}) ▴` : `Ver todas (${allForEst.length}) ▾`}
            </button>`
          : `<span style="font-size:0.7rem;color:var(--text-dim)">${allForEst.length} var.</span>`;

      const noteVal = (state.ui.strategyNotes && state.ui.strategyNotes[est]) || DEFAULT_NOTES[est] || "";

      return `
        <div class="strategy-box">
          <div class="strat-hdr">
            <h3>${est}</h3>
            <div class="strat-hdr-meta">
              ${expandBtnHtml}
            </div>
          </div>
          ${topHtml}
          ${restHtml}
          <div class="strat-notes-wrap">
            <div class="strat-notes-label">
              <span>Notas y posibles variantes a incluir</span>
            </div>
            <textarea class="strat-notes-input" data-note-est="${est}" placeholder="Agregá notas o variantes pendientes para ${est}...">${noteVal}</textarea>
          </div>
        </div>
      `;
    })
    .join("");

  // Eventos expandir estrategia
  grid.querySelectorAll("button[data-expand-est]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const est = btn.dataset.expandEst;
      state.expandedStrategies[est] = !state.expandedStrategies[est];
      renderStrategiesTab();
    });
  });

  // Eventos botón + curva dentro de tarjetas
  grid.querySelectorAll("button[data-strat-curve]").forEach((btn) => {
    btn.addEventListener("click", () => togglePinnedCurve(btn.dataset.stratCurve));
  });

  // Eventos guardado automático de notas por estrategia
  let noteTimer = null;
  grid.querySelectorAll("textarea[data-note-est]").forEach((ta) => {
    ta.addEventListener("input", () => {
      const est = ta.dataset.noteEst;
      if (!state.ui.strategyNotes) state.ui.strategyNotes = {};
      state.ui.strategyNotes[est] = ta.value;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => saveUiConfig(), 500);
    });
  });
}

// GRÁFICO TRADINGVIEW CON LÍNEA 0R MARCADA EN GRIS OSCURO
function initTradingViewChart() {
  const container = document.getElementById("tvChartContainer");
  if (!container || !window.LightweightCharts) return;

  container.innerHTML = "";
  tvSeriesMap.clear();

  const isLight = state.ui.theme === "light";
  const gridColor = isLight ? "rgba(15, 23, 42, 0.055)" : "rgba(255, 255, 255, 0.05)";
  const textColor = isLight ? "rgba(29, 29, 31, 0.64)" : "rgba(245, 245, 247, 0.62)";

  tvChart = LightweightCharts.createChart(container, {
    width: container.clientWidth || 1200,
    height: 330,
    layout: {
      background: { type: "solid", color: "transparent" },
      textColor: textColor,
      fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
      fontSize: 11
    },
    grid: {
      vertLines: { color: gridColor },
      horzLines: { color: gridColor }
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: isLight ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.25)", style: 2 },
      horzLine: { color: isLight ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.25)", style: 2 }
    },
    rightPriceScale: {
      borderColor: gridColor,
      scaleMargins: { top: 0.12, bottom: 0.12 }
    },
    timeScale: {
      borderColor: gridColor,
      visible: true
    }
  });

  tvChart.subscribeCrosshairMove((param) => {
    const hudStep = document.getElementById("hudStep");
    if (!param.point || param.time === undefined) {
      hudStep.textContent = "--";
      updateHudItems(null);
      return;
    }
    const stepIdx = Number(param.time);
    hudStep.textContent = `${stepIdx * 4}%`;

    const values = {};
    for (const [rowId, entry] of tvSeriesMap.entries()) {
      const data = param.seriesData.get(entry.series);
      if (data && data.value !== undefined) values[rowId] = data.value;
    }
    updateHudItems(values);
  });

  window.addEventListener("resize", () => {
    if (tvChart && container) {
      tvChart.applyOptions({ width: container.clientWidth });
    }
  });
}

function updateHudItems(values) {
  const hudSeries = document.getElementById("hudSeries");
  if (!hudSeries) return;

  const selected = state.ui.pinnedCurves
    .map((id) => state.rows.find((r) => r.id === id))
    .filter(Boolean)
    .slice(0, 4);

  hudSeries.innerHTML = selected
    .map((r, idx) => {
      const color = CURVE_COLORS[idx];
      const val =
        values && values[r.id] !== undefined
          ? `${fmtNum(values[r.id], 2, true)}R`
          : `${fmtNum(r.r_total, 1, true)}R`;
      return `
      <div class="hud-item">
        <span class="dot" style="background:${color}"></span>
        <span>${r.estrategia.split(" ")[0]}</span>
        <span class="val" style="color:${color}">${val}</span>
      </div>`;
    })
    .join("");
}

function renderCurvesSection() {
  const selected = state.ui.pinnedCurves
    .map((id) => state.rows.find((r) => r.id === id))
    .filter(Boolean)
    .slice(0, 4);

  const bar = document.getElementById("selectedCurvesBar");
  if (bar) {
    bar.innerHTML = selected
      .map(
        (r, idx) => `
        <div class="curve-pill">
          <span class="dot" style="background:${CURVE_COLORS[idx]}"></span>
          <strong>${r.estrategia}</strong> · ${r.variante}
          <span class="badge-pill badge-sl">${r.sl}</span>
          <span class="badge-pill badge-tp">${r.tp}</span>
          <span class="val ${r.r_total >= 0 ? "pos" : "neg"}">${fmtNum(r.r_total, 1, true)}R</span>
          <button class="remove-btn" data-rm="${r.id}" title="Quitar de la curva">✕</button>
        </div>`
      )
      .join("");

    bar.querySelectorAll("button[data-rm]").forEach((b) => {
      b.addEventListener("click", () => togglePinnedCurve(b.dataset.rm));
    });
  }

  updateTradingViewSeries(selected);
  updateHudItems(null);
}

function updateTradingViewSeries(selected) {
  if (!tvChart) initTradingViewChart();
  if (!tvChart) return;

  for (const [id, entry] of tvSeriesMap.entries()) {
    if (!selected.some((r) => r.id === id)) {
      tvChart.removeSeries(entry.series);
      tvSeriesMap.delete(id);
    }
  }

  selected.forEach((r, idx) => {
    let entry = tvSeriesMap.get(r.id);
    const color = CURVE_COLORS[idx];
    if (!entry) {
      const series = tvChart.addBaselineSeries({
        baseValue: { type: "price", price: 0 },
        topLineColor: color,
        bottomLineColor: color,
        topFillColor1: color + "26",
        topFillColor2: "transparent",
        bottomFillColor1: "transparent",
        bottomFillColor2: color + "14",
        lineWidth: 2.5,
        baseLineVisible: idx === 0,
        baseLineColor: "#52525b",
        baseLineWidth: 2,
        baseLineStyle: LightweightCharts.LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat: {
          type: "custom",
          formatter: (price) => `${price.toFixed(1)}R`
        }
      });
      // Línea del punto 0 bien marcada en color gris oscuro (solo la base global)
      if (idx === 0) {
        series.createPriceLine({
          price: 0,
          color: "#52525b",
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Solid,
          axisLabelVisible: true,
          title: "0R"
        });
      }
      entry = { series };
      tvSeriesMap.set(r.id, entry);
    } else {
      entry.series.applyOptions({
        topLineColor: color,
        bottomLineColor: color,
        baseLineVisible: idx === 0,
        baseLineColor: "#52525b",
        baseLineWidth: 2,
        baseLineStyle: LightweightCharts.LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false
      });
    }

    const data = (r.curva_r || []).map((v, step) => ({ time: step, value: v }));
    entry.series.setData(data);
  });

  tvChart.timeScale().fitContent();
}

function renderForwardTab() {
  const botsGrid = document.getElementById("botsGrid");
  botsGrid.innerHTML = (state.live_bots || [])
    .map(
      (b) => `
      <div class="bot-tile">
        <div class="bot-top">
          <span class="bot-name">${b.nombre}</span>
          <span class="live-pill"><span class="dot"></span> ${b.script}</span>
        </div>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:7px">${b.tope}</div>
        <div class="bot-log-box">${(b.ultimasLineas || []).join("<br/>") || "Sin actividad reciente"}</div>
      </div>`
    )
    .join("");

  const rawTrades = state.forward_vs_backtest.trades || [];
  const rawExcluidos = state.forward_vs_backtest.excluidos || [];
  const excludedSet = new Set(state.ui.fvbExcludedIds || []);
  const notesMap = state.ui.fvbNotes || {};

  const periodFilter = document.getElementById("selFvbPeriodo")?.value || "14oct";

  // Unificar trades con estado de exclusión interactivo y filtrado por período
  const allTrades = [...rawTrades, ...rawExcluidos]
    .filter((t) => {
      const fecha = t.cierre || "";
      if (periodFilter === "14oct" && fecha < "2026-10-14") return false;
      if (periodFilter === "oct" && fecha < "2026-10-01") return false;
      return true;
    })
    .map((t) => {
      const id = `${t.cuenta}_${t.cierre}_${t.symbol}_${t.lado}`;
      const defaultExcl = t.clase === "EXCLUIDO";
      const isExcluded = excludedSet.has(id) ? true : (defaultExcl && !state.ui.fvbIncludedIds?.includes(id));
      return { ...t, id, isExcluded, note: notesMap[id] || t.causa || "" };
    });

  // Estadísticas reales arriba por estrategia
  const statsStrip = document.getElementById("fvbStatsStrip");
  if (statsStrip) {
    const stratDefs = [
      { key: "principal", name: "SL AUTO", label: "Cuenta Principal" },
      { key: "macho", name: "Machos BB+RSI", label: "Subcuenta Macho" },
      { key: "oraculo", name: "Oráculo 2 a 1", label: "Subcuenta Oráculo" }
    ];

    statsStrip.innerHTML = stratDefs
      .map((st) => {
        const stratTrades = allTrades.filter((t) => t.cuenta === st.key);
        // Si el usuario está viendo "excluidos", muestra la suma de excluidos; si está en "todos", muestra todos; por defecto "conformes"
        const subset =
          state.fvbMode === "excluidos"
            ? stratTrades.filter((t) => t.isExcluded)
            : state.fvbMode === "todos"
            ? stratTrades
            : stratTrades.filter((t) => !t.isExcluded);

        const conformesCount = stratTrades.filter((t) => !t.isExcluded).length;
        const exclCount = stratTrades.length - conformesCount;
        const wins = subset.filter((t) => Number(t.pnl_neto) > 0).length;
        const wr = subset.length ? ((wins / subset.length) * 100).toFixed(1) : "0.0";
        const pnlUsdt = subset.reduce((acc, t) => acc + (Number(t.pnl_neto) || 0), 0);
        const rTot = subset.reduce((acc, t) => acc + (Number(t.R_real) || 0), 0);

        const balInfo = (state.live_balances && state.live_balances[st.key]) || {};
        const equity = balInfo.equity !== undefined ? balInfo.equity.toFixed(2) : "--";

        return `
        <div class="kpi-tile">
          <div class="kpi-header">
            <span class="kpi-title">${st.name}</span>
            <span class="count-tag">${conformesCount} conf / ${exclCount} excl</span>
          </div>
          <div class="kpi-val ${pnlUsdt >= 0 ? "pos" : "neg"}">${pnlUsdt >= 0 ? "+" : ""}${pnlUsdt.toFixed(2)} USDT <span style="font-size:0.75rem;font-weight:600">(${rTot >= 0 ? "+" : ""}${rTot.toFixed(1)}R)</span></div>
          <div class="kpi-desc">
            <span style="color:var(--text-dim);font-weight:500">Cuenta: <strong style="color:var(--text-muted);font-weight:600">${equity} USDT</strong></span> · 
            <span>WR ${wr}% (${wins}/${subset.length})</span> · 
            <span style="color:var(--text-dim)">${st.label}</span>
          </div>
        </div>`;
      })
      .join("");
  }

  // Filtrado de la lista para el Journal
  const filterAccount = document.getElementById("selFvbEstrategia")?.value || "ALL";
  let displayList = allTrades.filter((t) => {
    if (filterAccount !== "ALL" && t.cuenta !== filterAccount) return false;
    if (state.fvbMode === "conformes" && t.isExcluded) return false;
    if (state.fvbMode === "excluidos" && !t.isExcluded) return false;
    return true;
  });

  document.getElementById("fvbTradesCount").textContent = `${displayList.length}`;

  const head = document.getElementById("fvbTradesHead");
  const body = document.getElementById("fvbTradesBody");
  head.innerHTML = `
    <tr>
      <th>Fecha</th>
      <th>Estrategia</th>
      <th>Par</th>
      <th>Lado</th>
      <th class="num">PnL USDT</th>
      <th class="num">R Real</th>
      <th>Tipo Cierre</th>
      <th>Estado</th>
      <th>Nota / Motivo</th>
    </tr>`;

  if (!displayList.length) {
    body.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text-dim);padding:14px">Sin registros con el filtro seleccionado</td></tr>`;
    return;
  }

  body.innerHTML = displayList
    .slice()
    .reverse()
    .map((t) => {
      const pnlNum = Number(t.pnl_neto) || 0;
      const rNum = Number(t.R_real) || 0;
      const pnlCls = pnlNum >= 0 ? "pos" : "neg";
      const rCls = rNum >= 0 ? "pos" : "neg";
      const exclBtnTxt = t.isExcluded ? "Excluido ✕" : "Conforme ✓";
      const exclBtnCls = t.isExcluded ? "is-excluded" : "";

      return `
      <tr>
        <td style="font-family:'SF Mono',monospace;font-size:0.73rem">${t.cierre || "-"}</td>
        <td><strong>${t.cuenta === "principal" ? "SL AUTO" : t.cuenta === "macho" ? "Machos" : "Oráculo"}</strong></td>
        <td><span class="badge-pill badge-modo">${t.symbol}</span></td>
        <td><span class="badge-pill ${t.lado === "LONG" ? "badge-tp" : "badge-sl"}">${t.lado}</span></td>
        <td class="num ${pnlCls}">${pnlNum >= 0 ? "+" : ""}${pnlNum.toFixed(2)}</td>
        <td class="num ${rCls}">${rNum >= 0 ? "+" : ""}${rNum.toFixed(2)}R</td>
        <td style="font-size:0.73rem">${t.tipo_cierre || "Market"}</td>
        <td>
          <button class="btn-exclude-trade ${exclBtnCls}" data-trade-id="${t.id}">
            ${exclBtnTxt}
          </button>
        </td>
        <td>
          <input type="text" class="trade-note-input" data-trade-note-id="${t.id}" value="${t.note || ""}" placeholder="Agregar nota..." />
        </td>
      </tr>`;
    })
    .join("");

  // Eventos toggle exclusión
  body.querySelectorAll("button.btn-exclude-trade").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.tradeId;
      if (!state.ui.fvbExcludedIds) state.ui.fvbExcludedIds = [];
      if (!state.ui.fvbIncludedIds) state.ui.fvbIncludedIds = [];
      const isExcl = state.ui.fvbExcludedIds.includes(id);

      if (isExcl) {
        state.ui.fvbExcludedIds = state.ui.fvbExcludedIds.filter((x) => x !== id);
        if (!state.ui.fvbIncludedIds.includes(id)) state.ui.fvbIncludedIds.push(id);
      } else {
        state.ui.fvbIncludedIds = state.ui.fvbIncludedIds.filter((x) => x !== id);
        state.ui.fvbExcludedIds.push(id);
      }
      saveUiConfig();
      renderForwardTab();
    });
  });

  // Eventos notas por trade
  let tradeNoteTimer = null;
  body.querySelectorAll("input.trade-note-input").forEach((inp) => {
    inp.addEventListener("input", () => {
      const id = inp.dataset.tradeNoteId;
      if (!state.ui.fvbNotes) state.ui.fvbNotes = {};
      state.ui.fvbNotes[id] = inp.value;
      clearTimeout(tradeNoteTimer);
      tradeNoteTimer = setTimeout(() => saveUiConfig(), 600);
    });
  });
}

function renderAll() {
  buildDropdownFilters();
  renderCurvesSection();
  renderMainTable();
  renderStrategiesTab();
  renderForwardTab();
}

document.addEventListener("DOMContentLoaded", () => {
  // Botón Dark / Light Mode al lado del Sync
  document.getElementById("btnThemeToggle").addEventListener("click", () => {
    setTheme(state.ui.theme === "light" ? "dark" : "light");
  });

  // Tabs principales
  document.querySelectorAll("#mainTabs .nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#mainTabs .nav-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const target = document.getElementById(btn.dataset.tab);
      if (target) target.classList.add("active");
      if (btn.dataset.tab === "tab-detalle") {
        setTimeout(() => {
          if (tvChart) tvChart.timeScale().fitContent();
          renderCurvesSection();
        }, 40);
      }
    });
  });

  // Buscador
  const searchInput = document.getElementById("searchInput");
  const searchClear = document.getElementById("btnSearchClear");
  searchInput.addEventListener("input", (e) => {
    state.filters.search = e.target.value;
    searchClear.classList.toggle("hidden", !e.target.value);
    renderMainTable();
  });
  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    state.filters.search = "";
    searchClear.classList.add("hidden");
    renderMainTable();
  });

  // Filtro Modo
  document.querySelectorAll("#controlFilterModo .seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#controlFilterModo .seg-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.filters.modo = btn.dataset.modo;
      renderMainTable();
    });
  });

  // Reset filtros
  document.getElementById("btnResetFilters").addEventListener("click", () => {
    state.filters = { search: "", estrategia: "ALL", sl: "ALL", tp: "ALL", modo: "ALL" };
    searchInput.value = "";
    searchClear.classList.add("hidden");
    document.querySelectorAll("#controlFilterModo .seg-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.modo === "ALL");
    });
    buildDropdownFilters();
    renderMainTable();
  });

  // Estrategias Modo
  document.querySelectorAll("#pillsTop3Modo .seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#pillsTop3Modo .seg-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.top3Modo = btn.dataset.modo;
      renderStrategiesTab();
    });
  });

  // Presets Curvas
  document.querySelectorAll("#curvePresets .chip").forEach((btn) => {
    btn.addEventListener("click", () => applyPresetIds(btn.dataset.preset, true));
  });

  // Forward vs Backtest
  const btnShowConf = document.getElementById("btnShowConformes");
  const btnShowExcl = document.getElementById("btnShowExcluidos");
  const btnShowAll = document.getElementById("btnShowTodos");
  const selStrat = document.getElementById("selFvbEstrategia");
  const selPeriod = document.getElementById("selFvbPeriodo");

  function setFvbFilter(mode) {
    state.fvbMode = mode;
    btnShowConf?.classList.toggle("active", mode === "conformes");
    btnShowExcl?.classList.toggle("active", mode === "excluidos");
    btnShowAll?.classList.toggle("active", mode === "todos");
    renderForwardTab();
  }

  btnShowConf?.addEventListener("click", () => setFvbFilter("conformes"));
  btnShowExcl?.addEventListener("click", () => setFvbFilter("excluidos"));
  btnShowAll?.addEventListener("click", () => setFvbFilter("todos"));
  selStrat?.addEventListener("change", () => renderForwardTab());
  selPeriod?.addEventListener("change", () => renderForwardTab());

  // Sync Sheets
  document.getElementById("btnSyncSheets").addEventListener("click", async () => {
    const btn = document.getElementById("btnSyncSheets");
    btn.disabled = true;
    showToast("Sincronizando Google Sheets...");
    try {
      const r = await fetch("/api/sync", { method: "POST" });
      const res = await r.json();
      await loadData(true);
      showToast(res.ok ? "Google Sheets sincronizado" : `Aviso: ${res.error || res.output}`);
    } catch {
      showToast("Error en sincronización");
    } finally {
      btn.disabled = false;
    }
  });

  // Toggle métricas quant avanzadas (dentro del popover del lápiz)
  const chkQuant = document.getElementById("chkShowQuantMetrics");
  if (chkQuant) {
    chkQuant.addEventListener("change", (e) => {
      state.ui.showQuantMetrics = e.target.checked;
      if (e.target.checked) {
        QUANT_COLS.forEach((c) => {
          if (!state.ui.visibleColumns.includes(c.key)) state.ui.visibleColumns.push(c.key);
        });
      } else {
        state.ui.visibleColumns = state.ui.visibleColumns.filter((k) => !QUANT_COLS.some((qc) => qc.key === k));
      }
      saveUiConfig();
      renderColumnsPopoverList();
      renderMainTable();
    });
  }

  const colPop = document.getElementById("columnsPopover");
  if (colPop) {
    colPop.addEventListener("click", (e) => e.stopPropagation());
  }

  document.addEventListener("click", () => {
    document.querySelectorAll(".glass-popover.open").forEach((m) => m.classList.remove("open"));
    document.querySelectorAll(".dropdown-trigger.open").forEach((b) => b.classList.remove("open"));
    if (colPop && !colPop.classList.contains("hidden")) {
      colPop.classList.add("hidden");
      const btnP = document.getElementById("btnEditColumns");
      if (btnP) btnP.classList.remove("active");
    }
  });

  loadData(true);

  // Polling automático inteligente cada 60s o cuando el usuario vuelve a la pestaña del celular
  setInterval(() => {
    if (!document.hidden) loadData(true);
  }, 60000);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadData(true);
  });

  // Conexión SSE opcional (solo si el backend lo soporta, se cierra limpiamente si no)
  try {
    const ev = new EventSource("/api/events");
    ev.addEventListener("data_updated", () => loadData(true));
    ev.addEventListener("bots_updated", () => loadData(true));
    ev.addEventListener("ui_reload", () => window.location.reload());
    ev.onerror = () => {
      ev.close();
    };
  } catch (_) {}
});
