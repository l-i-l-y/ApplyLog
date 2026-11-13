const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')

const root = path.resolve(__dirname, '..')
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))

function environment(now = new Date(2026, 10, 13, 10).getTime()) {
  let stored = ''
  const calls = { reads: 0, writes: 0, toasts: [], modals: [], badges: [], calendar: [], sheets: [] }
  const wx = {
    getStorageSync: () => {
      calls.reads += 1
      if (calls.readError) throw new Error('read failure')
      return clone(stored)
    },
    setStorageSync: (_key, value) => {
      if (calls.writeError) throw new Error('disk full')
      stored = clone(value)
      calls.writes += 1
    },
    showToast: options => calls.toasts.push(options),
    showModal: options => calls.modals.push(options),
    showActionSheet: options => calls.sheets.push(options),
    setTabBarBadge: options => calls.badges.push(options.text),
    removeTabBarBadge: () => calls.badges.push(''),
    setClipboardData: options => { calls.clipboard = options.data; options.success() },
    navigateBack: options => calls.navigationError ? options.fail() : options.success(),
    switchTab: options => calls.navigationError ? options.fail() : options.success(),
    navigateTo: options => { calls.url = options.url },
    addPhoneCalendar: options => calls.calendar.push(options)
  }
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  const cache = new Map()
  function load(filename) {
    const absolute = path.resolve(root, filename)
    if (cache.has(absolute)) return cache.get(absolute)
    const module = { exports: {} }
    cache.set(absolute, module.exports)
    const context = {
      module, exports: module.exports, wx, Date: Clock, console, setTimeout, clearTimeout,
      getCurrentPages: () => [{}, {}],
      require: name => load(path.relative(root, path.resolve(path.dirname(absolute), name + '.js'))),
      Page: definition => { module.exports = definition }
    }
    vm.runInNewContext(fs.readFileSync(absolute, 'utf8'), context, { filename: absolute })
    cache.set(absolute, module.exports)
    return module.exports
  }
  function page(name, options = {}) {
    const definition = load(path.join('pages', name, name + '.js'))
    const instance = { ...definition, data: clone(definition.data) }
    instance.setData = (changes, done) => {
      for (const [key, value] of Object.entries(changes)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
        let target = instance.data
        for (const part of parts.slice(0, -1)) target = target[part]
        target[parts.at(-1)] = clone(value)
      }
      if (done) done()
    }
    if (instance.onLoad) instance.onLoad(options)
    instance.onShow()
    return instance
  }
  return {
    store: load('utils\\store.js'), date: load('utils\\date.js'), page, wx, calls, now,
    raw: () => clone(stored), inject: value => { stored = clone(value) },
    restart: () => { cache.clear(); return load('utils\\store.js') }
  }
}

const tap = (key, value) => ({ currentTarget: { dataset: { [key]: value } } })
const create = env => env.store.create({ company: 'Test company', position: 'Engineer' })

test('empty state, create/edit/restart, search and all status groups', () => {
  const env = environment()
  const home = env.page('index')
  assert.equal(home.data.total, 0)
  assert.equal(home.data.reminders.length, 0)
  const record = create(env)
  assert.equal(record.appliedAt, env.date.dayStart(env.now))
  env.store.update(record.id, { company: 'Long company name', position: 'Senior Engineer' })
  assert.equal(env.restart().get(record.id).company, 'Long company name')
  assert.equal(env.store.list({ query: ' SENIOR ' }).length, 1)
  for (const status of ['submitted', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn']) {
    env.store.changeStatus(record.id, status)
    assert.equal(env.store.list({ status }).length, 1)
    assert.equal(env.store.list({ status: 'active' }).length, ['submitted', 'assessment', 'interview'].includes(status) ? 1 : 0)
    assert.equal(env.store.list({ status: 'closed' }).length, ['rejected', 'withdrawn'].includes(status) ? 1 : 0)
  }
  home.onShow()
  assert.equal(home.data.total, 1)
  assert.equal(home.data.distribution.find(item => item.id === 'withdrawn').count, 1)
})

test('required fields, future/invalid dates and duplicate save', () => {
  const env = environment()
  const edit = env.page('edit')
  assert.equal(edit.data.form.date, env.date.toDateInput(env.now))
  edit.saveApplication()
  assert.equal(env.store.list().length, 0)
  assert.equal(edit.data.errors.company, true)
  assert.throws(() => env.store.create({ company: 'a', position: 'b', appliedAt: env.now + 86400000 }))
  assert.equal(env.date.parseDate('2026-02-30'), null)
  assert.equal(env.date.parseDate('2026-11-13', '24:00'), null)
  edit.setData({ 'form.company': 'a', 'form.position': 'b' })
  edit.saveApplication()
  edit.saveApplication()
  assert.equal(env.store.list().length, 1)
})

test('same status is a no-op; historical reply and Offer survive later changes', () => {
  const env = environment()
  const record = create(env)
  const writes = env.calls.writes
  env.store.changeStatus(record.id, 'submitted')
  assert.equal(env.calls.writes, writes)
  assert.equal(env.store.get(record.id).timeline.length, 1)
  env.store.changeStatus(record.id, 'interview', 'reply')
  env.store.changeStatus(record.id, 'offer')
  env.store.changeStatus(record.id, 'withdrawn')
  const summary = env.store.stats()
  assert.equal(summary.replyCount, 1)
  assert.equal(summary.offerCount, 1)
  assert.equal(summary.replyRate, 100)
  assert.equal(summary.counts.withdrawn, 1)
  const detail = env.page('detail', { id: record.id })
  assert.equal(detail.data.timeline[0].label, '已放弃')
  const mine = env.page('mine')
  assert.equal(mine.data.summary.offerRate, 100)
})

test('Monday boundary, Sunday and cross-week application dates', () => {
  const env = environment(new Date(2026, 10, 16, 0, 0).getTime())
  const monday = env.date.startOfWeek(env.now)
  assert.equal(monday, env.now)
  env.store.create({ company: 'old', position: 'p', appliedAt: monday - 1 })
  env.store.create({ company: 'new', position: 'p', appliedAt: monday })
  assert.equal(env.store.stats().weekAdded, 1)
  assert.equal(env.date.startOfWeek(new Date(2026, 10, 15, 23, 59).getTime()), new Date(2026, 10, 9).getTime())
})

test('future reminders: ordering, top three, complete, restore and delete', () => {
  const env = environment()
  const record = create(env)
  const reminders = [10, 2, 1, 3].map(days => env.store.addReminder(record.id, { type: 'followup', time: env.now + days * 86400000 }))
  assert.throws(() => env.store.addReminder(record.id, { type: 'followup', time: env.now }))
  env.store.toggleReminder(record.id, reminders[1].id)
  const home = env.page('index')
  assert.equal(home.data.reminders.length, 3)
  assert.equal(home.data.reminders[0].id, reminders[2].id)
  assert.equal(home.data.reminders[2].id, reminders[0].id)
  env.store.toggleReminder(record.id, reminders[1].id)
  env.store.removeReminder(record.id, reminders[0].id)
  home.onShow()
  assert.equal(home.data.reminders.length, 3)
})

test('reminder mutations immediately refresh tab badge on detail page', () => {
  const env = environment()
  const record = create(env)
  const detail = env.page('detail', { id: record.id })
  detail.toggleReminderForm()
  detail.saveReminder()
  assert.equal(env.calls.badges.at(-1), '1')
  const id = detail.data.reminders[0].id
  detail.toggleReminder(tap('id', id))
  assert.equal(env.calls.badges.at(-1), '')
  detail.toggleReminder(tap('id', id))
  assert.equal(env.calls.badges.at(-1), '1')
  detail.deleteReminder(tap('id', id))
  env.calls.modals.at(-1).success({ confirm: false })
  assert.equal(env.store.get(record.id).reminders.length, 1)
  detail.deleteReminder(tap('id', id))
  env.calls.modals.at(-1).success({ confirm: true })
  assert.equal(env.calls.badges.at(-1), '')
})

test('calendar uses seconds, leaves an unverified result pending and blocks duplicates', () => {
  const env = environment()
  const record = create(env)
  const reminder = env.store.addReminder(record.id, { type: 'interview', time: env.now + 3600000 })
  const detail = env.page('detail', { id: record.id })
  const event = tap('id', reminder.id)
  detail.addToCalendar(event)
  detail.addToCalendar(event)
  assert.equal(env.calls.calendar.length, 1)
  const request = env.calls.calendar[0]
  assert.equal(request.startTime, reminder.time / 1000)
  assert.equal(request.endTime - request.startTime, 2700)
  assert.equal(request.alarm, true)
  assert.equal(request.alarmOffset, 0)
  request.fail({ errMsg: 'addPhoneCalendar:fail auth deny' })
  assert.equal(detail.data.calendarPendingId, '')
  assert.match(env.calls.modals.at(-1).content, /权限/)
  detail.addToCalendar(event)
  env.calls.calendar[1].success()
  detail.onShow()
  assert.ok(env.store.get(record.id).reminders[0].calendarPendingAt)
  assert.equal(env.store.get(record.id).reminders[0].calendarAddedAt, undefined)
  detail.addToCalendar(event)
  env.calls.sheets.at(-1).success({ tapIndex: 0 })
  assert.equal(env.calls.calendar.length, 2)
  assert.ok(env.store.get(record.id).reminders[0].calendarAddedAt)
})

test('leaving the native calendar without saving can reset and retry with an explicit tap', () => {
  const env = environment()
  const record = create(env)
  const reminder = env.store.addReminder(record.id, { type: 'followup', time: env.now + 3600000 })
  const detail = env.page('detail', { id: record.id })
  const event = tap('id', reminder.id)
  detail.addToCalendar(event)
  env.calls.calendar[0].success()
  detail.onShow()
  detail.addToCalendar(event)
  env.calls.sheets.at(-1).success({ tapIndex: 1 })
  assert.equal(env.calls.calendar.length, 1)
  const reset = env.store.get(record.id).reminders[0]
  assert.equal(reset.calendarPendingAt, undefined)
  assert.equal(reset.calendarAddedAt, undefined)
  detail.addToCalendar(event)
  assert.equal(env.calls.calendar.length, 2)
})

test('a legacy calendar marker can be corrected without deleting the reminder or its metadata', () => {
  const env = environment()
  const record = create(env)
  const reminder = env.store.addReminder(record.id, { type: 'interview', time: env.now + 3600000 })
  const data = env.raw()
  data.applications[0].reminders[0].calendarAddedAt = env.now
  data.applications[0].reminders[0].extra = { keep: true }
  env.inject(data)
  const detail = env.page('detail', { id: record.id })
  const event = tap('id', reminder.id)
  detail.addToCalendar(event)
  env.calls.sheets.at(-1).success({ tapIndex: 1 })
  assert.deepEqual(clone(env.store.get(record.id).reminders[0]), { ...clone(reminder), extra: { keep: true } })
  assert.equal(env.calls.calendar.length, 0)
  detail.addToCalendar(event)
  assert.equal(env.calls.calendar.length, 1)
})

test('a confirmed calendar event stays pending if marking it fails locally', () => {
  const env = environment()
  const record = create(env)
  const reminder = env.store.addReminder(record.id, { type: 'followup', time: env.now + 3600000 })
  const detail = env.page('detail', { id: record.id })
  const event = tap('id', reminder.id)
  detail.addToCalendar(event)
  env.calls.calendar[0].success()
  detail.addToCalendar(event)
  env.calls.writeError = true
  env.calls.sheets.at(-1).success({ tapIndex: 0 })
  assert.equal(env.calls.calendar.length, 1)
  assert.ok(env.store.get(record.id).reminders[0].calendarPendingAt)
  assert.equal(env.store.get(record.id).reminders[0].calendarAddedAt, undefined)
  env.calls.writeError = false
  env.restart()
  const reopened = env.page('detail', { id: record.id })
  reopened.addToCalendar(event)
  assert.equal(env.calls.calendar.length, 1)
  env.calls.sheets.at(-1).success({ tapIndex: 0 })
  assert.ok(env.store.get(record.id).reminders[0].calendarAddedAt)
  assert.equal(env.store.get(record.id).reminders[0].calendarPendingAt, undefined)
})

test('navigation failure reports failure and permits safe retry after persisted save', () => {
  const env = environment()
  env.calls.navigationError = true
  const edit = env.page('edit')
  edit.setData({ 'form.company': 'a', 'form.position': 'b' })
  edit.saveApplication()
  assert.equal(env.store.list().length, 1)
  assert.equal(edit.data.saving, false)
  assert.match(env.calls.toasts.at(-1).title, /返回|跳转/)
  env.calls.navigationError = false
  edit.saveApplication()
  assert.equal(env.store.list().length, 1)
})

test('returning to a saved editor allows further changes without duplicating data', () => {
  const env = environment()
  const record = create(env)
  const edit = env.page('edit', { id: record.id })
  edit.saveApplication()
  edit.onShow()
  edit.setData({ 'form.company': 'changed' })
  edit.saveApplication()
  assert.equal(env.store.get(record.id).company, 'changed')
})

test('multi-question review add/remove, required matching question, integer score, edit/restart', () => {
  const env = environment()
  const record = create(env)
  const review = env.page('interview', { id: record.id })
  review.addQuestion()
  review.removeQuestion(tap('index', 0))
  assert.equal(review.data.form.questions.length, 1)
  review.saveReview()
  assert.equal(review.data.errors.score, true)
  review.setData({ 'form.selfScore': 3, 'form.questions[0].myAnswer': 'answer' })
  review.saveReview()
  assert.equal(review.data.errors.questionIndex, 0)
  review.setData({ 'form.questions[0].q': 'question' })
  review.saveReview()
  review.saveReview()
  const saved = env.store.get(record.id).interviews[0]
  assert.equal(env.store.get(record.id).interviews.length, 1)
  assert.throws(() => env.store.updateInterview(record.id, saved.id, { selfScore: 2.5 }))
  const editor = env.page('interview', { id: record.id, review: saved.id })
  editor.setData({ 'form.reflection': 'new reflection' })
  editor.saveReview()
  assert.equal(env.restart().get(record.id).interviews[0].reflection, 'new reflection')
})

test('fractional self-rating is rejected by page before persisting', () => {
  const env = environment()
  const record = create(env)
  const review = env.page('interview', { id: record.id })
  review.setData({ 'form.selfScore': 2.5 })
  review.saveReview()
  assert.equal(review.data.errors.score, true)
})

test('demo loading is idempotent; edited demos removed without changing real data', () => {
  const env = environment()
  const record = create(env)
  const original = env.store.get(record.id)
  assert.equal(env.store.seedDemo(), 6)
  env.store.update('demo-cloud', { company: 'renamed' })
  env.store.addReminder('demo-cloud', { type: 'followup', time: env.now + 3600000 })
  assert.equal(env.store.seedDemo(), 0)
  assert.equal(env.store.get('demo-cloud').company, 'renamed')
  assert.equal(env.store.stats().demoCount, 6)
  assert.equal(env.store.removeDemo(), 6)
  assert.deepEqual(clone(env.store.get(record.id)), clone(original))
  assert.equal(env.store.seedDemo(), 6)
})

test('export JSON and destructive actions require confirmation; cancel is safe', () => {
  const env = environment()
  const record = create(env)
  const mine = env.page('mine')
  mine.exportJson()
  assert.deepEqual(JSON.parse(env.calls.clipboard), env.raw())
  mine.requestClear()
  env.calls.modals.at(-1).success({ confirm: false })
  assert.equal(env.store.list().length, 1)
  mine.requestClear()
  env.calls.modals.at(-1).success({ confirm: true })
  assert.equal(env.store.list().length, 1)
  env.calls.modals.at(-1).success({ confirm: false })
  assert.equal(env.store.list().length, 1)
  const list = env.page('list')
  list.confirmDelete(record.id)
  env.calls.modals.at(-1).success({ confirm: false })
  assert.equal(env.store.list().length, 1)
  list.confirmDelete(record.id)
  env.calls.modals.at(-1).success({ confirm: true })
  assert.equal(env.store.list().length, 0)
  create(env)
  mine.onShow()
  mine.requestClear()
  env.calls.modals.at(-1).success({ confirm: true })
  env.calls.modals.at(-1).success({ confirm: true })
  assert.equal(env.restart().list().length, 0)
})

test('read/write failures preserve stored data and edits can retry', () => {
  const env = environment()
  const original = create(env)
  const snapshot = env.raw()
  env.calls.writeError = true
  assert.throws(() => env.store.update(original.id, { company: 'lost' }), /保存失败/)
  assert.deepEqual(env.raw(), snapshot)
  env.calls.writeError = false
  env.calls.readError = true
  assert.throws(() => env.store.create({ company: 'a', position: 'b' }), /读取/)
  assert.deepEqual(env.raw(), snapshot)
})

test('malformed version-1 records cannot be overwritten or cleared; raw export remains available', () => {
  const env = environment()
  const record = create(env)
  const damaged = env.raw()
  delete damaged.applications[0].reminders
  env.inject(damaged)
  const writes = env.calls.writes
  assert.throws(() => env.store.create({ company: 'a', position: 'b' }), /格式异常/)
  assert.throws(() => env.store.remove(record.id), /格式异常/)
  assert.throws(() => env.store.clear(), /格式异常/)
  assert.equal(env.calls.writes, writes)
  assert.deepEqual(clone(env.store.exportData()), damaged)
})

test('unknown data versions are not rewritten', () => {
  const env = environment()
  const data = { version: 2, applications: [], metadata: 'future' }
  env.inject(data)
  assert.throws(() => create(env), /版本/)
  assert.throws(() => env.store.clear(), /版本/)
  assert.deepEqual(env.raw(), data)
  assert.deepEqual(clone(env.store.exportData()), data)
})

test('calendar disk failure before native request never creates an event', () => {
  const env = environment()
  const record = create(env)
  const reminder = env.store.addReminder(record.id, { type: 'followup', time: env.now + 3600000 })
  const detail = env.page('detail', { id: record.id })
  env.calls.writeError = true
  detail.addToCalendar(tap('id', reminder.id))
  assert.equal(env.calls.calendar.length, 0)
  assert.match(env.calls.toasts.at(-1).title, /保存失败/)
})

test('unsupported calendar API surfaces feedback and clears intent for retry', () => {
  const env = environment()
  const record = create(env)
  const reminder = env.store.addReminder(record.id, { type: 'followup', time: env.now + 3600000 })
  env.wx.addPhoneCalendar = undefined
  const detail = env.page('detail', { id: record.id })
  detail.addToCalendar(tap('id', reminder.id))
  assert.equal(detail.data.calendarPendingId, '')
  assert.equal(env.store.get(record.id).reminders[0].calendarPendingAt, undefined)
  assert.match(env.calls.modals.at(-1).content, /手机微信/)
})

test('interrupted calendar request stays pending across reopening until checked', () => {
  const env = environment()
  const record = create(env)
  const reminder = env.store.addReminder(record.id, { type: 'followup', time: env.now + 3600000 })
  const event = tap('id', reminder.id)
  const detail = env.page('detail', { id: record.id })
  detail.addToCalendar(event)
  assert.equal(env.calls.calendar[0].endTime - env.calls.calendar[0].startTime, 900)
  const reopened = env.page('detail', { id: record.id })
  reopened.addToCalendar(event)
  assert.equal(env.calls.calendar.length, 1)
  env.calls.sheets.at(-1).success({ tapIndex: 1 })
  assert.equal(env.calls.calendar.length, 1)
  reopened.addToCalendar(event)
  assert.equal(env.calls.calendar.length, 2)
})

test('review navigation failure retries update, and onShow allows subsequent editing', () => {
  const env = environment()
  const record = create(env)
  const review = env.page('interview', { id: record.id })
  review.setData({ 'form.selfScore': 4 })
  env.calls.navigationError = true
  review.saveReview()
  assert.equal(review.data.saving, false)
  env.calls.navigationError = false
  review.saveReview()
  assert.equal(env.store.get(record.id).interviews.length, 1)
  review.onShow()
  review.setData({ 'form.reflection': 'second save' })
  review.saveReview()
  assert.equal(env.store.get(record.id).interviews[0].reflection, 'second save')
})

test('corrupt nested data is protected and backup is accessible on mine error state', () => {
  const variants = [
    data => { data.applications[0].status = 'invalid' },
    data => { data.applications[0].timeline[0].time = 'not a timestamp' },
    data => { data.applications[0].interviews = [null] },
    data => { data.applications.push(data.applications[0]) },
    data => { data.applications[0].company = null }
  ]
  for (const damage of variants) {
    const env = environment()
    create(env)
    const data = env.raw()
    damage(data)
    env.inject(data)
    const mine = env.page('mine')
    assert.match(mine.data.error, /格式异常/)
    mine.exportJson()
    assert.deepEqual(JSON.parse(env.calls.clipboard), data)
    assert.throws(() => env.store.clear(), /格式异常/)
    assert.deepEqual(env.raw(), data)
  }
})

test('version-1 writes preserve additional metadata and unknown record fields', () => {
  const env = environment()
  const record = create(env)
  const data = env.raw()
  data.metadata = { source: 'existing' }
  data.applications[0].extra = 'keep'
  env.inject(data)
  env.store.update(record.id, { company: 'edited' })
  assert.deepEqual(env.raw().metadata, data.metadata)
  assert.equal(env.store.get(record.id).extra, 'keep')
  assert.equal(env.raw().version, 1)
})

test('failed calendar intent cleanup remains recoverable without silently adding another event', () => {
  const env = environment()
  const record = create(env)
  const reminder = env.store.addReminder(record.id, { type: 'followup', time: env.now + 3600000 })
  const detail = env.page('detail', { id: record.id })
  detail.addToCalendar(tap('id', reminder.id))
  env.calls.writeError = true
  env.calls.calendar[0].fail({ errMsg: 'addPhoneCalendar:fail auth deny' })
  assert.ok(env.store.get(record.id).reminders[0].calendarPendingAt)
  assert.match(env.calls.modals.at(-1).content, /核对手机日历/)
  detail.addToCalendar(tap('id', reminder.id))
  assert.equal(env.calls.calendar.length, 1)
  assert.equal(env.calls.sheets.length, 1)
})

test('pending calendar intent stays reconcilable after reminder completion', () => {
  const env = environment()
  const record = create(env)
  const reminder = env.store.addReminder(record.id, { type: 'followup', time: env.now + 3600000 })
  env.store.setReminderCalendarPending(record.id, reminder.id, true)
  env.store.toggleReminder(record.id, reminder.id)
  const detail = env.page('detail', { id: record.id })
  detail.addToCalendar(tap('id', reminder.id))
  env.calls.sheets.at(-1).success({ tapIndex: 0 })
  assert.ok(env.store.get(record.id).reminders[0].calendarAddedAt)
  assert.equal(env.calls.calendar.length, 0)
})

test('list onShow refreshes filters and failed saves retain drafts for retry', () => {
  const env = environment()
  const list = env.page('list')
  const record = create(env)
  list.onShow()
  assert.equal(list.data.records.length, 1)
  list.selectFilter(tap('filter', 'offer'))
  assert.equal(list.data.records.length, 0)
  env.store.changeStatus(record.id, 'offer')
  list.onShow()
  assert.equal(list.data.records.length, 1)
  list.onSearch({ detail: { value: 'not matching' } })
  assert.equal(list.data.records.length, 0)
  list.resetFilters()
  assert.equal(list.data.records.length, 1)
  const edit = env.page('edit', { id: record.id })
  edit.setData({ 'form.company': 'draft' })
  env.calls.writeError = true
  edit.saveApplication()
  assert.equal(edit.data.saving, false)
  assert.equal(edit.data.form.company, 'draft')
  assert.equal(env.store.get(record.id).company, 'Test company')
  env.calls.writeError = false
  edit.saveApplication()
  assert.equal(env.store.get(record.id).company, 'draft')
})

test('shared small text and status labels meet 4.5:1 color contrast', () => {
  function luminance(hex) {
    const channels = hex.slice(1).match(/../g).map(channel => {
      const value = parseInt(channel, 16) / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  }
  function check(foreground, background) {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
    const ratio = (values[0] + 0.05) / (values[1] + 0.05)
    assert.ok(ratio >= 4.5, foreground + ' on ' + background + ': ' + ratio.toFixed(2))
  }
  const css = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8')
  const variable = name => css.match(new RegExp('--' + name + ':\\s*(#[0-9a-f]{6})', 'i'))[1]
  for (const name of ['ink', 'muted', 'subtle']) {
    check(variable(name), variable('background'))
    check(variable(name), variable('surface'))
  }
  check(variable('primary-strong'), variable('primary-soft'))
  const { STATUSES } = require('..\\utils\\constants')
  for (const status of STATUSES) check(status.color, status.background)
})

test('review keyboard reserves space and follows the active field without losing its draft', async () => {
  const env = environment()
  const review = env.page('interview', { id: create(env).id })
  const fieldEvent = (field, detail = {}) => ({ ...tap('anchor', field), detail })
  const reflection = 'review-reflection'
  const question = 'review-question-1'
  review.onKeyboardFocus(fieldEvent(reflection, { height: 300 }))
  assert.equal(review.data.keyboardHeight, 300)
  assert.equal(review.keyboardAnchor, reflection)
  review.onReflection({ detail: { value: '这段文字应当保留。' } })
  review.onFieldKeyboardHeight(fieldEvent(reflection, { height: 332 }))
  assert.equal(review.data.keyboardHeight, 332)
  assert.equal(review.keyboardAnchor, reflection)
  review.onKeyboardFocus(fieldEvent(question, { height: 332 }))
  review.onKeyboardBlur(fieldEvent(reflection))
  assert.equal(review.data.keyboardHeight, 332)
  assert.equal(review.keyboardAnchor, question)
  review.onKeyboardBlur(fieldEvent(question))
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.equal(review.data.keyboardHeight, 0)
  assert.equal(review.keyboardAnchor, '')
  assert.equal(review.data.form.reflection, '这段文字应当保留。')
})

test('page refreshes share one validated read and preserve the badge and status calculations', () => {
  const env = environment()
  const record = create(env)
  env.store.addReminder(record.id, { type: 'followup', time: env.now + 3600000 })
  for (const [name, options] of [
    ['index'], ['list'], ['mine'], ['detail', { id: record.id }],
    ['edit'], ['edit', { id: record.id }], ['interview', { id: record.id }]
  ]) {
    const start = env.calls.reads
    const page = env.page(name, options)
    assert.equal(env.calls.reads - start, 1, name)
    assert.equal(page.data.error, '', name)
  }
  assert.equal(env.calls.badges.at(-1), '1')
  const raw = env.raw()
  raw.applications[0].timeline = []
  env.inject(raw)
  const before = env.calls.reads
  const home = env.page('index')
  assert.equal(env.calls.reads - before, 1)
  assert.match(home.data.error, /格式异常/)
  assert.deepEqual(env.raw(), raw)
})

test('the overdue entry is independent of the next three and keeps completed and current reminders out', () => {
  const env = environment()
  const first = create(env)
  const other = env.store.create({ company: '另一家公司', position: '测试' })
  const reminders = Array.from({ length: 7 }, (_, index) =>
    env.store.addReminder(index === 1 ? other.id : first.id, { type: 'followup', time: env.now + (index + 1) * 60000 }))
  const raw = env.raw()
  const rows = raw.applications.flatMap(record => record.reminders)
  for (const [index, time] of [[0, env.now - 180000], [1, env.now - 60000], [2, env.now - 30000], [3, env.now]]) {
    const reminder = rows.find(item => item.id === reminders[index].id)
    reminder.time = time
    reminder.done = index === 2
  }
  env.inject(raw)
  const home = env.page('index')
  assert.equal(home.data.overdueCount, 2)
  assert.equal(home.data.showOverdue, false)
  const next = [reminders[3].id, reminders[4].id, reminders[5].id]
  assert.deepEqual(home.data.reminders.map(item => item.id), next)
  assert.equal(env.calls.badges.at(-1), '4')
  home.toggleOverdue()
  assert.equal(home.data.showOverdue, true)
  assert.deepEqual(home.data.overdueReminders.map(item => item.id), [reminders[1].id, reminders[0].id])
  assert.deepEqual(home.data.reminders.map(item => item.id), next)
  home.openApplication(tap('id', home.data.overdueReminders[0].applicationId))
  assert.equal(env.calls.url, '/pages/detail/detail?id=' + other.id)
  env.store.toggleReminder(other.id, reminders[1].id)
  home.onShow()
  assert.equal(home.data.overdueCount, 1)
  assert.equal(home.data.overdueReminders.length, 1)
  home.toggleOverdue()
  assert.equal(home.data.overdueReminders.length, 0)
})

test('new applications reuse the latest channel, keep a cleared choice, and ignore demo and edits', () => {
  const env = environment()
  const legacy = env.store.create({ company: '早期记录', position: '前端', channel: '内推' })
  const data = env.raw()
  delete data.lastUsedChannel
  data.extension = { keep: true }
  env.inject(data)
  env.store.seedDemo()
  assert.equal(env.page('edit').data.form.channel, '内推')
  env.store.update(legacy.id, { channel: '校招' })
  assert.equal(env.page('edit', { id: legacy.id }).data.form.channel, '校招')
  const edit = env.page('edit')
  edit.setData({ 'form.company': '另一个公司', 'form.position': '后端' })
  edit.chooseChannel(tap('channel', '官网'))
  edit.saveApplication()
  env.restart()
  assert.equal(env.page('edit').data.form.channel, '官网')
  const cleared = env.page('edit')
  cleared.setData({ 'form.company': '第三家公司', 'form.position': '后端' })
  cleared.chooseChannel(tap('channel', '官网'))
  cleared.saveApplication()
  assert.equal(env.page('edit').data.form.channel, '')
  assert.deepEqual(env.raw().extension, data.extension)
  assert.equal(env.raw().version, 1)
})

test('keyboard Next moves between the visible inputs without submitting or expanding the form', () => {
  const env = environment()
  const edit = env.page('edit')
  edit.focusNext(tap('next', 'position'))
  assert.equal(edit.data.focusField, 'position')
  assert.equal(edit.data.expanded, false)
  edit.toggleMore()
  for (const next of ['city', 'jdLink', 'note']) {
    edit.focusNext(tap('next', next))
    assert.equal(edit.data.focusField, next)
  }
  edit.toggleMore()
  assert.equal(edit.data.focusField, '')
  assert.equal(env.store.list().length, 0)
})

test('editing a review preserves metadata on the review and the retained question', () => {
  const env = environment()
  const record = create(env)
  const review = env.store.addInterview(record.id, {
    round: '一面', date: env.now, selfScore: 3,
    questions: [{ q: '移除我', myAnswer: '' }, { q: '保留我', myAnswer: '原回答' }]
  })
  const data = env.raw()
  const stored = data.applications[0].interviews[0]
  stored.extension = { keep: true }
  stored.questions[0].hint = 'removed'
  stored.questions[1].hint = 'keep'
  stored.questions[1].key = 'legacy-value'
  env.inject(data)
  const page = env.page('interview', { id: record.id, review: review.id })
  page.removeQuestion(tap('index', 0))
  page.setData({ 'form.questions[0].myAnswer': '新回答' })
  page.saveReview()
  const saved = env.raw().applications[0].interviews[0]
  assert.deepEqual(saved.extension, { keep: true })
  assert.deepEqual(saved.questions, [{ q: '保留我', myAnswer: '新回答', hint: 'keep', key: 'legacy-value' }])
})

test('collapsing the reminder form clears only its keyboard and preserves the complete unsaved draft', () => {
  const env = environment()
  const detail = env.page('detail', { id: create(env).id })
  const writes = env.calls.writes
  detail.toggleReminderForm()
  detail.changeReminderType(tap('type', 'followup'))
  detail.pickReminderDate({ detail: { value: '2026-11-14' } })
  detail.pickReminderTime({ detail: { value: '15:45' } })
  detail.pickReminderRound({ detail: { value: '2' } })
  for (const [field, value] of [['location', '上海办公室'], ['link', 'https://example.com/meeting'], ['note', '带上作品集\n准备两个问题']]) {
    detail.onReminderInput({ ...tap('field', field), detail: { value } })
  }
  const draft = clone(detail.data.reminderForm)
  const focused = { ...tap('anchor', 'reminder-note'), detail: { height: 300 } }
  detail.onKeyboardFocus(focused)
  assert.equal(detail.data.keyboardInset, 300)
  detail.toggleReminderForm()
  assert.equal(detail.data.showReminderForm, false)
  assert.equal(detail.keyboardAnchor, '')
  assert.equal(detail.data.keyboardHeight, 0)
  assert.equal(detail.data.keyboardInset, 0)
  detail.onFieldKeyboardHeight(focused)
  assert.equal(detail.data.keyboardHeight, 0)
  assert.deepEqual(detail.data.reminderForm, draft)
  detail.toggleReminderForm()
  assert.equal(detail.data.showReminderForm, true)
  assert.deepEqual(detail.data.reminderForm, draft)
  detail.onStatusNote({ detail: { value: '等待二面安排' } })
  detail.onKeyboardFocus({ ...tap('anchor', 'status-note'), detail: { height: 280 } })
  detail.toggleReminderForm()
  assert.equal(detail.keyboardAnchor, 'status-note')
  assert.equal(detail.data.keyboardHeight, 280)
  assert.equal(detail.data.statusNote, '等待二面安排')
  assert.deepEqual(detail.data.reminderForm, draft)
  assert.equal(env.calls.writes, writes)
  detail.onUnload()
})

test('removing review questions releases only the removed input focus and preserves all remaining drafts', () => {
  for (const kind of ['question', 'answer']) {
    const env = environment()
    const review = env.page('interview', { id: create(env).id })
    const writes = env.calls.writes
    review.addQuestion()
    review.addQuestion()
    for (let index = 0; index < 3; index += 1) {
      for (const [field, value] of [['q', '问题' + (index + 1)], ['myAnswer', '回答' + (index + 1)]]) {
        review.onQuestionInput({ currentTarget: { dataset: { index, field } }, detail: { value } })
      }
    }
    review.onReflection({ detail: { value: '复盘心得草稿' } })
    review.selectScore(tap('score', 4))
    const second = clone(review.data.form.questions[1])
    const third = clone(review.data.form.questions[2])
    const anchor = 'review-' + kind + '-' + second.key
    const focused = { ...tap('anchor', anchor), detail: { height: 320 } }
    review.onKeyboardFocus(focused)
    review.removeQuestion(tap('index', 0))
    assert.equal(review.keyboardAnchor, anchor)
    assert.equal(review.data.keyboardHeight, 320)
    assert.deepEqual(review.data.form.questions, [second, third])
    review.removeQuestion(tap('index', 0))
    assert.equal(review.keyboardAnchor, '')
    assert.equal(review.data.keyboardHeight, 0)
    assert.equal(review.data.keyboardInset, 0)
    review.onFieldKeyboardHeight(focused)
    assert.equal(review.data.keyboardHeight, 0)
    assert.deepEqual(review.data.form.questions, [third])
    assert.equal(review.data.form.reflection, '复盘心得草稿')
    assert.equal(review.data.form.selfScore, 4)
    assert.equal(env.calls.writes, writes)
    review.onUnload()
  }
})

test('all four input pages detach keyboard listeners on hide and unload without losing drafts or accepting late events', async () => {
  const cases = [
    { name: 'edit', anchor: 'edit-company', input: page => page.onInput({ ...tap('field', 'company'), detail: { value: '未保存公司' } }), draft: page => page.data.form.company },
    { name: 'detail', anchor: 'status-note', input: page => page.onStatusNote({ detail: { value: '未保存状态备注' } }), draft: page => page.data.statusNote },
    { name: 'interview', anchor: 'review-reflection', input: page => page.onReflection({ detail: { value: '未保存复盘' } }), draft: page => page.data.form.reflection },
    { name: 'list', anchor: 'list-search', input: page => page.onSearch({ detail: { value: 'Engineer' } }), draft: page => page.data.query }
  ]
  for (const scenario of cases) {
    const env = environment()
    const keyboardListeners = new Set()
    const resizeListeners = new Set()
    env.wx.onKeyboardHeightChange = listener => keyboardListeners.add(listener)
    env.wx.offKeyboardHeightChange = listener => keyboardListeners.delete(listener)
    env.wx.onWindowResize = listener => resizeListeners.add(listener)
    env.wx.offWindowResize = listener => resizeListeners.delete(listener)
    const page = env.page(scenario.name, { id: create(env).id })
    scenario.input(page)
    const draft = clone(scenario.draft(page))
    const writes = env.calls.writes
    const focused = { ...tap('anchor', scenario.anchor), detail: { height: 300 } }
    for (const lifecycle of ['onHide', 'onUnload']) {
      page.onKeyboardFocus(focused)
      assert.equal(page.data.keyboardHeight, 300, scenario.name)
      assert.equal(keyboardListeners.size, 1, scenario.name)
      assert.equal(resizeListeners.size, 1, scenario.name)
      const staleListener = [...keyboardListeners][0]
      page.onKeyboardBlur(focused)
      page[lifecycle]()
      assert.equal(keyboardListeners.size, 0, scenario.name + ' ' + lifecycle)
      assert.equal(resizeListeners.size, 0, scenario.name + ' ' + lifecycle)
      assert.equal(page.data.keyboardHeight, 0, scenario.name)
      assert.equal(page.data.keyboardInset, 0, scenario.name)
      assert.equal(page.keyboardAnchor, '', scenario.name)
      const afterStop = clone(page.data)
      staleListener({ height: 360 })
      page.onFieldKeyboardHeight(focused)
      page.onKeyboardFocus(focused)
      await new Promise(resolve => setTimeout(resolve, 80))
      assert.deepEqual(page.data, afterStop, scenario.name + ' ignores events after ' + lifecycle)
      assert.deepEqual(scenario.draft(page), draft, scenario.name)
      assert.equal(env.calls.writes, writes, scenario.name)
      if (lifecycle === 'onHide') {
        page.onShow()
        assert.deepEqual(scenario.draft(page), draft, scenario.name + ' retains draft after returning')
      }
    }
  }
})
