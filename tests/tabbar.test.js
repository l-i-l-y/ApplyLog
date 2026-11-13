const { test } = require('node:test')
const assert = require('node:assert/strict')

function environment() {
  const calls = { switches: [], toasts: [] }
  global.wx = {
    getWindowInfo: () => ({ screenHeight: 844, safeArea: { bottom: 810 } }),
    switchTab: options => calls.switches.push(options),
    showToast: options => calls.toasts.push(options)
  }
  delete require.cache[require.resolve('../utils/tabbar')]
  const tabs = require('../utils/tabbar')
  return { tabs, calls, page: { setData(patch) { Object.assign(this, patch) } } }
}

test('tab selection follows entering pages and programmatic switches, with one safe area', () => {
  const { tabs, page } = environment()
  tabs.syncTabBar(page, 0)
  assert.equal(page.tabBarHeight, 92)
  assert.equal(tabs.tabState().selected, 0)
  tabs.syncTabBar(page, 2)
  assert.equal(tabs.tabState().selected, 2)
  wx.getWindowInfo = () => ({ screenHeight: 568, safeArea: { bottom: 568 } })
  tabs.syncTabBar(page, 1)
  assert.equal(page.tabBarHeight, 58)
})

test('custom tab badge updates all instances, caps display and clears without native badge APIs', () => {
  const { tabs } = environment()
  const first = [], second = []
  const off = tabs.subscribeTabBar(state => first.push(state.badge))
  tabs.subscribeTabBar(state => second.push(state.badge))
  tabs.setHomeBadge(3); tabs.setHomeBadge(101); tabs.setHomeBadge(0)
  assert.deepEqual(first, ['', '3', '99+', ''])
  assert.deepEqual(second, first)
  off(); tabs.setHomeBadge(2)
  assert.equal(first.at(-1), '')
  assert.equal(second.at(-1), '2')
})

test('tab switching is guarded and reports failure without changing selection; retry succeeds', () => {
  const { tabs, calls, page } = environment()
  tabs.syncTabBar(page, 0)
  tabs.switchTab(1); tabs.switchTab(2)
  assert.equal(calls.switches.length, 1)
  assert.equal(tabs.tabState().selected, 0)
  calls.switches[0].fail()
  assert.match(calls.toasts[0].title, /重试/)
  tabs.switchTab(1)
  assert.equal(calls.switches[1].url, '/pages/list/list')
  tabs.syncTabBar(page, 1)
  tabs.switchTab(1)
  assert.equal(calls.switches.length, 2)
})

test('old-page resize cannot unlock an in-flight tab switch', () => {
  const { tabs, calls, page } = environment()
  tabs.syncTabBar(page, 0)
  tabs.switchTab(1)
  tabs.syncTabBar(page, 0)
  tabs.switchTab(2)
  assert.equal(calls.switches.length, 1)
  tabs.syncTabBar(page, 1)
  tabs.switchTab(2)
  assert.equal(calls.switches.length, 2)
})

test('keyboard temporarily hides the custom bar and page reentry restores it', () => {
  const { tabs, page } = environment()
  tabs.setTabKeyboard(true)
  assert.equal(tabs.tabState().keyboardOpen, true)
  page.data = { keyboardHeight: 300 }
  tabs.syncTabBar(page, 1)
  assert.equal(tabs.tabState().keyboardOpen, true)
  page.data.keyboardHeight = 0
  tabs.syncTabBar(page, 1)
  assert.equal(tabs.tabState().keyboardOpen, false)
})
