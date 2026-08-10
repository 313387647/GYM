module.exports = {
  version: 1,
  name: 'initial_v1_schema',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS weight_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        logical_date TEXT NOT NULL UNIQUE,
        weight_kg REAL NOT NULL,
        recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS meals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        logical_date TEXT NOT NULL,
        meal_type TEXT NOT NULL,
        item_name TEXT NOT NULL,
        amount TEXT,
        calories REAL NOT NULL,
        protein_g REAL NOT NULL,
        carbs_g REAL,
        fat_g REAL,
        recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_meals_date ON meals(logical_date);
      CREATE TABLE IF NOT EXISTS workouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        logical_date TEXT NOT NULL,
        workout_type TEXT NOT NULL,
        workout_name TEXT,
        total_duration_min REAL,
        cardio_done_min INTEGER DEFAULT 0,
        cardio_target_min INTEGER DEFAULT 20,
        calories_burned_kcal REAL,
        avg_heart_rate_bpm INTEGER,
        heart_rate_range TEXT,
        location TEXT,
        rpe_score INTEGER,
        grade TEXT,
        notes TEXT,
        recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(logical_date);
      CREATE TABLE IF NOT EXISTS exercise_sets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workout_id INTEGER NOT NULL REFERENCES workouts(id),
        exercise_name TEXT NOT NULL,
        set_number INTEGER NOT NULL,
        reps INTEGER,
        weight_kg REAL,
        is_warmup INTEGER DEFAULT 0,
        notes TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sets_workout ON exercise_sets(workout_id);
      CREATE TABLE IF NOT EXISTS daily_summary (
        logical_date TEXT PRIMARY KEY,
        weight_kg REAL,
        steps INTEGER,
        sleep_hours REAL,
        water_intake_ml INTEGER DEFAULT 0,
        training_completed INTEGER DEFAULT 0,
        daily_grade TEXT,
        rpe_score INTEGER,
        notes TEXT
      );
      CREATE TABLE IF NOT EXISTS daily_state (
        logical_date TEXT PRIMARY KEY,
        calorie_status TEXT,
        protein_status TEXT,
        consistency_status TEXT,
        weight_status TEXT,
        training_status TEXT,
        risk_level TEXT,
        main_task_today TEXT,
        tone_strategy TEXT,
        coach_action TEXT,
        avoid TEXT,
        context_summary TEXT,
        updated_at TEXT DEFAULT (datetime('now','localtime'))
      );
    `);
  },
};
