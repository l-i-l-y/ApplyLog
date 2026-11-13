// Let WeChat present its configured privacy authorization. No custom permission scopes.
function privacyAuthorization() {
  return new Promise((resolve, reject) => {
    if (typeof wx.requirePrivacyAuthorize !== 'function') { resolve(); return }
    try {
      wx.requirePrivacyAuthorize({ success: resolve, fail: () => reject(new Error('未完成微信隐私授权，操作已取消；可重试并查看隐私说明')) })
    } catch (error) { reject(new Error('无法请求微信隐私授权，请检查后台隐私配置并重试')) }
  })
}
module.exports = { privacyAuthorization }
