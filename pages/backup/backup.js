const backup = require('../../utils/backup')
const store = require('../../utils/store')
const { toast, updateHomeBadge } = require('../../utils/ui')

Page({
  data: { selecting: false, restoring: false, exporting: false, preparedFileName: '', preview: null, error: '', message: '', rollback: null, rollbackError: '' },
  onLoad() { this.alive = true },
  onShow() { this.loadRollback() },
  onUnload() { this.alive = false; this.pending = null },
  loadRollback() {
    try { this.setData({ rollback: backup.rollbackInfo(), rollbackError: '' }) }
    catch (error) { this.setData({ rollback: null, rollbackError: error.message }) }
  },
  async chooseFile() {
    if (this.data.selecting || this.data.restoring || this.data.exporting) return
    this.pending = null
    this.setData({ selecting: true, preview: null, error: '', message: '' })
    try {
      const preview = await backup.chooseBackup()
      if (!this.alive) return
      if (preview) {
        this.pending = preview
        this.setData({ preview: { exportedAt: preview.exportedAt || '未知（旧版完整 JSON 未提供备份时间）', counts: preview.counts } })
      } else this.setData({ message: '已取消选择，当前本机数据未改变。' })
    } catch (error) { if (this.alive) this.setData({ error: error.message }) }
    finally { if (this.alive) this.setData({ selecting: false }) }
  },
  cancelPreview() {
    if (this.data.restoring) return
    this.pending = null
    this.setData({ preview: null, error: '', message: '已取消预览，当前本机数据未改变。' })
  },
  confirmRestore() {
    if (!this.pending || this.data.restoring || this.data.selecting || this.data.exporting) return
    this.confirmOperation(false)
  },
  confirmRollback() {
    if (this.data.restoring || this.data.selecting || this.data.exporting || !this.data.rollback || !this.data.rollback.available || this.data.rollback.alreadyCurrent) return
    this.confirmOperation(true)
  },
  confirmOperation(rollback) {
    this.setData({ restoring: true, error: '', message: '' })
    const unlock = () => { if (this.alive) this.setData({ restoring: false }) }
    try {
      wx.showModal({
        title: rollback ? '回滚至恢复前？' : '替换当前本机数据？',
        content: rollback ? '将原样恢复上次恢复前的快照，当前记录将被替换。手机日历和外部备份不会随之改变。' : '这是整份恢复，不合并。将替换当前本机数据，并覆盖上一份回滚快照；本次原值会先完整保存和核验。手机日历事件不会迁移。',
        confirmText: rollback ? '回滚' : '恢复', cancelText: '取消', confirmColor: '#B03A50',
        success: result => {
          if (!this.alive) return
          if (!result.confirm) { unlock(); return }
          try {
            if (rollback) backup.rollback()
            else backup.restore(this.pending)
            this.pending = null
            this.setData({ preview: null, message: rollback ? '已回滚至恢复前的本机快照。请核对手机日历；外部备份和系统日历未改变。' : '整份恢复完成。请逐条核对手机日历；历史标记不代表当前设备已保存事件。' })
            try { updateHomeBadge(store.snapshot().upcomingCount()) } catch (error) { updateHomeBadge(0) }
          } catch (error) { this.setData({ error: error.message }) }
          finally { this.loadRollback(); unlock() }
        },
        fail: () => { if (this.alive) this.setData({ error: '未能打开确认窗口，未执行恢复。' }); unlock() }
      })
    } catch (error) { this.setData({ error: '未能打开确认窗口，未执行恢复。' }); unlock() }
  },
  exportRollback() { return this.exportSnapshot(false) },
  exportEmergency() { return this.exportSnapshot(true) },
  async exportSnapshot(emergency) {
    if (this.data.exporting || this.data.restoring || this.data.selecting) return
    this.preparedFile = null
    this.setData({ exporting: true, preparedFileName: '', error: '' })
    try {
      const result = await (emergency ? backup.exportEmergency() : backup.exportRollback())
      if (this.alive) {
        this.preparedFile = result
        this.setData({ preparedFileName: result.fileName, message: '快照文件已生成并核验，请点击“分享备份文件”。当前文件仍在小程序内。' })
      }
    } catch (error) { if (this.alive) this.setData({ error: error.message }) }
    finally { if (this.alive) this.setData({ exporting: false }) }
  },
  sharePreparedFile() {
    if (this.data.exporting || this.data.restoring || this.data.selecting || !this.preparedFile) return
    this.setData({ exporting: true, error: '' })
    return backup.shareFile(this.preparedFile).then(result => {
      if (this.alive) this.setData({ message: result.shared ? '已交给微信文件分享流程，请确认副本保存在小程序之外。' : '分享未完成，尚未确认保存到小程序之外。可以点击按钮重试。' })
    }, error => { if (this.alive) this.setData({ error: error.message }) }).finally(() => { if (this.alive) this.setData({ exporting: false }) })
  }
})
