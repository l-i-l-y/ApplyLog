const GUIDE_KEY = 'applylog-intro-v1'
function shouldShow() { try { return !wx.getStorageSync(GUIDE_KEY) } catch (error) { return true } }
function acknowledge() {
  try { wx.setStorageSync(GUIDE_KEY, { version: 1, acknowledgedAt: Date.now() }) }
  catch (error) { throw new Error('无法保存已读状态，请稍后重试') }
}
module.exports = { GUIDE_KEY, shouldShow, acknowledge }
