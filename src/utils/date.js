// src/utils/date.js — 逻辑日期（06:00 刷新）
const TRAINING_SCHEDULE = {
    monday:    ['upper_a',  'Upper A (Push Focus)'],
    wednesday: ['lower',    'Lower (Legs + Core)'],
    friday:    ['upper_b',  'Upper B (Pull + Shoulder Focus)'],
};

const WEEKDAY_CN = {
    monday: '周一', tuesday: '周二', wednesday: '周三',
    thursday: '周四', friday: '周五', saturday: '周六', sunday: '周日',
};

function pad(n) { return String(n).padStart(2, '0'); }

function getLogicalDate(now = new Date()) {
    const logical = new Date(now);
    if (logical.getHours() < 6) {
        logical.setDate(logical.getDate() - 1);
    }
    return {
        logical_date: `${logical.getFullYear()}-${pad(logical.getMonth()+1)}-${pad(logical.getDate())}`,
        weekday: logical.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase(),
        is_training_day: false,  // caller fills
    };
}

function getWeekdayCN(weekday) {
    return WEEKDAY_CN[weekday] || weekday;
}

function getTrainingInfo(weekday) {
    return TRAINING_SCHEDULE[weekday] || null;
}

function isTrainingDay(weekday) {
    return weekday in TRAINING_SCHEDULE;
}

// 检测是否凌晨时段
function isDawn(hour) {
    return hour >= 0 && hour < 6;
}

// 如果直接执行，输出逻辑日期
if (require.main === module) {
    const now = new Date();
    const { logical_date, weekday } = getLogicalDate(now);
    const training = getTrainingInfo(weekday);
    console.log(JSON.stringify({
        now: now.toISOString(),
        logical_date,
        weekday,
        weekday_cn: getWeekdayCN(weekday),
        is_dawn: isDawn(now.getHours()),
        is_training_day: !!training,
        training_type: training ? training[0] : null,
        training_name: training ? training[1] : null,
    }, null, 2));
}

module.exports = { getLogicalDate, getWeekdayCN, getTrainingInfo, isTrainingDay, isDawn };
