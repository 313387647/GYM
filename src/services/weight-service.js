const { withDb } = require('../db/db');

function logWeight({ date, weightKg, note }) {
  return withDb(db => {
    const previous = db.prepare('SELECT weight_kg FROM weight_logs ORDER BY date DESC, id DESC LIMIT 1').get();
    db.prepare('INSERT INTO weight_logs(date, weight_kg, note) VALUES (?, ?, ?)').run(date, weightKg, note || null);
    const rows = db.prepare('SELECT weight_kg FROM weight_logs ORDER BY date DESC, id DESC LIMIT 7').all();
    const avg7 = rows.length ? rows.reduce((sum, row) => sum + row.weight_kg, 0) / rows.length : null;
    return {
      weightKg,
      previousWeight: previous ? previous.weight_kg : null,
      delta: previous ? Number((weightKg - previous.weight_kg).toFixed(1)) : null,
      avg7
    };
  });
}

function getLastWeight() {
  return withDb(db => db.prepare('SELECT * FROM weight_logs ORDER BY date DESC, id DESC LIMIT 1').get() || null);
}

function getWeightTrend({ days = 7 }) {
  return withDb(db => db.prepare('SELECT * FROM weight_logs ORDER BY date DESC, id DESC LIMIT ?').all(days));
}

function getWeightSummary(date) {
  return withDb(db => db.prepare('SELECT * FROM weight_logs WHERE date = ? ORDER BY id DESC LIMIT 1').get(date) || null);
}

module.exports = { logWeight, getLastWeight, getWeightTrend, getWeightSummary };
