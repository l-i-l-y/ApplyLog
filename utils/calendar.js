
const { reminderTitle } = require('./ui')

function addReminderToCalendar(application, reminder, { success, fail }) {
  if (typeof wx.addPhoneCalendar !== 'function') {
    fail(new Error('当前环境不支持手机日历，请在手机微信中重试'))
    return
  }

  const startTime = Math.floor(reminder.time / 1000)
  const duration = reminder.type === 'interview' ? 45 * 60 : 15 * 60
  const description = [
    application.position,
    reminder.link ? '会议链接：' + reminder.link : '',
    reminder.note
  ].filter(Boolean).join('\n')

  wx.addPhoneCalendar({
    title: application.company + ' · ' + reminderTitle(reminder),
    startTime,
    endTime: startTime + duration,
    description,
    location: reminder.location,
    alarm: true,
    alarmOffset: 0,
    success,
    fail
  })
}

module.exports = { addReminderToCalendar }
