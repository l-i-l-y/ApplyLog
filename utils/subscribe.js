
const REMINDER_TEMPLATE_ID = 'REPLACE_WITH_WECHAT_TEMPLATE_ID'

function requestReminderSubscription() {
  if (REMINDER_TEMPLATE_ID === 'REPLACE_WITH_WECHAT_TEMPLATE_ID') {
    return Promise.reject(new Error('尚未配置订阅消息模板'))
  }
  if (typeof wx.requestSubscribeMessage !== 'function') {
    return Promise.reject(new Error('当前微信版本暂不支持订阅消息'))
  }
  // 需由用户主动点击触发。真实推送需将提醒同步到后端，由云函数定时触发器查询到期提醒并发送。
  return new Promise((resolve, reject) => {
    wx.requestSubscribeMessage({
      tmplIds: [REMINDER_TEMPLATE_ID],
      success: resolve,
      fail: reject
    })
  })
}

module.exports = { REMINDER_TEMPLATE_ID, requestReminderSubscription }
