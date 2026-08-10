#!/usr/bin/env node
const { migrate } = require('../db/migrate');
const { createContainer } = require('../container');
const { createId } = require('../utils/id');

function fail(message) { console.error(JSON.stringify({ success: false, error: message })); process.exit(1); }
const args = process.argv.slice(2).filter((arg) => arg !== '--json');
const [logicalDate, mealType, itemInput, calories, protein, carbs, fat] = args;
if (!/^\d{4}-\d{2}-\d{2}$/.test(logicalDate || '') || !mealType || !itemInput) fail('用法: <date> <meal> <name|json-array> [calories protein carbs fat]');
let items;
try {
  items = itemInput.trim().startsWith('[') ? JSON.parse(itemInput) : [{ name: itemInput, calories: Number(calories), protein_g: Number(protein), carbs_g: carbs == null ? null : Number(carbs), fat_g: fat == null ? null : Number(fat) }];
} catch (error) { fail(`食物 JSON 无效: ${error.message}`); }
if (!items.every((item) => item.name && Number.isFinite(Number(item.calories)) && Number.isFinite(Number(item.protein_g)))) fail('食物名称、热量和蛋白不能为空');
migrate();
const container = createContainer();
const result = container.services.mealService.logMeal({ actionKey: createId('cli-meal'), logicalDate, mealType, items: items.map((item) => ({ ...item, calories: Number(item.calories), protein_g: Number(item.protein_g) })), sourceEventId: null, recordedAt: new Date().toISOString() });
console.log(JSON.stringify(result, null, 2));
