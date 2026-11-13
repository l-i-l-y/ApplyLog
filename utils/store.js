
const {
  STATUS, STATUSES, STATUS_BY_ID, ACTIVE_STATUSES, CLOSED_STATUSES, REPLY_STATUSES,
  CHANNELS, INTERVIEW_ROUNDS, REMINDER_TYPES, isDemoId
} = require('./constants')
const { dayStart, addDays, startOfWeek } = require('./date')
const { buildDemo } = require('./demo')

const STORAGE_KEY = 'applylog-data'
const VERSION = 1

function readRaw() {
  let data
  try {
    data = wx.getStorageSync(STORAGE_KEY)
  } catch (error) {
    throw new Error('读取本地数据失败，请重试')
  }
  if (data === '' || data == null) return { version: VERSION, applications: [] }
  return data
}

function read() {
  const data = readRaw()
  if (data.version !== VERSION) throw new Error('本地数据版本无法读取')
  if (!Array.isArray(data.applications)) throw new Error('本地数据格式异常')
  const ids = new Set()
  for (const record of data.applications) {
    if (!validApplication(record) || ids.has(record.id)) {
      throw new Error('本地记录格式异常，请先到「我的」导出原始 JSON 备份')
    }
    ids.add(record.id)
  }
  return data
}

function write(data, applications) {
  try {
    wx.setStorageSync(STORAGE_KEY, { ...data, version: VERSION, applications })
  } catch (error) {
    throw new Error('保存失败，请检查手机存储空间后重试')
  }
}

function makeId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12)
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(new Date(value).getTime())
}

function hasStrings(value, fields) {
  return value && fields.every(field => typeof value[field] === 'string')
}

function uniqueItems(items, validate) {
  if (!Array.isArray(items)) return false
  const ids = new Set()
  return items.every(item => {
    if (!item || !clean(item.id) || ids.has(item.id) || !validate(item)) return false
    ids.add(item.id)
    return true
  })
}

function validApplication(record) {
  return hasStrings(record, ['id', 'company', 'position']) && clean(record.id) &&
    clean(record.company) && clean(record.position) && Boolean(STATUS_BY_ID[record.status]) &&
    isTimestamp(record.appliedAt) && isTimestamp(record.createdAt) && isTimestamp(record.updatedAt) &&
    ['channel', 'city', 'salary', 'jdLink', 'note'].every(field => record[field] === undefined || typeof record[field] === 'string') &&
    Array.isArray(record.timeline) && record.timeline.length > 0 &&
    record.timeline.every(entry => entry && STATUS_BY_ID[entry.status] && isTimestamp(entry.time) &&
      (entry.note === undefined || typeof entry.note === 'string')) &&
    uniqueItems(record.reminders, item => REMINDER_TYPES.some(type => type.id === item.type) &&
      isTimestamp(item.time) && typeof item.done === 'boolean' &&
      ['round', 'location', 'link', 'note'].every(field => item[field] === undefined || typeof item[field] === 'string') &&
      ['calendarAddedAt', 'calendarPendingAt'].every(field => item[field] === undefined || isTimestamp(item[field]))) &&
    uniqueItems(record.interviews, item => INTERVIEW_ROUNDS.includes(item.round) && isTimestamp(item.date) &&
      Number.isInteger(item.selfScore) && item.selfScore >= 1 && item.selfScore <= 5 &&
      (item.reflection === undefined || typeof item.reflection === 'string') &&
      Array.isArray(item.questions) && item.questions.every(question => hasStrings(question, ['q', 'myAnswer'])))
}

function validateStatus(status) {
  if (!STATUS_BY_ID[status]) throw new Error('请选择有效的投递状态')
  return status
}

function applicationFields(input, now) {
  const company = clean(input.company)
  const position = clean(input.position)
  if (!company) throw new Error('请填写公司名称')
  if (!position) throw new Error('请填写岗位名称')
  const appliedAt = input.appliedAt === undefined ? dayStart(now) : input.appliedAt
  if (!isTimestamp(appliedAt) || dayStart(appliedAt) > dayStart(now)) {
    throw new Error('请选择有效的投递日期')
  }
  const channel = clean(input.channel)
  if (channel && !CHANNELS.includes(channel)) throw new Error('请选择有效的投递渠道')
  return {
    company, position, channel, appliedAt: dayStart(appliedAt),
    city: clean(input.city), salary: clean(input.salary), jdLink: clean(input.jdLink), note: clean(input.note)
  }
}

function filterApplications(applications, { query = '', status = 'all' } = {}) {
  const needle = clean(query).toLowerCase()
  const matchingStatuses = status === 'active' ? ACTIVE_STATUSES
    : status === 'closed' ? CLOSED_STATUSES : [status]
  return applications.filter(record => {
    if (status !== 'all' && !matchingStatuses.includes(record.status)) return false
    return !needle || record.company.toLowerCase().includes(needle) || record.position.toLowerCase().includes(needle)
  }).sort((a, b) => b.appliedAt - a.appliedAt || b.createdAt - a.createdAt)
}

function create(input) {
  const data = read()
  const now = Date.now()
  const status = validateStatus(input.status === undefined ? STATUS.SUBMITTED : input.status)
  const record = {
    ...applicationFields(input, now),
    id: makeId(), status, timeline: [{ status, time: now, note: '' }],
    reminders: [], interviews: [], createdAt: now, updatedAt: now
  }
  write({ ...data, lastUsedChannel: record.channel, lastUsedCity: record.city }, [record, ...data.applications])
  return record
}

function updateRecord(id, transform) {
  const data = read()
  const { applications } = data
  const index = applications.findIndex(record => record.id === id)
  if (index < 0) throw new Error('这条投递记录已不存在')
  const previous = applications[index]
  const now = Date.now()
  const changes = transform(previous, now)
  if (!changes) return previous
  const record = { ...previous, ...changes, updatedAt: now }
  const next = applications.slice()
  next[index] = record
  // 编辑旧数据前固定原有城市偏好，避免回退值随这次编辑改变。
  write(typeof data.lastUsedCity === 'string' ? data : { ...data, lastUsedCity: lastCity(data) }, next)
  return record
}

function statusChanges(record, status, note, now) {
  validateStatus(status)
  if (status === record.status) return null
  return { status, timeline: record.timeline.concat({ status, time: now, note: clean(note) }) }
}

function update(id, patch) {
  return updateRecord(id, (record, now) => ({
    ...applicationFields({ ...record, ...patch }, now),
    // 未修改的历史薪资保留原始文本；新输入继续使用统一清理规则。
    ...(typeof record.salary === 'string' && (patch.salary === undefined || patch.salary === record.salary)
      ? { salary: record.salary } : {}),
    ...(patch.status === undefined ? {} : statusChanges(record, patch.status, patch.statusNote, now))
  }))
}

function remove(id) {
  const data = read()
  const { applications } = data
  const remaining = applications.filter(record => record.id !== id)
  if (remaining.length === applications.length) return false
  write(data, remaining)
  return true
}

function changeStatus(id, status, note = '') {
  return updateRecord(id, (record, now) => statusChanges(record, status, note, now))
}

function addReminder(id, input) {
  const { type, time } = input
  if (!REMINDER_TYPES.some(option => option.id === type)) throw new Error('请选择提醒类型')
  if (!isTimestamp(time) || time <= Date.now()) throw new Error('请选择未来的提醒时间')
  const reminder = {
    id: makeId(), type, time, round: type === 'interview' ? clean(input.round) : '',
    location: clean(input.location), link: clean(input.link), note: clean(input.note), done: false
  }
  updateRecord(id, record => ({ reminders: record.reminders.concat(reminder) }))
  return reminder
}

function changeReminder(id, reminderId, transform) {
  const record = updateRecord(id, previous => {
    const index = previous.reminders.findIndex(item => item.id === reminderId)
    if (index < 0) throw new Error('这条提醒已不存在')
    const next = previous.reminders.slice()
    const replacement = transform(next[index])
    if (replacement) next[index] = replacement
    else next.splice(index, 1)
    return { reminders: next }
  })
  return record.reminders.find(item => item.id === reminderId) || null
}

function toggleReminder(id, reminderId) {
  return changeReminder(id, reminderId, reminder => ({ ...reminder, done: !reminder.done }))
}

function removeReminder(id, reminderId) {
  changeReminder(id, reminderId, () => null)
}

function markReminderCalendar(id, reminderId) {
  return changeReminder(id, reminderId, reminder => {
    const { calendarPendingAt, ...rest } = reminder
    return { ...rest, calendarAddedAt: Date.now() }
  })
}

function setReminderCalendarPending(id, reminderId, pending) {
  return changeReminder(id, reminderId, reminder => {
    const { calendarPendingAt, ...rest } = reminder
    return pending ? { ...rest, calendarPendingAt: Date.now() } : rest
  })
}

function clearReminderCalendar(id, reminderId) {
  return changeReminder(id, reminderId, reminder => {
    const { calendarPendingAt, calendarAddedAt, ...rest } = reminder
    return rest
  })
}

function interviewFields(input) {
  const { round, date, selfScore } = input
  if (!INTERVIEW_ROUNDS.includes(round)) throw new Error('请选择面试轮次')
  if (!isTimestamp(date) || dayStart(date) > dayStart(Date.now())) throw new Error('请选择有效的面试日期')
  if (!Number.isInteger(selfScore) || selfScore < 1 || selfScore > 5) throw new Error('请选择 1 到 5 星评分')
  const questions = (input.questions || []).map(item => ({ ...item, q: clean(item.q), myAnswer: clean(item.myAnswer) }))
    .filter(item => item.q || item.myAnswer)
  if (questions.some(item => !item.q)) throw new Error('请补全已填写回答对应的问题')
  return { round, date: dayStart(date), questions, reflection: clean(input.reflection), selfScore }
}

function addInterview(id, input) {
  const interview = { id: makeId(), ...interviewFields(input) }
  updateRecord(id, record => ({ interviews: record.interviews.concat(interview) }))
  return interview
}

function updateInterview(id, interviewId, patch) {
  const record = updateRecord(id, previous => {
    const review = previous.interviews.find(item => item.id === interviewId)
    if (!review) throw new Error('这篇面试复盘已不存在')
    const edited = { ...review, ...interviewFields({ ...review, ...patch }) }
    return { interviews: previous.interviews.map(item => item.id === interviewId ? edited : item) }
  })
  return record.interviews.find(item => item.id === interviewId)
}

function summarize(applications, now) {
  const counts = {}
  STATUSES.forEach(status => { counts[status.id] = 0 })
  const monday = startOfWeek(now)
  const tomorrow = addDays(dayStart(now), 1)
  let weekAdded = 0
  let replyCount = 0
  let offerCount = 0
  let demoCount = 0
  applications.forEach(record => {
    counts[record.status] += 1
    if (isDemoId(record.id)) demoCount += 1
    if (record.appliedAt >= monday && record.appliedAt < tomorrow) weekAdded += 1
    const history = [record.status, ...record.timeline.map(entry => entry.status)]
    if (history.some(status => REPLY_STATUSES.includes(status))) replyCount += 1
    if (history.includes(STATUS.OFFER)) offerCount += 1
  })
  const total = applications.length
  return {
    total, counts, weekAdded, replyCount, offerCount, demoCount,
    replyRate: total ? Math.round(replyCount * 100 / total) : 0,
    offerRate: total ? Math.round(offerCount * 100 / total) : 0
  }
}

function reminderSchedule(applications, now) {
  const upcoming = []
  const overdue = []
  for (const record of applications) {
    for (const reminder of record.reminders) {
      if (reminder.done) continue
      const entry = { ...reminder, applicationId: record.id, company: record.company, position: record.position }
      if (reminder.time >= now) upcoming.push(entry)
      else overdue.push(entry)
    }
  }
  upcoming.sort((a, b) => a.time - b.time)
  overdue.sort((a, b) => b.time - a.time)
  return { upcoming, overdue }
}

function upcomingCount(applications, now) {
  let count = 0
  for (const { reminders } of applications) {
    for (const reminder of reminders) {
      if (!reminder.done && reminder.time >= now) count += 1
    }
  }
  return count
}

function latestRealApplication(applications) {
  let latest
  for (const record of applications) {
    if (!isDemoId(record.id) && (!latest || record.createdAt > latest.createdAt)) latest = record
  }
  return latest
}

function lastChannel(data) {
  if (data.lastUsedChannel === '' || CHANNELS.includes(data.lastUsedChannel)) return data.lastUsedChannel
  // 旧版没有偏好字段，从最近创建的一条非示例投递取值。
  const latest = latestRealApplication(data.applications)
  return latest && CHANNELS.includes(latest.channel) ? latest.channel : ''
}

function lastCity(data) {
  // 空字符串表示用户明确清空，只有缺少有效偏好时才使用旧记录回退。
  if (typeof data.lastUsedCity === 'string') return clean(data.lastUsedCity)
  const latest = latestRealApplication(data.applications)
  return latest ? clean(latest.city) : ''
}

// 同次刷新共用已校验的存储读取和同一个时间点。
function snapshot(now = Date.now()) {
  const data = read()
  const { applications } = data
  return {
    list: filter => filterApplications(applications, filter),
    get: id => applications.find(record => record.id === id) || null,
    stats: () => summarize(applications, now),
    reminderSchedule: () => reminderSchedule(applications, now),
    upcomingCount: () => upcomingCount(applications, now),
    lastChannel: () => lastChannel(data),
    lastCity: () => lastCity(data)
  }
}

function list(filter) {
  return snapshot().list(filter)
}

function get(id) {
  return snapshot().get(id)
}

function stats(now = Date.now()) {
  return snapshot(now).stats()
}

function upcoming(days = 7, now = Date.now()) {
  const { upcoming } = snapshot(now).reminderSchedule()
  if (days === Infinity) return upcoming
  const end = addDays(now, Math.max(0, days))
  return upcoming.filter(item => item.time <= end)
}

function seedDemo() {
  const data = read()
  const { applications } = data
  const existingIds = new Set(applications.map(record => record.id))
  const examples = buildDemo(Date.now()).filter(record => !existingIds.has(record.id))
  if (examples.length) write(data, applications.concat(examples))
  return examples.length
}

function removeDemo() {
  const data = read()
  const { applications } = data
  const remaining = applications.filter(record => !isDemoId(record.id))
  const removed = applications.length - remaining.length
  if (removed) write(data, remaining)
  return removed
}

function clear() {
  const { lastUsedChannel, lastUsedCity, ...data } = read()
  write(data, [])
}

module.exports = {
  snapshot, list, get, create, update, remove, changeStatus, addReminder, toggleReminder, removeReminder,
  markReminderCalendar, setReminderCalendarPending, clearReminderCalendar, addInterview, updateInterview, stats, upcoming,
  seedDemo, removeDemo, exportData: readRaw, clear
}
