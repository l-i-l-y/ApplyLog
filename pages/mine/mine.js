
const { syncTabBar } = require('../../utils/tabbar')
const store = require('../../utils/store')
const backup = require('../../utils/backup')
const { versionInfo, canManageDemo } = require('../../utils/app-info')
const { STATUSES } = require('../../utils/constants')
const { copyText, openPage, toast, updateHomeBadge } = require('../../utils/ui')

Page({
  data: { tabBarHeight: 58, loading: true, error: '', summary: null, counts: [], questionCount: 0, exporting: false, sharing: false, clearing: false, preparedFileName: '', fileMessage: '', version: null, canFeedback: false, canManageDemo: false },

  onShow() {
    this.alive = true
    syncTabBar(this, 2)
    this.setData({ version: versionInfo(), canFeedback: typeof wx.canIUse === 'function' && wx.canIUse('button.open-type.feedback'), canManageDemo: canManageDemo() })
    this.loadProfile()
  },
  onUnload() { this.alive = false },

  openBackup() { openPage('/pages/backup/backup') },
  openGuide() { openPage('/pages/help/help') },
  exportBackup() {
    if (this.data.exporting || this.data.sharing || this.data.clearing) return
    this.preparedBackup = null
    this.setData({ exporting: true, preparedFileName: '', fileMessage: '' })
    const unlock = () => { if (this.alive) this.setData({ exporting: false }) }
    try {
      wx.showModal({ title: '导出本机备份', content: '备份包含公司、薪资、面试记录等内容，请妥善保管。先生成并核验 UTF-8 JSON，再点“分享备份文件”保存到小程序之外；小程序工作目录不是永久备份。', confirmText: '生成',
        success: async result => {
          if (!this.alive) return
          if (!result.confirm) { unlock(); return }
          try {
            const file = await backup.prepareFile()
            if (this.alive) {
              this.preparedBackup = file
              this.setData({ preparedFileName: file.fileName, fileMessage: '备份文件已生成并核验。请点“分享备份文件”保存到小程序之外；修改记录后请重新生成备份。' })
            }
          } catch (error) { if (this.alive) this.setData({ fileMessage: error.message }) }
          finally { unlock() }
        }, fail: () => { toast('未能打开导出确认，请重试'); unlock() }
      })
    } catch (error) { toast('未能打开导出确认，请重试'); unlock() }
  },
  shareBackup() {
    if (this.data.exporting || this.data.sharing || this.data.clearing || !this.preparedBackup) return
    this.setData({ sharing: true, fileMessage: '' })
    // Call before this tap handler yields; do not perform asynchronous work here.
    return backup.shareFile(this.preparedBackup).then(file => {
      if (this.alive) this.setData({ fileMessage: file.shared ? '已交给微信文件分享流程，请确认副本保存在小程序之外。' : file.cancelled ? '已取消分享，尚未确认保存到小程序之外。可直接重试分享此文件。' : '当前环境不支持文件分享，尚未保存到小程序之外；请升级微信或先复制 JSON。' })
    }, error => { if (this.alive) this.setData({ fileMessage: error.message }) }).finally(() => { if (this.alive) this.setData({ sharing: false }) })
  },

  loadProfile() {
    try {
      const data = store.snapshot()
      const summary = data.stats()
      this.setData({
        loading: false,
        error: '',
        summary,
        questionCount: data.questions().total,
        counts: STATUSES.map(item => ({ id: item.id, count: summary.counts[item.id] }))
      })
      updateHomeBadge(data.upcomingCount())
    } catch (error) {
      this.setData({ loading: false, error: error.message })
      updateHomeBadge(0)
    }
  },

  openQuestions() {
    openPage('/pages/questions/questions')
  },

  exportJson() {
    try {
      copyText(JSON.stringify(store.exportData(), null, 2), 'JSON 已复制')
    } catch (error) {
      toast(error.message)
    }
  },

  loadDemo() {
    if (!canManageDemo()) return
    try {
      const added = store.seedDemo()
      this.loadProfile()
      toast(added ? '已加载 ' + added + ' 条示例' : '示例数据已加载', 'success')
    } catch (error) {
      toast(error.message)
    }
  },

  removeDemo() {
    if (!canManageDemo()) return
    wx.showModal({
      title: '移除示例数据',
      content: '将删除标有「示例」的投递，包括后来编辑的内容及添加的提醒和复盘。手机日历事件和外部备份文件不会自动删除，需分别手动处理。',
      confirmText: '移除',
      confirmColor: '#B03A50',
      success: ({ confirm }) => {
        if (!confirm || !this.alive || !canManageDemo()) return
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
    if (this.data.clearing || this.data.exporting || this.data.sharing) return
    wx.showModal({
      title: '清空本机数据',
      content: '将删除此设备中的全部投递、应用内提醒、面试复盘和偏好，并移除本机回滚快照及导出工作文件。手机日历事件和外部备份文件不会自动删除。',
      confirmText: '继续',
      confirmColor: '#B03A50',
      success: ({ confirm }) => {
        if (!confirm) return
        wx.showModal({
          title: '确认永久删除',
          content: '本机回滚快照也会删除。请先取消并导出备份到小程序之外。系统日历事件及外部备份需分别手动处理。',
          confirmText: '清空',
          confirmColor: '#B03A50',
          success: result => {
            if (result.confirm) this.clearData()
          }
        })
      }
    })
  },

  async clearData() {
    if (this.data.clearing || this.data.exporting || this.data.sharing) return
    this.setData({ clearing: true, fileMessage: '' })
    try {
      store.clear()
      this.preparedBackup = null
      this.setData({ preparedFileName: '' })
      this.loadProfile()
      await backup.clearLocalBackups()
      toast('本机数据已清空', 'success')
    } catch (error) {
      this.setData({ fileMessage: error.message })
      toast(error.message)
    } finally { this.setData({ clearing: false }) }
  }
})
