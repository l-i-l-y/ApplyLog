
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function pad(value) {
  return value < 10 ? '0' + value : String(value)
}

function toDateInput(timestamp) {
  const date = new Date(timestamp)
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

function toTimeInput(timestamp) {
  const date = new Date(timestamp)
  return pad(date.getHours()) + ':' + pad(date.getMinutes())
}

function parseDate(dateText, timeText = '00:00') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !/^\d{2}:\d{2}$/.test(timeText)) return null
  const [year, month, day] = dateText.split('-').map(Number)
  const [hour, minute] = timeText.split(':').map(Number)
  const timestamp = new Date(year, month - 1, day, hour, minute).getTime()
  if (toDateInput(timestamp) !== dateText || toTimeInput(timestamp) !== timeText) return null
  return timestamp
}

function dayStart(timestamp) {
  return new Date(timestamp).setHours(0, 0, 0, 0)
}

function addDays(timestamp, days) {
  const date = new Date(timestamp)
  return date.setDate(date.getDate() + days)
}

function startOfWeek(timestamp) {
  const day = dayStart(timestamp)
  const weekday = new Date(day).getDay()
  return addDays(day, -((weekday + 6) % 7))
}

function formatDay(timestamp, now = Date.now()) {
  const day = dayStart(timestamp)
  const today = dayStart(now)
  if (day === today) return '今天'
  if (day === addDays(today, 1)) return '明天'
  if (day === addDays(today, -1)) return '昨天'
  const dateText = toDateInput(timestamp)
  return new Date(timestamp).getFullYear() === new Date(now).getFullYear() ? dateText.slice(5) : dateText
}

function formatSchedule(timestamp, now = Date.now()) {
  const day = dayStart(timestamp)
  const today = dayStart(now)
  const dayLabel = day > addDays(today, 1) && day < addDays(today, 7)
    ? '周' + WEEKDAYS[new Date(timestamp).getDay()]
    : formatDay(timestamp, now)
  return dayLabel + ' ' + toTimeInput(timestamp)
}

function homeDate(timestamp) {
  const date = new Date(timestamp)
  return (date.getMonth() + 1) + '月' + date.getDate() + '日 · 周' + WEEKDAYS[date.getDay()]
}

module.exports = { toDateInput, toTimeInput, parseDate, dayStart, addDays, startOfWeek, formatDay, formatSchedule, homeDate }
