/**
 * SL AUTO · Quant & Backtest Hub
 * Vercel Serverless Function: /api/config
 */

const DEFAULT_UI_CONFIG = {
  theme: "dark",
  accentColor: "#007aff",
  density: "compact",
  fontScale: 85,
  showQuantMetrics: false,
  defaultModo: "ALL",
  columnOrder: [
    "estrategia", "variante", "sl", "tp", "modo",
    "operaciones", "wr", "r_total", "expectancy",
    "dd_max", "origen", "pf", "sharpe", "sortino", "calmar"
  ],
  visibleColumns: [
    "estrategia", "variante", "sl", "tp", "modo",
    "operaciones", "wr", "r_total", "expectancy",
    "dd_max", "origen"
  ],
  pinnedCurves: ["row_3", "row_40", "row_68", "row_79"],
  strategyNotes: {
    "Machos BB+RSI": "• En vivo: F inverso SL 1,5 ATR + 50% a 1R + BOS M5 (Modo A 2L+2S).\n• Pendiente probar: trailing BOS M1 vs M5 en vivo; rebote con cierre M5, divergencias RSI 7, muro de libro y S/R H4.",
    "Oráculo 2 a 1": "• En vivo: O2 (SL 2%, a +3% bloquea +2% y persigue a 2%, dist ≤ 3%, Modo A 2L+2S).\n• Pendiente probar: O3 (confirmación con muro de libro L2 histórico real) y trailing por BOS M1/M5.",
    "SL AUTO": "• En vivo: Escalera x,2x,6x con corte en 4ª recompra, TP +1% prom., Modo A (2L+2S).\n• Pendiente probar: dejar correr ganadoras con trailing BOS tras +1% prom., filtro ADX/ATR, time-stop y BE 1,3R.",
    "Calculadora": "• Escalera de 6 recompras (x1,4) hasta 13,4% de distancia.\n• Pendiente evaluar: combinar corte en 4ª recompra con salida parcial + BOS.",
    "BB+RSI 5m": "• Señal directa BB+RSI (sin invertir): solo rinde positivo con parcial 50% a 1R + BOS M5 (SL 2%).\n• La versión invertida (Machos F inverso) la supera ampliamente.",
    "2m": "• Entradas SHOCK Oráculo con SL corto (0,5%–1,7%).\n• Solo dio positivo en Modo C con SL 1,7% y stop en ganancias (1R → 1R).",
    "DCA libro": "• Acumulación sobre muros de libro L2 de Binance.\n• En recolección de historial para muestra larga."
  }
};

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (_) {}
    }
    return res.status(200).json({ ...DEFAULT_UI_CONFIG, ...(body || {}) });
  }

  return res.status(200).json(DEFAULT_UI_CONFIG);
};
