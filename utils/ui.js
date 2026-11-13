
const { STATUS_BY_ID, isDemoId } = require('./constants')
const { formatDay, formatSchedule } = require('./date')

function toast(title, icon = 'none') {
  wx.showToast({ title, icon })
}

function openPage(url) {
  wx.navigateTo({ url, fail: () => toast('暂时无法打开页面，请重试') })
}

function openTab(url) {
  wx.switchTab({ url, fail: () => toast('暂时无法打开页面，请重试') })
}

function returnToPrevious(message, icon = 'success', onFailure) {
  const success = () => toast(message, icon)
  const fail = error => {
    console.error('ApplyLog navigation failed', error)
    if (onFailure) onFailure()
    toast(onFailure ? '数据已保存，但返回失败，请重试或手动返回' : '返回失败，请手动返回或重试')
  }
  const fallback = () => wx.switchTab({ url: '/pages/list/list', success, fail })
  if (getCurrentPages().length > 1) {
    wx.navigateBack({ success, fail: fallback })
  } else {
    fallback()
  }
}

function applicationUrl(page, id) {
  return '/pages/' + page + '/' + page + '?id=' + encodeURIComponent(id)
}

function copyText(data, message = '已复制') {
  wx.setClipboardData({
    data,
    success: () => toast(message, 'success'),
    fail: () => toast('复制失败，请重试')
  })
}

function updateHomeBadge(count) {
  const fail = error => console.error('ApplyLog tab badge update failed', error)
  if (count > 0 && typeof wx.setTabBarBadge === 'function') {
    wx.setTabBarBadge({ index: 0, text: count > 99 ? '99+' : String(count), fail })
  } else if (count === 0 && typeof wx.removeTabBarBadge === 'function') {
    wx.removeTabBarBadge({ index: 0, fail })
  }
}

function reminderTitle(reminder) {
  if (reminder.type === 'followup') return '跟进提醒'
  return reminder.round ? '面试 · ' + reminder.round : '面试提醒'
}

function reminderView(reminder, now, showCompany = false) {
  const title = reminderTitle(reminder)
  const companyLabel = isDemoId(reminder.applicationId) ? '示例 · ' + reminder.company : reminder.company
  return {
    ...reminder,
    ...(showCompany ? { viewKey: JSON.stringify([reminder.applicationId, reminder.id]) } : {}),
    title: showCompany ? companyLabel : title,
    subtitle: showCompany ? title : '',
    timeLabel: formatSchedule(reminder.time, now),
    overdue: !reminder.done && reminder.time < now
  }
}

function applicationCard(record, now) {
  const next = record.reminders.reduce((first, reminder) => {
    if (reminder.done || reminder.time < now) return first
    return !first || reminder.time < first.time ? reminder : first
  }, null)
  return {
    id: record.id,
    company: record.company,
    position: record.position,
    status: record.status,
    demo: isDemoId(record.id),
    initial: Array.from(record.company)[0],
    dateLabel: formatDay(record.appliedAt, now),
    nextReminder: next ? reminderTitle(next) + ' · ' + formatSchedule(next.time, now) : ''
  }
}

function timelineView(entry, now) {
  return {
    ...entry,
    color: STATUS_BY_ID[entry.status].color,
    label: STATUS_BY_ID[entry.status].label,
    timeLabel: formatSchedule(entry.time, now)
  }
}

module.exports = {
  toast, openPage, openTab, returnToPrevious, applicationUrl, copyText, updateHomeBadge,
  reminderTitle, reminderView, applicationCard, timelineView
}
