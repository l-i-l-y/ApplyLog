const { keyboardPage, keyboardData } = require('../../utils/keyboard')

const store = require('../../utils/store')
const { STATUS_FILTERS } = require('../../utils/constants')
const { applicationCard, applicationUrl, openPage, toast, updateHomeBadge } = require('../../utils/ui')

Page({
  ...keyboardPage,
  data: {
    ...keyboardData,
    loading: true,
    error: '',
    query: '',
    filter: 'all',
    filters: STATUS_FILTERS,
    records: [],
    hasFilter: false
  },

  onShow() {
    this.startKeyboard()
    this.loadList()
  },

  onHide() { this.stopKeyboard() },

  onUnload() { this.stopKeyboard() },

  loadList() {
    try {
      const { query, filter } = this.data
      const now = Date.now()
      const data = store.snapshot(now)
      this.setData({
        loading: false,
        error: '',
        records: data.list({ query, status: filter }).map(record => applicationCard(record, now)),
        hasFilter: Boolean(query.trim() || filter !== 'all')
      })
      updateHomeBadge(data.upcomingCount())
    } catch (error) {
      this.setData({ loading: false, error: error.message })
      updateHomeBadge(0)
    }
  },

  onSearch(event) {
    this.setData({ query: event.detail.value })
    this.loadList()
  },

  clearSearch() {
    this.setData({ query: '' })
    this.loadList()
  },

  selectFilter(event) {
    this.setData({ filter: event.currentTarget.dataset.filter })
    this.loadList()
  },

  resetFilters() {
    this.setData({ query: '', filter: 'all' })
    this.loadList()
  },

  createApplication() {
    openPage('/pages/edit/edit')
  },

  openApplication(event) {
    openPage(applicationUrl('detail', event.currentTarget.dataset.id))
  },

  openMenu(event) {
    const id = (event.detail && event.detail.id) || event.currentTarget.dataset.id
    if (!id) return
    wx.showActionSheet({
      itemList: ['编辑投递', '删除投递'],
      success: ({ tapIndex }) => {
        if (tapIndex === 0) openPage(applicationUrl('edit', id))
        if (tapIndex === 1) this.confirmDelete(id)
      }
    })
  },

  confirmDelete(id) {
    let record
    try {
      record = store.get(id)
    } catch (error) {
      toast(error.message)
      return
    }
    if (!record) {
      this.loadList()
      toast('这条投递记录已不存在')
      return
    }
    const calendarNotice = record.reminders.some(item => item.calendarAddedAt || item.calendarPendingAt)
      ? ' 已加入手机日历的提醒可在日历中移除。' : ''
    wx.showModal({
      title: '删除投递记录',
      content: '将删除「' + record.company + '」的这条记录及其提醒和复盘。' + calendarNotice,
      confirmText: '删除',
      confirmColor: '#A13D51',
      success: ({ confirm }) => {
        if (!confirm) return
        try {
          const removed = store.remove(id)
          this.loadList()
          toast(removed ? '投递记录已删除' : '这条投递记录已不存在', removed ? 'success' : 'none')
        } catch (error) {
          toast(error.message)
        }
      }
    })
  }
})
