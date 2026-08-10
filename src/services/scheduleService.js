const { stableId } = require('../utils/id');
const { getLogicalTime, zonedDateTimeToUtc, weekdayForDate } = require('../utils/timezone');

class ScheduleService {
  constructor({ config, scheduleRepository, reminderRepository }) {
    Object.assign(this, { config, scheduleRepository, reminderRepository });
  }
  materialize(now = new Date()) {
    const time = getLogicalTime(now, { timezone: this.config.timezone, cutoffHour: this.config.logicalDayCutoffHour });
    const calendarWeekday = weekdayForDate(time.local_date);
    const created = [];
    for (const rule of this.scheduleRepository.enabledRules()) {
      if (rule.weekdays && !rule.weekdays.includes(calendarWeekday)) continue;
      const scheduledAt = zonedDateTimeToUtc(`${time.local_date}T${rule.local_time}:00`, this.config.timezone).toISOString();
      const id = stableId('rem', rule.id, time.local_date);
      const reminder = this.reminderRepository.create({
        id, ruleId: rule.id, eventType: rule.event_type, scheduledAt,
        payload: { ...rule.payload, logical_date: time.local_date }, now: now.toISOString(),
      });
      created.push(reminder);
    }
    return created;
  }
}
module.exports = { ScheduleService };
