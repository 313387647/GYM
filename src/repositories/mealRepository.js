class MealRepository {
  constructor(db) { this.db = db; }

  insertMany({ logicalDate, mealType, items, sourceEventId, sourceMessageId, imageHash, recordedAt }) {
    const insert = this.db.prepare(`INSERT INTO meals
      (logical_date, meal_type, item_name, amount, calories, protein_g, carbs_g, fat_g,
       recorded_at, source_event_id, source_message_id, image_hash, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    return items.map((item) => Number(insert.run(
      logicalDate, mealType, item.name, item.amount ?? null, item.calories, item.protein_g,
      item.carbs_g ?? null, item.fat_g ?? null, recordedAt, sourceEventId ?? null,
      sourceMessageId ?? null, imageHash ?? null,
      JSON.stringify({ confidence: item.confidence || null }),
    ).lastInsertRowid));
  }

  totals(logicalDate) {
    return this.db.prepare(`SELECT COUNT(*) item_count, COALESCE(SUM(calories),0) calories,
      COALESCE(SUM(protein_g),0) protein_g, COALESCE(SUM(carbs_g),0) carbs_g,
      COALESCE(SUM(fat_g),0) fat_g FROM meals WHERE logical_date=?`).get(logicalDate);
  }

  listByDate(logicalDate) {
    return this.db.prepare(`SELECT id, meal_type, item_name name, amount, calories, protein_g,
      carbs_g, fat_g, recorded_at FROM meals WHERE logical_date=? ORDER BY recorded_at, id`).all(logicalDate);
  }

  latestDate() { return this.db.prepare('SELECT MAX(logical_date) logical_date FROM meals').get()?.logical_date || null; }

  getImageIngestion(imageHash) {
    const row = this.db.prepare('SELECT * FROM image_ingestions WHERE image_hash=?').get(imageHash);
    return row ? { ...row, meal_ids: JSON.parse(row.meal_ids_json) } : null;
  }

  saveImageIngestion({ imageHash, sourceMessageId, sourceEventId, mealIds, createdAt }) {
    this.db.prepare(`INSERT INTO image_ingestions
      (image_hash, source_message_id, source_event_id, meal_ids_json, created_at)
      VALUES (?, ?, ?, ?, ?)`    ).run(imageHash, sourceMessageId ?? null, sourceEventId, JSON.stringify(mealIds), createdAt);
  }
}

module.exports = { MealRepository };
