#!/usr/bin/env node
const { migrate } = require('../db/migrate');
const { createContainer } = require('../container');
const { getLogicalDate } = require('../utils/date');
const { createId } = require('../utils/id');
const args = process.argv.slice(2);
const value = args.includes('--weight') ? args[args.indexOf('--weight') + 1] : args.find((arg) => Number.isFinite(Number(arg)));
const date = args.includes('--date') ? args[args.indexOf('--date') + 1] : getLogicalDate().logical_date;
const notes = args.includes('--note') ? args[args.indexOf('--note') + 1] : null;
if (!Number.isFinite(Number(value)) || Number(value) < 30 || Number(value) > 350) { console.error(JSON.stringify({ success: false, error: '需要 30-350kg 的有效体重' })); process.exit(1); }
migrate();
const result = createContainer().services.weightService.logWeight({ actionKey: createId('cli-weight'), logicalDate: date, weightKg: Number(value), notes, recordedAt: new Date().toISOString() });
console.log(JSON.stringify(result, null, 2));
