const { MemoryRepository } = require('../repositories/memoryRepository');
const { idempotent } = require('./serviceHelpers');
const { stableId } = require('../utils/id');

class MemoryService {
  constructor({ db }) { this.db = db; this.repository = new MemoryRepository(db); }
  remember(input) {
    return idempotent(this.db, input.actionKey, 'remember', () => ({ success: true, memory: this.repository.upsert({ ...input, id: stableId('mem', input.type, input.key), now: input.now || new Date().toISOString() }) }));
  }
}
module.exports = { MemoryService };
