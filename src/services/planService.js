const fs = require('node:fs');
const { loadConfig } = require('../config');

class PlanService {
  constructor({ weightRepository, planPath } = {}) {
    this.weightRepository = weightRepository;
    this.planPath = planPath || loadConfig().planPath;
  }
  getPlan() { return JSON.parse(fs.readFileSync(this.planPath, 'utf8')); }
  getPhase() {
    const plan = this.getPlan();
    const weight = this.weightRepository?.latest()?.weight_kg;
    const phases = Object.entries(plan.phases || {});
    let selected = plan.phase && plan.phases[plan.phase] ? plan.phase : phases[0]?.[0];
    if (weight != null) {
      for (const [name, phase] of phases) {
        if (weight <= phase.target_kg) selected = name;
      }
    }
    return { name: selected, ...plan.phases[selected] };
  }
  getTargets() {
    const phase = this.getPhase();
    return { phase: phase.name, target_kg: phase.target_kg, calories: phase.daily_calories, protein_g: phase.macros.protein_g, macros: phase.macros };
  }
  getTrainingForWeekday(weekday) {
    const plan = this.getPlan();
    const phase = this.getPhase();
    const schedule = phase.training?.schedule || plan.phases?.phase_1?.training?.schedule || {};
    const type = schedule[weekday] || null;
    return type ? { planned: true, type, name: plan.workouts?.[type]?.name || type, workout: plan.workouts?.[type] || null } : { planned: false, type: null, name: null, workout: null };
  }
}
module.exports = { PlanService };
