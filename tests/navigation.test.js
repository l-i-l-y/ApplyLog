const { test } = require('node:test')
const assert = require('node:assert/strict')

function navigation({ pages = 2, props = {}, windowInfo, rect } = {}) {
  const calls = { backs: [], tabs: [], toasts: [], events: [] }
  global.wx = {
    getDeviceInfo: () => ({ platform: 'devtools' }),
    getWindowInfo: () => windowInfo || ({ windowWidth: 390, windowHeight: 844, statusBarHeight: 47, safeArea: { top: 47, bottom: 810 } }),
    getMenuButtonBoundingClientRect: () => rect || ({ top: 51, bottom: 83, height: 32, left: 293, right: 383, width: 90 }),
    navigateBack: options => calls.backs.push(options),
    switchTab: options => calls.tabs.push(options),
    showToast: options => calls.toasts.push(options)
  }
  global.getCurrentPages = () => Array.from({ length: pages }, () => ({}))
  let definition
  global.Component = value => { definition = value }
  delete require.cache[require.resolve('../components/navigation-bar/navigation-bar')]
  require('../components/navigation-bar/navigation-bar')
  const component = {
    ...definition.methods,
    data: { ...Object.fromEntries(Object.entries(definition.properties).map(([key, value]) => [key, value.value])), ...definition.data, ...props },
    setData(patch) { Object.assign(this.data, patch) },
    triggerEvent(name, detail) { calls.events.push({ name, detail }) }
  }
  definition.lifetimes.attached.call(component)
  return { component, definition, calls }
}

test('navigation appearance follows initial and updated color and animation properties', () => {
  const { component, definition } = navigation({ props: { color: '#192439', background: '#F6F7FB' } })
  const style = () => Object.fromEntries(component.data.displayStyle.split(';').filter(Boolean)
    .map(pair => pair.split(':').map(value => value.trim())))
  assert.equal(style().color, '#192439')
  assert.equal(style().background, '#F6F7FB')
  Object.assign(component.data, { color: '#FFFFFF', background: '#192439', animated: false })
  definition.observers['color, background, animated'].call(component)
  assert.equal(style().color, '#FFFFFF')
  assert.equal(style().background, '#192439')
  assert.equal(style().transition, 'opacity 0s')
  component._showChange(false)
  assert.equal(style().color, '#FFFFFF')
  assert.equal(style().background, '#192439')
  assert.equal(style().opacity, '0')
  assert.equal(style()['pointer-events'], 'none')
})

test('back follows delta and emits the existing back payload once per accepted tap', () => {
  const { component, calls } = navigation({ pages: 4, props: { delta: 2 } })
  component.back()
  assert.equal(calls.backs.length, 1)
  assert.equal(calls.backs[0].delta, 2)
  assert.deepEqual(calls.events, [{ name: 'back', detail: { delta: 2 } }])
})

test('a direct entry returns to the home tab instead of attempting an empty stack', () => {
  const { component, calls } = navigation({ pages: 1 })
  component.back()
  assert.equal(calls.backs.length, 0)
  assert.equal(calls.tabs.length, 1)
  assert.equal(calls.tabs[0].url, '/pages/index/index')
})

test('back cannot pop multiple levels before completion or after success until page show', () => {
  const { component, definition, calls } = navigation({ pages: 4 })
  component.back(); component.back(); component.home()
  assert.equal(calls.backs.length, 1)
  assert.equal(calls.tabs.length, 0)
  calls.backs[0].success?.()
  calls.backs[0].complete?.()
  component.back()
  assert.equal(calls.backs.length, 1)
  assert.equal(calls.events.length, 1)
  definition.pageLifetimes.show.call(component)
  component.back()
  assert.equal(calls.backs.length, 2)
})

test('failed back explains the failure and immediately permits a retry', () => {
  const { component, calls } = navigation()
  component.back()
  calls.backs[0].fail?.({ errMsg: 'navigateBack:fail' })
  assert.equal(calls.toasts.length, 1)
  assert.match(calls.toasts[0].title, /返回.*失败.*重试/)
  assert.equal(calls.toasts[0].icon, 'none')
  component.back()
  assert.equal(calls.backs.length, 2)
})

test('home fallback and explicit home share the lock and failure recovery', () => {
  const { component, definition, calls } = navigation({ pages: 1, props: { homeButton: true } })
  component.back(); component.home()
  assert.equal(calls.tabs.length, 1)
  calls.tabs[0].fail?.()
  assert.match(calls.toasts[0]?.title || '', /首页.*失败.*重试/)
  component.home()
  assert.equal(calls.tabs.length, 2)
  assert.equal(calls.tabs[1].url, '/pages/index/index')
  calls.tabs[1].success?.(); calls.tabs[1].complete?.()
  component.home()
  assert.equal(calls.tabs.length, 2)
  definition.pageLifetimes.show.call(component)
  component.home()
  assert.equal(calls.tabs.length, 3)
})

test('synchronous platform navigation failures also release the lock', () => {
  const { component, calls } = navigation()
  wx.navigateBack = () => { throw new Error('unavailable') }
  assert.doesNotThrow(() => component.back())
  assert.match(calls.toasts[0]?.title || '', /失败.*重试/)
  wx.navigateBack = options => calls.backs.push(options)
  component.back()
  assert.equal(calls.backs.length, 1)
})

test('delta zero remains event-only and does not acquire a native navigation lock', () => {
  const { component, calls } = navigation({ pages: 1, props: { delta: 0 } })
  component.back(); component.back()
  assert.equal(calls.backs.length + calls.tabs.length, 0)
  assert.deepEqual(calls.events, [{ name: 'back', detail: { delta: 0 } }, { name: 'back', detail: { delta: 0 } }])
})

for (const fixture of [
  { name: 'regular', width: 390, height: 844, status: 47, top: 51, left: 293, content: 44, side: 105 },
  { name: 'narrow', width: 320, height: 568, status: 20, top: 28, left: 223, content: 48, side: 105 }
]) {
  test(fixture.name + ' metrics reserve a centered title area clear of the capsule and 44px buttons', () => {
    const { component } = navigation({
      props: { title: '一个很长很长的页面标题需要单行显示并省略' },
      windowInfo: { windowWidth: fixture.width, windowHeight: fixture.height, statusBarHeight: fixture.status, safeArea: { top: fixture.status, bottom: fixture.height } },
      rect: { top: fixture.top, bottom: fixture.top + 32, height: 32, left: fixture.left, right: fixture.width - 7, width: 90 }
    })
    assert.equal(component.data.statusHeight, fixture.status)
    assert.equal(component.data.contentHeight, fixture.content)
    assert.equal(component.data.leftInset, 16)
    assert.equal(component.data.sideInset, fixture.side)
    const titleLeft = component.data.sideInset
    const titleRight = fixture.width - component.data.sideInset
    assert.equal((titleLeft + titleRight) / 2, fixture.width / 2)
    assert.ok(titleLeft >= 16 + 44)
    assert.ok(titleRight <= fixture.left - 8)
    assert.ok(titleRight > titleLeft)
  })
}

test('safe area is honored without platform offsets when statusBarHeight or capsule is missing', () => {
  const { component } = navigation({
    windowInfo: { windowWidth: 320, windowHeight: 568, safeArea: { top: 24, bottom: 568 } },
    rect: { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0 }
  })
  assert.equal(component.data.statusHeight, 24)
  assert.equal(component.data.contentHeight, 44)
  assert.ok(component.data.sideInset >= 68)
})

test('both left buttons are included in the title clearance after a property change', () => {
  const { component, definition } = navigation({ props: { homeButton: true } })
  assert.ok(component.data.sideInset >= 16 + 88 + 8)
  component.data.homeButton = false
  definition.observers['back, homeButton'].call(component)
  assert.equal(component.data.sideInset, 105)
})

test('right slot width is reserved symmetrically and page resize refreshes metrics', () => {
  const { component, definition } = navigation()
  const query = {
    select() { return query }, boundingClientRect() { return query },
    exec(done) { done([{ width: 24 }]) }
  }
  component.createSelectorQuery = () => query
  definition.lifetimes.ready?.call(component)
  assert.equal(component.data.sideInset, 137)
  wx.getWindowInfo = () => ({ windowWidth: 320, windowHeight: 568, statusBarHeight: 20, safeArea: { top: 20, bottom: 568 } })
  wx.getMenuButtonBoundingClientRect = () => ({ top: 24, bottom: 56, height: 32, left: 223, right: 313, width: 90 })
  definition.pageLifetimes.resize.call(component)
  assert.equal(component.data.statusHeight, 20)
  assert.equal(component.data.contentHeight, 44)
})

test('a wide right slot on 320px screens cannot consume the entire title', () => {
  const { component, definition } = navigation({
    windowInfo: { windowWidth: 320, windowHeight: 568, statusBarHeight: 20, safeArea: { top: 20, bottom: 568 } },
    rect: { top: 24, bottom: 56, height: 32, left: 223, right: 313, width: 90 }
  })
  const query = {
    select() { return query }, boundingClientRect() { return query },
    exec(done) { done([{ width: 47 }]) }
  }
  component.createSelectorQuery = () => query
  definition.lifetimes.ready.call(component)
  assert.ok(320 - component.data.sideInset * 2 >= 68, 'retain enough title width for four normal Chinese characters')
  assert.ok(component.data.rightSlotMaxWidth <= 13)
})

for (const animated of [true, false]) {
  test('hidden navigation retains its space and ignores taps, animated=' + animated, () => {
    const { component, calls } = navigation({ props: { show: false, animated } })
    const style = Object.fromEntries(component.data.displayStyle.split(';').filter(Boolean).map(pair => pair.split(':').map(value => value.trim())))
    assert.notEqual(style.display, 'none')
    assert.equal(style.opacity, '0')
    assert.equal(style['pointer-events'], 'none')
    component.back(); component.home()
    assert.equal(calls.backs.length + calls.tabs.length + calls.events.length, 0)
    component.data.show = true
    component._showChange(true)
    component.back()
    assert.equal(calls.backs.length, 1)
  })
}
