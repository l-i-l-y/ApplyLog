const tabs = require('../utils/tabbar')

Component({
  data: { ...tabs.tabState(), items: tabs.TABS },
  lifetimes: {
    attached() {
      this.unsubscribe = tabs.subscribeTabBar(state => this.setData(state))
      this.resizeListener = () => this.syncCurrentPage()
      if (wx.onWindowResize) wx.onWindowResize(this.resizeListener)
      this.syncCurrentPage()
    },
    detached() {
      if (this.unsubscribe) this.unsubscribe()
      if (wx.offWindowResize && this.resizeListener) wx.offWindowResize(this.resizeListener)
    }
  },
  pageLifetimes: { show() { this.syncCurrentPage() } },
  methods: {
    syncCurrentPage() {
      const stack = getCurrentPages()
      const page = stack[stack.length - 1]
      const index = page ? tabs.TABS.findIndex(item => item.pagePath === page.route) : -1
      if (index >= 0) tabs.syncTabBar(page, index)
    },
    selectTab(event) { tabs.switchTab(Number(event.currentTarget.dataset.index)) }
  }
})
