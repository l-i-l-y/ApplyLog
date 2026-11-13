const { REMINDER_TYPES } = require('./constants')
const { toDateInput, toTimeInput } = require('./date')

const REMINDER_LIMITS = Object.freeze({ location: 100, link: 500, note: 500 })
function newReminderForm() {
  const halfHour = 30 * 60 * 1000
  const time = Math.ceil((Date.now() + 60000) / halfHour) * halfHour
  return { type: 'interview', date: toDateInput(time), time: toTimeInput(time), roundIndex: 0, location: '', link: '', note: '' }
}

function reminderFields(input, original) {
  const { type, time } = input
  if (!REMINDER_TYPES.some(option => option.id === type)) throw new Error('请选择提醒类型')
  if (typeof time !== 'number' || !Number.isFinite(new Date(time).getTime()) ||
      ((!original || time !== original.time) && time <= Date.now())) throw new Error('请选择未来的提醒时间')
  const fields = { type, time, round: type === 'interview' && typeof input.round === 'string' ? input.round.trim() : '' }
  for (const field of Object.keys(REMINDER_LIMITS)) {
    const value = typeof input[field] === 'string' ? input[field].trim() : ''
    if (value.length > REMINDER_LIMITS[field]) throw new Error('提醒' + ({location:'地点',link:'链接',note:'备注'})[field] + '不能超过 ' + REMINDER_LIMITS[field] + ' 字')
    fields[field] = value
  }
  return fields
}
module.exports = { newReminderForm, reminderFields, REMINDER_LIMITS }
