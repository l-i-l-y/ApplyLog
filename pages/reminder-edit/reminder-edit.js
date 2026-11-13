const { keyboardPage, keyboardData } = require('../../utils/keyboard')
const { leaveGuard } = require('../../utils/leave-guard')
const store = require('../../utils/store')
const { INTERVIEW_ROUNDS, REMINDER_TYPES } = require('../../utils/constants')
const { toDateInput, toTimeInput, parseDate } = require('../../utils/date')
const { reminderFields, REMINDER_LIMITS } = require('../../utils/reminder')
const { returnToPrevious, toast } = require('../../utils/ui')

Page({
  ...keyboardPage,
  ...leaveGuard,
  data: {
    ...keyboardData,
    loading: true, error: '', saving: false, returnOnly: false, timeError: '', calendarNotice: false,
    reminderTypes: REMINDER_TYPES, limits: REMINDER_LIMITS, rounds: [], roundLabels: [],
    form: { type: 'interview', date: '', time: '', roundIndex: 0, location: '', link: '', note: '' }
  },
  onLoad(options) { this.applicationId = options.id || ''; this.reminderId = options.reminder || '' },
  onShow() { this.startKeyboard(); this.setData({ saving: false }); this.loadReminder() },
  onHide() { this.stopKeyboard(); this.suspendLeaveGuard() },
  onUnload() { this.stopKeyboard(); this.suspendLeaveGuard() },

  editSnapshot() {
    const form = this.data.form, parsed = parseDate(form.date, form.time)
    return { type: form.type, time: parsed === this.initialDisplayTime ? this.originalTime : parsed,
      invalidDate: parsed === null ? form.date + ' ' + form.time : '', round: form.type === 'interview' ? this.data.rounds[form.roundIndex] : '',
      location: form.location, link: form.link, note: form.note }
  },

  source() {
    const record = store.get(this.applicationId)
    if (!record) throw new Error('这条投递记录已不存在')
    const reminder = record.reminders.find(item => item.id === this.reminderId)
    if (!reminder) throw new Error('这条提醒已不存在')
    return reminder
  },
  loadReminder() {
    try {
      const reminder = this.source()
      const changes = { loading: false, error: '', calendarNotice: Boolean(reminder.calendarAddedAt || reminder.calendarPendingAt || reminder.calendarReviewRequired) }
      if (!this.initialized) {
        const round = reminder.round || ''
        const rounds = ['', ...INTERVIEW_ROUNDS]
        if (!rounds.includes(round)) rounds.push(round)
        const date = toDateInput(reminder.time), time = toTimeInput(reminder.time)
        changes.rounds = rounds
        changes.roundLabels = rounds.map(item => item || '未填写')
        changes.form = { type: reminder.type, date, time, roundIndex: rounds.indexOf(round), location: reminder.location || '', link: reminder.link || '', note: reminder.note || '' }
        this.originalTime = reminder.time
        // 日期/时间 picker 只展示到分钟；未改变实际选择时保留原秒数和毫秒数。
        this.initialDisplayTime = parseDate(date, time)
        this.initialized = true
      }
      this.setData(changes, () => this.beginLeaveGuard())
    } catch (error) { this.setData({ loading: false, error: error.message }) }
  },
  changeType(event) {
    const type = event.currentTarget.dataset.type
    if (REMINDER_TYPES.some(item => item.id === type)) this.setData({ 'form.type': type, returnOnly: false }, () => this.refreshLeaveGuard())
  },
  pickDate(event) { this.setData({ 'form.date': event.detail.value, timeError: '', returnOnly: false }, () => this.refreshLeaveGuard()) },
  pickTime(event) { this.setData({ 'form.time': event.detail.value, timeError: '', returnOnly: false }, () => this.refreshLeaveGuard()) },
  pickRound(event) {
    const index = Number(event.detail.value)
    if (Number.isInteger(index) && index >= 0 && index < this.data.rounds.length) this.setData({ 'form.roundIndex': index, returnOnly: false }, () => this.refreshLeaveGuard())
  },
  onInput(event) {
    const field = event.currentTarget.dataset.field
    if (!Object.keys(REMINDER_LIMITS).includes(field)) return
    this.setData({ ['form.' + field]: event.detail.value, returnOnly: false }, () => this.afterFormChange())
  },
  cancelEdit() { this.requestLeave() },
  saveReminder() {
    if (this.data.loading || this.data.error || this.data.saving) return
    let current
    try { current = this.source() }
    catch (error) { this.setData({ error: error.message }); toast(error.message); return }
    const form = this.data.form
    const signature = this.formSignature()
    const parsed = parseDate(form.date, form.time)
    const time = parsed === this.initialDisplayTime ? this.originalTime : parsed
    let payload
    try { payload = reminderFields({ ...form, time, round: this.data.rounds[form.roundIndex] }, current) }
    catch (error) {
      if (error.message.includes('时间')) this.setData({ timeError: error.message })
      toast(error.message)
      return
    }
    this.setData({ saving: true, timeError: '' })
    try {
      if (this.savedSignature !== signature) {
        const saved = store.updateReminder(this.applicationId, this.reminderId, payload)
        this.originalTime = saved.time
        this.initialDisplayTime = parsed
        this.savedSignature = signature
      }
      this.markFormSaved()
      this.releaseKeyboard()
      this.setData({ returnOnly: true })
    } catch (error) {
      this.setData({ saving: false, ...(error.message.includes('不存在') ? { error: error.message } : {}) })
      toast(error.message)
      return
    }
    returnToPrevious('提醒已更新', 'success', () => this.setData({ saving: false }))
  }
})
