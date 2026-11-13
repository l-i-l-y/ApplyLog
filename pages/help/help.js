const { GUIDE, PRIVACY, versionInfo } = require('../../utils/app-info')
const { toast } = require('../../utils/ui')
Page({
  data: { title: '使用与隐私说明', guide: GUIDE, privacy: PRIVACY, version: null, canOpenPrivacy: false },
  onShow() { this.setData({ version: versionInfo(), canOpenPrivacy: typeof wx.openPrivacyContract === 'function' }) },
  openPrivacy() {
    if (typeof wx.openPrivacyContract !== 'function') { toast('请在手机微信中查看隐私指引'); return }
    wx.openPrivacyContract({ fail: () => toast('微信隐私指引暂无法打开，请检查后台配置') })
  }
})
