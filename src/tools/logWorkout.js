#!/usr/bin/env node
const { migrate } = require('../db/migrate');
const { createContainer } = require('../container');
const { getLogicalDate } = require('../utils/date');
const { createId } = require('../utils/id');
const args = process.argv.slice(2);
const read = (flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
const type = read('--type');
if (!type) { console.error(JSON.stringify({ success: false, error: '需要 --type <workout_type>' })); process.exit(1); }
migrate();
const result = createContainer().services.workoutService.logWorkout({
  actionKey: createId('cli-workout'), logicalDate: read('--date') || getLogicalDate().logical_date,
  workoutType: type, rpeScore: read('--rpe') == null ? null : Number(read('--rpe')),
  totalDurationMin: read('--duration') == null ? null : Number(read('--duration')),
  cardioDoneMin: read('--cardio') == null ? 0 : Number(read('--cardio')),
  notes: read('--notes'), recordedAt: new Date().toISOString(),
});
console.log(JSON.stringify(result, null, 2));
