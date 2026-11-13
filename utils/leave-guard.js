const { returnToPrevious, toast } = require('./ui')

const leaveGuard = {
  formSignature() { return JSON.stringify(this.editSnapshot()) },
  beginLeaveGuard() {
    this.leaveGuardActive = true
    this.leaveNavigating = false
    this.leaveConfirming = false
    if (this.savedFormSnapshot === undefined) this.savedFormSnapshot = this.formSignature()
    this.refreshLeaveGuard()
  },
  isFormDirty() { return this.savedFormSnapshot !== undefined && this.formSignature() !== this.savedFormSnapshot },
  afterFormChange() { this.refreshLeaveGuard(); this.ensureKeyboardField() },
  refreshLeaveGuard() {
    if (!this.leaveGuardActive) return
    const dirty = this.isFormDirty()
    if (dirty && !this.nativeLeaveEnabled && !this.nativeLeaveUnavailable && typeof wx.enableAlertBeforeUnload === 'function') {
      this.nativeLeaveEnabled = true
      try {
        wx.enableAlertBeforeUnload({ message: '有未保存的修改，离开后将丢失。', fail: () => { this.nativeLeaveEnabled = false; this.nativeLeaveUnavailable = true } })
      } catch (error) { this.nativeLeaveEnabled = false; this.nativeLeaveUnavailable = true }
    } else if (!dirty) this.disableNativeLeaveGuard()
  },
  disableNativeLeaveGuard() {
    if (this.nativeLeaveEnabled && typeof wx.disableAlertBeforeUnload === 'function') {
      try { wx.disableAlertBeforeUnload({}) } catch (error) { /* Custom navigation protection still works. */ }
    }
    this.nativeLeaveEnabled = false
  },
  suspendLeaveGuard() { this.leaveGuardActive = false; this.disableNativeLeaveGuard() },
  markFormSaved() { this.savedFormSnapshot = this.formSignature(); this.refreshLeaveGuard() },
  requestLeave() {
    if (this.data.saving || this.leaveConfirming || this.leaveNavigating) return
    const proceed = () => {
      this.leaveNavigating = true
      this.disableNativeLeaveGuard()
      returnToPrevious('', 'none', () => {
        this.leaveNavigating = false
        this.refreshLeaveGuard()
      }, '返回失败，仍可继续编辑或重试')
    }
    if (!this.isFormDirty()) { proceed(); return }
    this.leaveConfirming = true
    const unlock = () => { this.leaveConfirming = false }
    try {
      wx.showModal({
        title: '放弃未保存的修改？', content: '当前修改尚未保存，离开后将丢失。',
        cancelText: '继续编辑', confirmText: '放弃修改', confirmColor: '#B03A50',
        success: result => { unlock(); if (this.leaveGuardActive && result.confirm) proceed() },
        fail: () => { unlock(); toast('无法确认离页，请重试；修改仍保留') }
      })
    } catch (error) { unlock(); toast('无法确认离页，请重试；修改仍保留') }
  }
}
module.exports = { leaveGuard }
