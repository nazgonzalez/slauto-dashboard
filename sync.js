/**
 * SL AUTO · Quant & Backtest Hub
 * Vercel Serverless Function: /api/sync
 */

const dataHandler = require("./data.js");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  try {
    // Forzar re-ejecución del pipeline de datos
    await dataHandler(req, {
      setHeader: () => {},
      status: (code) => ({
        json: (data) => {
          res.status(code).json({
            ok: true,
            message: "Sincronización con Google Sheets completada",
            source: data.source,
            updated_at: data.updated_at,
            rows_count: data.rows?.length || 0
          });
        }
      })
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
