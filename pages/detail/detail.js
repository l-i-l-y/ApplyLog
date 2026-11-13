const { keyboardPage, keyboardData } = require('../../utils/keyboard')

const store = require('../../utils/store')
const { STATUSES, INTERVIEW_ROUNDS, REMINDER_TYPES, isDemoId } = require('../../utils/constants')
const { toDateInput, toTimeInput, parseDate, formatDay } = require('../../utils/date')
const { addReminderToCalendar } = require('../../utils/calendar')
const {
  applicationUrl, copyText, openPage, reminderView, returnToPrevious, timelineView, toast, updateHomeBadge
} = require('../../utils/ui')

function newReminderForm() {
  const halfHour = 30 * 60 * 1000
  const time = Math.ceil((Date.now() + 60000) / halfHour) * halfHour
  return {
    type: 'interview', date: toDateInput(time), time: toTimeInput(time),
    roundIndex: 0, location: '', link: '', note: ''
  }
}

Page({
  ...keyboardPage,
  data: {
    ...keyboardData,
    loading: true,
    error: '',
    record: null,
    statusSteps: STATUSES,
    statusNote: '',
    timeline: [],
    reminders: [],
    reviews: [],
    reminderTypes: REMINDER_TYPES,
    rounds: INTERVIEW_ROUNDS,
    showReminderForm: false,
    reminderForm: {},
    reminderError: '',
    today: '',
    calendarPendingId: ''
  },

  onLoad(options) {
    this.applicationId = options.id || ''
  },

  onShow() {
    this.startKeyboard()
    this.setData({ calendarPendingId: '' })
    this.loadDetail()
  },

  onHide() { this.stopKeyboard() },

  onUnload() {
    this.stopKeyboard()
    this.disposed = true
  },

  loadDetail() {
    if (!this.data.record) this.setData({ loading: true, error: '' })
    try {
      const now = Date.now()
      const data = store.snapshot(now)
      const application = data.get(this.applicationId)
      if (!application) {
        this.setData({ loading: false, error: '这条投递记录已不存在', record: null })
        returnToPrevious('这条投递记录已不存在', 'none')
        return
      }
      const { timeline, reminders, interviews, ...record } = application
      this.setData({
        loading: false,
        error: '',
        record: { ...record, dateLabel: toDateInput(record.appliedAt), demo: isDemoId(record.id) },
        timeline: timeline.slice().reverse().map((entry, index) => ({ ...timelineView(entry, now), key: index })),
        reminders: reminders.slice()
          .sort((a, b) => Number(a.done) - Number(b.done) || (a.done ? b.time - a.time : a.time - b.time))
          .map(item => reminderView(item, now)),
        reviews: interviews.slice().sort((a, b) => b.date - a.date).map(review => ({
          id: review.id,
          round: review.round,
          dateLabel: formatDay(review.date, now),
          score: review.selfScore,
          questionCount: review.questions.length
        })),
        today: toDateInput(now)
      })
      updateHomeBadge(data.upcomingCount())
    } catch (error) {
      this.setData({ loading: false, error: error.message })
    }
  },

  openEditor() {
    openPage(applicationUrl('edit', this.applicationId))
  },

  copyJobLink() {
    if (this.data.record.jdLink) copyText(this.data.record.jdLink, '职位链接已复制')
  },

  onStatusNote(event) {
    this.setData({ statusNote: event.detail.value })
  },

  selectStatus(event) {
    const { status } = event.currentTarget.dataset
    if (this.data.record.status === status) return
    try {
      store.changeStatus(this.applicationId, status, this.data.statusNote)
      this.setData({ statusNote: '' })
      this.loadDetail()
      toast('已更新进度', 'success')
    } catch (error) {
      toast(error.message)
    }
  },

  toggleReminderForm() {
    if (this.data.showReminderForm) {
      if ((this.keyboardAnchor || '').startsWith('reminder-')) this.releaseKeyboard()
      this.setData({ showReminderForm: false })
    } else {
      this.setData({ showReminderForm: true, reminderForm: Object.keys(this.data.reminderForm).length ? this.data.reminderForm : newReminderForm(), reminderError: '' })
    }
  },

  changeReminderType(event) {
    this.setData({ 'reminderForm.type': event.currentTarget.dataset.type })
  },

  pickReminderDate(event) {
    this.setData({ 'reminderForm.date': event.detail.value, reminderError: '' })
  },

  pickReminderTime(event) {
    this.setData({ 'reminderForm.time': event.detail.value, reminderError: '' })
  },

  pickReminderRound(event) {
    this.setData({ 'reminderForm.roundIndex': Number(event.detail.value) })
  },

  onReminderInput(event) {
    const field = event.currentTarget.dataset.field
    this.setData({ ['reminderForm.' + field]: event.detail.value }, () => this.ensureKeyboardField())
  },

  saveReminder() {
    if (!this.data.showReminderForm) return
    const form = this.data.reminderForm
    const time = parseDate(form.date, form.time)
    if (time === null || time <= Date.now()) {
      this.setData({ reminderError: '请选择未来的提醒时间' })
      return
    }
    try {
      store.addReminder(this.applicationId, {
        ...form, time, round: INTERVIEW_ROUNDS[form.roundIndex]
      })
      this.releaseKeyboard()
      this.setData({ showReminderForm: false, reminderForm: {}, reminderError: '' })
      this.loadDetail()
      toast('提醒已添加', 'success')
    } catch (error) {
      toast(error.message)
    }
  },

  toggleReminder(event) {
    const reminderId = event.currentTarget.dataset.id
    try {
      const reminder = store.toggleReminder(this.applicationId, reminderId)
      this.loadDetail()
      toast(reminder.done ? '提醒已完成' : '已恢复提醒', 'success')
    } catch (error) {
      toast(error.message)
    }
  },

  deleteReminder(event) {
    const reminderId = event.currentTarget.dataset.id
    const reminder = this.data.reminders.find(item => item.id === reminderId)
    if (!reminder) return
    wx.showModal({
      title: '删除提醒',
      content: reminder.calendarAddedAt || reminder.calendarPendingAt ? '如需同步取消，请在手机日历中删除对应事件。' : '确定删除这条提醒吗？',
      confirmText: '删除',
      confirmColor: '#A13D51',
      success: ({ confirm }) => {
        if (!confirm) return
        try {
          store.removeReminder(this.applicationId, reminderId)
          this.loadDetail()
          toast('提醒已删除', 'success')
        } catch (error) {
          toast(error.message)
        }
      }
    })
  },

  copyReminderLink(event) {
    const reminder = this.data.reminders.find(item => item.id === event.currentTarget.dataset.id)
    if (reminder && reminder.link) copyText(reminder.link, '面试链接已复制')
  },

  addToCalendar(event) {
    if (this.data.calendarPendingId) return
    const reminderId = event.currentTarget.dataset.id
    const reminder = this.data.reminders.find(item => item.id === reminderId)
    if (!reminder) return
    if (reminder.calendarPendingAt || reminder.calendarAddedAt) {
      this.confirmCalendarStatus(reminder)
      return
    }
    if (reminder.done) return
    if (reminder.time <= Date.now()) {
      this.loadDetail()
      toast('提醒时间已过')
      return
    }

    try {
      store.setReminderCalendarPending(this.applicationId, reminderId, true)
    } catch (error) {
      toast(error.message)
      return
    }
    const request = { reminderId }
    this.calendarRequest = request
    this.setData({ calendarPendingId: reminderId })
    const finishRequest = () => {
      if (this.disposed || this.calendarRequest !== request) return false
      this.calendarRequest = null
      this.setData({ calendarPendingId: '' })
      return true
    }
    const fail = error => {
      if (!finishRequest()) return
      console.error('ApplyLog calendar add failed', error)
      let message = '请在手机微信中操作；若已拒绝权限，请在手机系统设置中允许微信访问日历，再返回重试。'
      if (error instanceof Error) message = error.message
      try {
        store.setReminderCalendarPending(this.applicationId, reminderId, false)
      } catch (storageError) {
        message = '日历添加未确认，且本地标记更新失败。请先检查手机日历，再点击「核对手机日历」。'
        console.error('ApplyLog calendar intent cleanup failed', storageError)
      }
      this.loadDetail()
      wx.showModal({
        title: '未能加入手机日历',
        content: message,
        showCancel: false,
        confirmText: '知道了'
      })
    }
    const success = () => {
      if (!finishRequest()) return
      // 部分机型打开系统日历编辑器就会返回成功，是否保存由用户核对。
      this.loadDetail()
      toast('请在系统日历保存后核对')
    }
    try {
      addReminderToCalendar(this.data.record, reminder, { success, fail })
    } catch (error) {
      fail(error)
    }
  },

  confirmCalendarStatus(reminder) {
    wx.showActionSheet({
      alertText: '请先在手机日历查看这条提醒是否已保存',
      itemList: ['日历中已保存', '日历中未保存'],
      success: ({ tapIndex }) => {
        if (this.disposed || (tapIndex !== 0 && tapIndex !== 1)) return
        if (this.calendarRequest && this.calendarRequest.reminderId === reminder.id) this.calendarRequest = null
        try {
          if (tapIndex === 1) {
            store.clearReminderCalendar(this.applicationId, reminder.id)
          } else if (!reminder.calendarAddedAt) {
            store.markReminderCalendar(this.applicationId, reminder.id)
          }
          this.loadDetail()
          toast(tapIndex === 0 ? '已确认加入日历' : '已恢复为未加入')
        } catch (error) {
          toast(error.message)
        }
      }
    })
  },

  openReview(event) {
    const reviewId = event.currentTarget.dataset.id
    const query = reviewId ? '&review=' + encodeURIComponent(reviewId) : ''
    openPage(applicationUrl('interview', this.applicationId) + query)
  }
})
