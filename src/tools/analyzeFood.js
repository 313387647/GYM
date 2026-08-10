#!/usr/bin/env node
const { migrate } = require('../db/migrate');
const { createContainer } = require('../container');
const { getLogicalDate } = require('../utils/date');
const { createId } = require('../utils/id');
const args = process.argv.slice(2);
const read = (flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
const image = read('--image') || args.find((arg) => !arg.startsWith('--'));
if (!image) { console.error(JSON.stringify({ success: false, error: '需要 --image <path>' })); process.exit(1); }
migrate();
const container = createContainer();
(async () => {
  const analysis = await container.foodVision.analyze(image);
  if (!analysis.is_food) return console.log(JSON.stringify({ success: false, reason: 'not_food', analysis }, null, 2));
  if (analysis.confidence === 'low' || analysis.needs_clarification) return console.log(JSON.stringify({ success: false, reason: 'needs_clarification', analysis }, null, 2));
  const eventId = createId('cli-image');
  const result = container.services.mealService.logMeal({ actionKey: `${eventId}:image`, logicalDate: read('--date') || getLogicalDate().logical_date, mealType: read('--meal') || 'other', items: analysis.items, sourceEventId: eventId, sourceMessageId: eventId, imageHash: analysis.image_hash, recordedAt: new Date().toISOString() });
  console.log(JSON.stringify({ success: true, analysis, result }, null, 2));
})().catch((error) => { console.error(JSON.stringify({ success: false, error: error.code || error.message })); process.exitCode = 1; });
