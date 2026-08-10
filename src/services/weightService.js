const { WeightRepository } = require('../repositories/weightRepository');
const { idempotent } = require('./serviceHelpers');

class WeightService {
  constructor({ db }) { this.db = db; this.repository = new WeightRepository(db); }
  logWeight(input) {
    return idempotent(this.db, input.actionKey, 'log_weight', () => {
      const row = this.repository.upsert(input);
      return { success: true, entry: row, trend: this.trend() };
    });
  }
  trend() {
    const rows = this.repository.recent(14);
    const latest7 = rows.slice(0, 7);
    const previous7 = rows.slice(7, 14);
    const average = (list) => list.length ? Math.round(list.reduce((sum, row) => sum + row.weight_kg, 0) / list.length * 100) / 100 : null;
    const current = average(latest7);
    const previous = average(previous7);
    return { latest: rows[0]?.weight_kg ?? null, average_7d: current, previous_average_7d: previous, change: current != null && previous != null ? Math.round((current - previous) * 100) / 100 : null, data_days: latest7.length };
  }
}
module.exports = { WeightService };
