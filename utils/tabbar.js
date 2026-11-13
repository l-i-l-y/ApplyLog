// 自定义 tabBar 的瞬时 UI 状态，不额外读取/持久化业务数据。
const TABS = [
  { pagePath: 'pages/index/index', text: '首页', icon: 'overview' },
  { pagePath: 'pages/list/list', text: '投递', icon: 'records' },
  { pagePath: 'pages/mine/mine', text: '我的', icon: 'profile' }
]
const CONTENT_HEIGHT = 58
let state = { selected: 0, badge: '', safeBottom: 0, keyboardOpen: false }
let pendingTab = null
const listeners = new Set()

function tabState() { return { ...state } }
function publish(patch) {
  state = { ...state, ...patch }
  listeners.forEach(listener => listener(tabState()))
}
function subscribeTabBar(listener) {
  listeners.add(listener)
  listener(tabState())
  return () => listeners.delete(listener)
}
function safeBottom() {
  const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : {}
  return info.safeArea && info.screenHeight ? Math.max(0, info.screenHeight - info.safeArea.bottom) : 0
}
function syncTabBar(page, selected) {
  const bottom = safeBottom()
  if (page && page.setData) page.setData({ tabBarHeight: CONTENT_HEIGHT + bottom })
  if (selected === pendingTab) pendingTab = null
  publish({ selected, safeBottom: bottom, keyboardOpen: Boolean(page && page.data && page.data.keyboardHeight > 0) })
}
function setHomeBadge(count) {
  publish({ badge: count > 99 ? '99+' : count > 0 ? String(count) : '' })
}
function setTabKeyboard(open) { publish({ keyboardOpen: Boolean(open) }) }
function switchTab(index) {
  if (!Number.isInteger(index) || !TABS[index] || pendingTab !== null || index === state.selected) return
  pendingTab = index
  const fail = () => {
    pendingTab = null
    wx.showToast({ title: '暂时无法切换页面，请重试', icon: 'none' })
  }
  try {
    wx.switchTab({ url: '/' + TABS[index].pagePath, fail })
  } catch (_) { fail() }
}

module.exports = { TABS, CONTENT_HEIGHT, tabState, subscribeTabBar, syncTabBar, setHomeBadge, setTabKeyboard, switchTab }
