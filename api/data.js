/**
 * SL AUTO · Quant & Backtest Hub
 * Vercel Serverless Function: /api/data
 * 
 * Estrategia de carga híbrida de máxima resiliencia:
 * 1. Snapshot requerido directamente (garantizado en el bundle de Vercel)
 * 2. Lectura en tiempo real de Google Sheets (Export CSV o Google Sheets API v4)
 * 3. Cruce inteligente con fallback de curvas precalculadas para asegurar que cada fila tenga su gráfico
 */

const fs = require("fs");
const path = require("path");

// El require estático garantiza que Vercel incluya snapshot.json en la función serverless
let localSnapshot = null;
try {
  localSnapshot = require("./snapshot.json");
} catch (_) {}

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "1LA62DNDVUce5e5772OiQlWOJZPvr4R6QYE8DMrUlDJU";
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "";

function parseCSV(text) {
  const p = [];
  let row = [""];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"') {
      if (inQuotes && next === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      row.push("");
    } else if ((c === "\r" || c === "\n") && !inQuotes) {
      if (c === "\r" && next === "\n") i++;
      p.push(row);
      row = [""];
    } else {
      row[row.length - 1] += c;
    }
  }
  if (row.length > 1 || row[0] !== "") p.push(row);
  return p;
}

function parseNum(val, def = 0) {
  if (val === null || val === undefined || val === "") return def;
  const clean = String(val).replace(/[$%]/g, "").replace(",", ".").trim();
  const n = Number(clean);
  return isNaN(n) ? def : n;
}

function processGridData(detalleRows, curvasRows) {
  // 1. Procesar Curvas PnL
  const curvasMap = {};
  if (Array.isArray(curvasRows) && curvasRows.length > 1) {
    const headers = curvasRows[0];
    for (let col = 1; col < headers.length; col++) {
      const h = String(headers[col] || "").trim();
      if (!h) continue;
      const pts = [];
      for (let r = 1; r < curvasRows.length; r++) {
        const v = curvasRows[r][col];
        if (v !== "" && v !== null && v !== undefined) {
          const num = parseNum(v, NaN);
          if (!isNaN(num)) pts.push(num);
        }
      }
      if (pts.length) curvasMap[h] = pts;
    }
  }

  // 2. Procesar Detalle
  const rows = [];
  if (Array.isArray(detalleRows) && detalleRows.length > 1) {
    for (let r = 1; r < detalleRows.length; r++) {
      const row = detalleRows[r];
      if (!row || !row[0]) continue;
      const est = String(row[0] || "").trim();
      const varName = String(row[1] || "").trim();
      const sl = String(row[2] || "").trim();
      const tp = String(row[3] || "").trim();
      const modo = String(row[4] || "").trim();
      const dias = parseNum(row[5], 90);
      const ops = parseNum(row[6], 0);
      const wr = parseNum(row[7], 0);
      const rtot = parseNum(row[8], 0);
      const exp = parseNum(row[9], 0);
      const dd = parseNum(row[10], 0);
      const orig = String(row[11] || "").trim();

      // Búsqueda de curva en Curvas PnL
      const modoLetra = modo.charAt(0);
      let curva = curvasMap[`${est} | ${varName} · ${modo}`] ||
                  curvasMap[`${est} | ${varName} · ${modoLetra}`] ||
                  curvasMap[`${varName} · ${modoLetra}`] ||
                  curvasMap[varName] || [];

      // Si no hay match directo, buscar por palabras clave
      if (!curva.length) {
        for (const [k, pts] of Object.entries(curvasMap)) {
          if (k.includes(varName) && (k.endsWith(`· ${modoLetra}`) || k.includes(` ${modoLetra} `) || k.includes(modo))) {
            curva = pts;
            break;
          }
        }
      }

      // Si aún no hay curva, rescatar la curva exacta precalculada del snapshot local
      if (!curva.length && localSnapshot?.rows) {
        const snapMatch = localSnapshot.rows.find(
          (sr) => sr.estrategia === est && sr.variante === varName && (sr.modo === modo || sr.modo?.startsWith(modoLetra))
        );
        if (snapMatch?.curva_r?.length) {
          curva = snapMatch.curva_r;
        }
      }

      rows.push({
        id: `row_${r}`,
        estrategia: est,
        variante: varName,
        sl,
        tp,
        modo,
        dias,
        operaciones: ops,
        wr,
        r_total: rtot,
        expectancy: exp,
        dd_max: dd,
        origen: orig,
        curva_r: curva
      });
    }
  }

  return {
    updated_at: new Date().toISOString(),
    sheets_id: SPREADSHEET_ID,
    sheets_url: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`,
    columns: [
      "Estrategia", "Variante", "SL", "TP / Ratio", "Modo",
      "Días", "Operaciones", "WR %", "R total",
      "Expectancy R/op", "Caída máx. R", "Origen alertas"
    ],
    rows,
    forward_vs_backtest: localSnapshot?.forward_vs_backtest || null
  };
}

async function fetchFromGoogleApi(apiKey) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchGet?ranges=Detalle!A1:Z500&ranges=Curvas%20PnL!A1:ZZ50&key=${apiKey}`;
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`Google API returned ${res.status}`);
  const data = await res.json();
  const ranges = data.valueRanges || [];
  const detalle = ranges[0]?.values || [];
  const curvas = ranges[1]?.values || [];
  return processGridData(detalle, curvas);
}

async function fetchFromGoogleCsv() {
  const detUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=Detalle`;
  const curUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=Curvas%20PnL`;

  const [resDet, resCur] = await Promise.all([
    fetch(detUrl),
    fetch(curUrl)
  ]);

  if (!resDet.ok || !resCur.ok) {
    throw new Error(`CSV export failed: Detalle ${resDet.status}, Curvas ${resCur.status}`);
  }

  const textDet = await resDet.text();
  const textCur = await resCur.text();

  const detalleRows = parseCSV(textDet);
  const curvasRows = parseCSV(textCur);

  return processGridData(detalleRows, curvasRows);
}

function loadLocalSnapshot() {
  if (localSnapshot && Array.isArray(localSnapshot.rows) && localSnapshot.rows.length > 0) {
    return { ...localSnapshot, source: "snapshot_fallback" };
  }
  const candidates = [
    path.join(__dirname, "snapshot.json"),
    path.join(__dirname, "..", "data", "dashboard_data.json"),
    path.join(process.cwd(), "data", "dashboard_data.json"),
    path.join(process.cwd(), "public", "data", "dashboard_data.json")
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const raw = JSON.parse(fs.readFileSync(p, "utf8"));
        return { ...raw, source: "snapshot_fallback" };
      } catch (_) {}
    }
  }
  return { updated_at: new Date().toISOString(), rows: [] };
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");

  // 1. Si hay GOOGLE_API_KEY configurada en Vercel
  if (GOOGLE_API_KEY) {
    try {
      const data = await fetchFromGoogleApi(GOOGLE_API_KEY);
      data.source = "google_sheets_api";
      return res.status(200).json(data);
    } catch (e) {
      console.warn("[Data API] Falló Google API v4:", e.message);
    }
  }

  // 2. Intento de lectura vía CSV Export público (con la planilla compartida)
  try {
    const data = await fetchFromGoogleCsv();
    if (data && Array.isArray(data.rows) && data.rows.length > 0) {
      data.source = "google_sheets_csv";
      return res.status(200).json(data);
    }
  } catch (e) {
    console.warn("[Data API] Falló CSV Export de Google Sheets:", e.message);
  }

  // 3. Fallback de alta disponibilidad a snapshot empaquetado (100% de disponibilidad)
  try {
    const fallback = loadLocalSnapshot();
    return res.status(200).json(fallback);
  } catch (e) {
    return res.status(500).json({ error: "No se pudieron obtener datos del dashboard", details: e.message });
  }
};
