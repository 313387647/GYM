const { LifeRepository } = require('../repositories/lifeRepository');
const { idempotent } = require('./serviceHelpers');
const { stableId } = require('../utils/id');

class LifeService {
  constructor({ db }) { this.db = db; this.repository = new LifeRepository(db); }
  logSleep(input) {
    return idempotent(this.db, input.actionKey, 'log_sleep', () => ({ success: true, sleep: this.repository.upsertSleep(input) }));
  }
  logCheckin(input) {
    return idempotent(this.db, input.actionKey, 'log_checkin', () => ({ success: true, checkin: this.repository.insertCheckin(input) }));
  }
  upsertTemporaryEvent(input) {
    return idempotent(this.db, input.actionKey, 'upsert_temporary_event', () => ({ success: true, event: this.repository.upsertTemporaryEvent({ ...input, id: input.id || stableId('tmp', input.logicalDate, input.eventType, input.description) }) }));
  }
}
module.exports = { LifeService };
