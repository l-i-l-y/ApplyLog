// 四个输入页共用。几何和键盘事件均为 px，禁用原生页面上推后只补实际遮挡。
const GAP = 12
const keyboardData = { keyboardHeight: 0, keyboardInset: 0, keyboardScrollTop: 0, keyboardInputMaxHeight: 160 }

function windowInfo() {
  return typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : {}
}

function keyboardInset(height, baseline, current, bottomOutside) {
  return Math.max(0, height - Math.max(0, baseline - current) - bottomOutside)
}

function scrollDelta(field, viewport) {
  if (field.bottom > viewport.bottom - GAP) return field.bottom - viewport.bottom + GAP
  if (field.top < viewport.top + GAP) return field.top - viewport.top - GAP
  return 0
}

const keyboardPage = {
  startKeyboard() {
    if (this.keyboardListening) return
    this.keyboardListening = true
    this.keyboardEpoch = (this.keyboardEpoch || 0) + 1
    this.keyboardLayoutEpoch = (this.keyboardLayoutEpoch || 0) + 1
    const info = windowInfo()
    this.keyboardWindowHeight = info.windowHeight || 0
    // tabBar 在页面外，键盘覆盖它的部分不应再从页面扣除。
    this.keyboardBottomOutside = Number.isFinite(info.screenTop) && info.screenHeight
      ? Math.max(0, info.screenHeight - info.screenTop - info.windowHeight) : 0
    this.keyboardListener = ({ height }) => {
      if (!this.keyboardListening) return
      if (height === 0 || this.keyboardAnchor) this.updateKeyboardHeight(height)
    }
    this.keyboardResizeListener = () => {
      if (this.data.keyboardHeight) this.updateKeyboardHeight(this.data.keyboardHeight)
      else if (!this.keyboardAnchor) this.keyboardWindowHeight = windowInfo().windowHeight || this.keyboardWindowHeight
    }
    if (wx.onKeyboardHeightChange) wx.onKeyboardHeightChange(this.keyboardListener)
    if (wx.onWindowResize) wx.onWindowResize(this.keyboardResizeListener)
  },

  stopKeyboard() {
    this.keyboardListening = false
    if (wx.offKeyboardHeightChange && this.keyboardListener) wx.offKeyboardHeightChange(this.keyboardListener)
    if (wx.offWindowResize && this.keyboardResizeListener) wx.offWindowResize(this.keyboardResizeListener)
    this.keyboardListener = null
    this.keyboardResizeListener = null
    this.releaseKeyboard()
  },

  releaseKeyboard(anchor) {
    if (anchor && this.keyboardAnchor !== anchor) return
    clearTimeout(this.keyboardBlurTimer)
    clearTimeout(this.keyboardMeasureTimer)
    this.keyboardEpoch = (this.keyboardEpoch || 0) + 1
    this.keyboardLayoutEpoch = (this.keyboardLayoutEpoch || 0) + 1
    this.keyboardAnchor = ''
    this.setData({ keyboardHeight: 0, keyboardInset: 0, keyboardInputMaxHeight: 160, focusField: '' })
  },

  onKeyboardFocus(event) {
    if (!this.keyboardListening) return
    clearTimeout(this.keyboardBlurTimer)
    this.keyboardEpoch += 1
    this.keyboardAnchor = event.currentTarget.dataset.anchor
    const height = event.detail.height || this.data.keyboardHeight
    if (height) this.updateKeyboardHeight(height)
  },

  onKeyboardBlur(event) {
    if (event.currentTarget.dataset.anchor !== this.keyboardAnchor) return
    const epoch = this.keyboardEpoch
    // 等待紧邻的 focus，避免 A blur → B focus 时先撤留位再重新加回。
    clearTimeout(this.keyboardBlurTimer)
    this.keyboardBlurTimer = setTimeout(() => {
      if (epoch === this.keyboardEpoch) this.releaseKeyboard()
    }, 60)
  },

  onFieldKeyboardHeight(event) {
    if (this.keyboardListening && this.keyboardAnchor && event.currentTarget.dataset.anchor === this.keyboardAnchor) {
      this.updateKeyboardHeight(event.detail.height)
    }
  },

  updateKeyboardHeight(value) {
    const height = Math.max(0, Number(value) || 0)
    if (!height) { this.releaseKeyboard(); return }
    const info = windowInfo()
    const current = info.windowHeight || this.keyboardWindowHeight
    const inset = keyboardInset(height, this.keyboardWindowHeight, current, this.keyboardBottomOutside)
    const epoch = this.keyboardEpoch
    const layoutEpoch = ++this.keyboardLayoutEpoch
    const applyInset = value => {
      if (layoutEpoch !== this.keyboardLayoutEpoch || !this.keyboardListening) return
      this.setData({ keyboardHeight: height, keyboardInset: value }, () => {
        if (epoch === this.keyboardEpoch) this.ensureKeyboardField()
      })
    }
    // Skyline 切换 tab/非 tab 页时 windowHeight 可能仍为 tab 页值。
    // 自定义导航的 shell 从屏顶开始，测量其实际底边才能扣掉页面外底栏，
    // 也自然扣除了系统已经 resize 的部分，避免重复上推。
    if (this.createSelectorQuery && info.screenHeight) {
      const query = this.createSelectorQuery()
      query.select('.page-shell').boundingClientRect()
      query.exec(([shell]) => applyInset(shell ? Math.max(0, height - Math.max(0, info.screenHeight - shell.bottom)) : inset))
    } else applyInset(inset)
    // 原生键盘动画完成后再量一次；焦点切换/手动拖动会取消这次定位。
    clearTimeout(this.keyboardMeasureTimer)
    this.keyboardMeasureTimer = setTimeout(() => {
      if (epoch === this.keyboardEpoch) this.ensureKeyboardField()
    }, 350)
  },

  onKeyboardScroll(event) {
    this.keyboardActualScrollTop = event.detail.scrollTop
  },

  onKeyboardTouchStart() {
    clearTimeout(this.keyboardMeasureTimer)
    this.keyboardEpoch += 1
  },

  ensureKeyboardField() {
    if (!this.keyboardListening || !this.keyboardAnchor || !this.data.keyboardHeight || !this.createSelectorQuery) return
    const epoch = this.keyboardEpoch
    const anchor = this.keyboardAnchor
    const measure = () => {
      if (epoch !== this.keyboardEpoch || !this.keyboardListening) return
      const query = this.createSelectorQuery()
      query.select('.page-scroll').boundingClientRect()
      query.select('#' + anchor).boundingClientRect()
      query.select('.page-scroll').scrollOffset()
      query.exec(results => {
        if (epoch !== this.keyboardEpoch || !this.data.keyboardHeight || this.keyboardAnchor !== anchor) return
        const [viewport, field, offset] = results
        if (!viewport || !field || !offset) return
        const maxHeight = Math.max(24, Math.floor(viewport.height - GAP * 2))
        if (maxHeight !== this.data.keyboardInputMaxHeight) {
          this.setData({ keyboardInputMaxHeight: maxHeight }, () => this.ensureKeyboardField())
          return
        }
        const delta = scrollDelta(field, viewport)
        if (Math.abs(delta) < 1) return
        const target = Math.max(0, offset.scrollTop + delta)
        // 先同步用户手动滚动后的实际值，重复定位同一目标仍可生效。
        this.setData({ keyboardScrollTop: offset.scrollTop }, () => {
          if (epoch === this.keyboardEpoch) this.setData({ keyboardScrollTop: target })
        })
      })
    }
    if (wx.nextTick) wx.nextTick(measure)
    else measure()
  }
}

module.exports = { keyboardPage, keyboardData, keyboardInset, scrollDelta }
