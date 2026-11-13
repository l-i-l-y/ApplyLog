
const store = require('../../utils/store')
const { STATUSES } = require('../../utils/constants')
const { copyText, toast, updateHomeBadge } = require('../../utils/ui')

Page({
  data: { loading: true, error: '', summary: null, counts: [] },

  onShow() {
    this.loadProfile()
  },

  loadProfile() {
    try {
      const data = store.snapshot()
      const summary = data.stats()
      this.setData({
        loading: false,
        error: '',
        summary,
        counts: STATUSES.map(item => ({ id: item.id, count: summary.counts[item.id] }))
      })
      updateHomeBadge(data.upcomingCount())
    } catch (error) {
      this.setData({ loading: false, error: error.message })
      updateHomeBadge(0)
    }
  },

  exportJson() {
    try {
      copyText(JSON.stringify(store.exportData(), null, 2), 'JSON 已复制')
    } catch (error) {
      toast(error.message)
    }
  },

  loadDemo() {
    try {
      const added = store.seedDemo()
      this.loadProfile()
      toast(added ? '已加载 ' + added + ' 条示例' : '示例数据已加载', 'success')
    } catch (error) {
      toast(error.message)
    }
  },

  removeDemo() {
    wx.showModal({
      title: '移除示例数据',
      content: '将删除标有「示例」的投递，包括后来编辑的内容及添加的提醒和复盘。手机日历事件需自行移除。',
      confirmText: '移除',
      confirmColor: '#A13D51',
      success: ({ confirm }) => {
        if (!confirm) return
        try {
          store.removeDemo()
          this.loadProfile()
          toast('示例数据已移除', 'success')
        } catch (error) {
          toast(error.message)
        }
      }
    })
  },

  requestClear() {
    if (!this.data.summary.total) {
      toast('当前没有可清空的投递')
      return
    }
    wx.showModal({
      title: '清空本机数据',
      content: '将删除此设备中的全部投递、应用内提醒和面试复盘。手机日历事件不会同步删除。',
      confirmText: '继续',
      confirmColor: '#A13D51',
      success: ({ confirm }) => {
        if (!confirm) return
        wx.showModal({
          title: '确认永久删除',
          content: '清空后无法恢复。如需备份，请先取消并复制 JSON。',
          confirmText: '清空',
          confirmColor: '#A13D51',
          success: result => {
            if (result.confirm) this.clearData()
          }
        })
      }
    })
  },

  clearData() {
    try {
      store.clear()
      this.loadProfile()
      toast('本机数据已清空', 'success')
    } catch (error) {
      toast(error.message)
    }
  }
})
