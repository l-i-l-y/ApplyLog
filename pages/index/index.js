const { syncTabBar } = require('../../utils/tabbar')

const store = require('../../utils/store')
const guide = require('../../utils/guide')
const { STATUSES } = require('../../utils/constants')
const { homeDate, startOfWeek, toDateInput } = require('../../utils/date')
const { applicationCard, applicationUrl, openPage, openTab, reminderView, updateHomeBadge } = require('../../utils/ui')

function greetingFor(now) {
  const hour = new Date(now).getHours()
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 19) return '下午好'
  return '晚上好'
}

Page({
  data: {
    tabBarHeight: 58,
    showGuide: false,
    loading: true,
    error: '',
    greeting: '',
    dateLabel: '',
    total: 0,
    pendingStatusCount: 0,
    weekAdded: 0,
    distribution: [],
    reminders: [],
    overdueCount: 0,
    overdueReminders: [],
    showOverdue: false,
    weekRange: '',
    recent: []
  },

  onShow() {
    syncTabBar(this, 0)
    this.setData({ showGuide: guide.shouldShow() })
    this.loadHome()
  },

  loadHome() {
    this.setData({ loading: true, error: '' })
    try {
      const now = Date.now()
      const data = store.snapshot(now)
      const summary = data.stats()
      const { upcoming, overdue } = data.reminderSchedule()
      this.overdue = overdue
      const showOverdue = overdue.length > 0 && this.data.showOverdue
      const distribution = STATUSES.map(status => ({
        ...status,
        count: summary.counts[status.id],
        width: summary.total ? (summary.counts[status.id] / summary.total * 100) + '%' : '0%'
      }))
      this.setData({
        loading: false,
        greeting: greetingFor(now),
        dateLabel: homeDate(now),
        total: summary.total,
        pendingStatusCount: summary.pendingStatusCount,
        weekAdded: summary.weekAdded,
        weekRange: toDateInput(startOfWeek(now)).slice(5) + ' 至 ' + toDateInput(now).slice(5),
        distribution,
        reminders: upcoming.slice(0, 3).map(item => reminderView(item, now, true)),
        overdueCount: overdue.length,
        showOverdue,
        overdueReminders: showOverdue ? overdue.map(item => reminderView(item, now, true)) : [],
        recent: data.list().slice(0, 5).map(item => applicationCard(item, now))
      })
      updateHomeBadge(upcoming.length)
    } catch (error) {
      this.setData({ loading: false, error: error.message })
      updateHomeBadge(0)
    }
  },

  toggleOverdue() {
    if (!this.overdue || !this.overdue.length) return
    const showOverdue = !this.data.showOverdue
    const now = Date.now()
    this.setData({
      showOverdue,
      overdueReminders: showOverdue ? this.overdue.map(item => reminderView(item, now, true)) : []
    })
  },

  showWeekDefinition() {
    wx.showModal({
      title: '本周投递',
      content: '统计 ' + this.data.weekRange + ' 的投递。按填写的投递日期计算，从周一 00:00 起算。',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  createApplication() {
    openPage('/pages/edit/edit')
  },

  openGuide() { openPage('/pages/help/help') },
  dismissGuide() {
    try { guide.acknowledge(); this.setData({ showGuide: false }) }
    catch (error) { wx.showToast({ title: error.message, icon: 'none' }) }
  },

  openApplication(event) {
    openPage(applicationUrl('detail', event.currentTarget.dataset.id))
  },

  openList() {
    openTab('/pages/list/list')
  }
})
