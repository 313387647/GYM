const { idempotent } = require('./serviceHelpers');
class ScheduleMutationService {
  constructor({ db, scheduleRepository }) { this.db = db; this.repository = scheduleRepository; }
  updateRule(input) {
    return idempotent(this.db, input.actionKey, 'update_schedule_rule', () => {
      const rule = this.repository.update(input.ruleId, input, input.now);
      if (!rule) { const error = new Error('Schedule rule not found'); error.code = 'SCHEDULE_RULE_NOT_FOUND'; throw error; }
      return { success: true, schedule_rule: rule };
    });
  }
}
module.exports = { ScheduleMutationService };
