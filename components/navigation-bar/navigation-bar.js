Component({
  options: {
    multipleSlots: true // 在组件定义时的选项中启用多slot支持
  },
  /**
   * 组件的属性列表
   */
  properties: {
    extClass: {
      type: String,
      value: ''
    },
    title: {
      type: String,
      value: ''
    },
    background: {
      type: String,
      value: ''
    },
    color: {
      type: String,
      value: ''
    },
    back: {
      type: Boolean,
      value: true
    },
    loading: {
      type: Boolean,
      value: false
    },
    homeButton: {
      type: Boolean,
      value: false,
    },
    animated: {
      // 显示隐藏的时候opacity动画效果
      type: Boolean,
      value: true
    },
    show: {
      // 显示隐藏导航，隐藏的时候navigation-bar的高度占位还在
      type: Boolean,
      value: true,
      observer: '_showChange'
    },
    // back为true的时候，返回的页面深度
    delta: {
      type: Number,
      value: 1
    },
  },
  /**
   * 组件的初始数据
   */
  data: {
    displayStyle: '',
    statusHeight: 0,
    contentHeight: 44,
    leftInset: 16,
    sideInset: 68,
    capsuleInset: 60,
    rightSlotMaxWidth: 44
  },
  observers: {
    'color, background, animated'() {
      this._showChange(this.data.show)
    },
    'back, homeButton'() {
      this._updateMetrics()
    }
  },
  lifetimes: {
    attached() {
      this._navigating = false
      this._updateMetrics()
      this._showChange(this.data.show)
    },
    ready() {
      this._measureRightSlot()
    }
  },
  pageLifetimes: {
    show() {
      // Keep a successful navigation locked until this page is entered again.
      this._navigating = false
      this._updateMetrics()
      this._measureRightSlot()
    },
    resize() {
      this._updateMetrics()
      this._measureRightSlot()
    }
  },
  /**
   * 组件的方法列表
   */
  methods: {
    _updateMetrics() {
      let info = {}, rect = {}
      try {
        info = (typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()) || {}
      } catch (error) { /* Keep the usable 44px row if native metrics are unavailable. */ }
      try {
        rect = wx.getMenuButtonBoundingClientRect() || {}
      } catch (error) { /* The capsule can be unavailable during initial attachment. */ }
      const width = Number(info.windowWidth) || 375
      const statusHeight = Math.max(0, Number(info.statusBarHeight) || 0, Number((info.safeArea || {}).top) || 0)
      const hasCapsule = rect.height > 0 && rect.width > 0 && rect.left > 0 && rect.left < width && rect.top >= statusHeight
      const contentHeight = hasCapsule ? Math.max(44, rect.height + 2 * (rect.top - statusHeight)) : 44
      const capsuleInset = hasCapsule ? width - rect.left + 8 : 60
      const buttonsWidth = 44 * (Number(this.data.back) + Number(this.data.homeButton))
      const leftSpace = 16 + Math.max(44, buttonsWidth) + 8
      // Leave four 17px characters visible even when a right slot is oversized.
      const rightSlotMaxWidth = Math.max(0, (width - 68) / 2 - capsuleInset - 8)
      const slotWidth = Math.min(this._rightSlotWidth || 0, rightSlotMaxWidth)
      this.setData({
        statusHeight,
        contentHeight,
        leftInset: 16,
        capsuleInset,
        rightSlotMaxWidth,
        sideInset: Math.max(leftSpace, capsuleInset + (slotWidth ? slotWidth + 8 : 0))
      })
    },
    _measureRightSlot() {
      if (typeof this.createSelectorQuery !== 'function') return
      this.createSelectorQuery().select('.weui-navigation-bar__right').boundingClientRect().exec(result => {
        const width = result && result[0] && result[0].width || 0
        if (width !== (this._rightSlotWidth || 0)) {
          this._rightSlotWidth = width
          this._updateMetrics()
        }
      })
    },
    _showChange(show) {
      // Opacity keeps the navigation placeholder for both animation modes.
      const displayStyle = `color: ${this.data.color};background: ${this.data.background};opacity: ${show ? '1' : '0'};pointer-events: ${show ? 'auto' : 'none'};transition:opacity ${this.data.animated ? '0.5s' : '0s'};`
      this.setData({
        displayStyle
      })
    },
    home() {
      if (!this.data.show) return
      this._navigate(true)
    },
    back() {
      if (!this.data.show || this._navigating) return
      const delta = this.data.delta
      // delta=0 delegates entirely to the consumer's existing back event.
      if (delta) {
        this._navigate(getCurrentPages().length <= 1, delta)
      }
      this.triggerEvent('back', { delta }, {})
    },
    _navigate(home, delta) {
      if (this._navigating) return
      this._navigating = true
      const fail = () => {
        this._navigating = false
        wx.showToast({ title: home ? '返回首页失败，请重试' : '返回失败，请重试', icon: 'none' })
      }
      try {
        if (home) wx.switchTab({ url: '/pages/index/index', fail })
        else wx.navigateBack({ delta, fail })
      } catch (error) {
        fail()
      }
    }
  },
})
