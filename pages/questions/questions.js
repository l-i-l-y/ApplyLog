const { keyboardPage, keyboardData } = require('../../utils/keyboard')
const store = require('../../utils/store')
const { toDateInput } = require('../../utils/date')
const { applicationUrl, toast, updateHomeBadge } = require('../../utils/ui')

function textLines(text) {
  // Skyline 不支持 pre-wrap；只派生展示行，不改写题目或回答。
  return text.split(/\r\n|\r|\n/).map((text, key) => ({ key, text }))
}

function answerView(answer, expanded) {
  const characters = Array.from(answer)
  const previewLines = characters.slice(0, 180).join('').split(/\r\n|\r|\n/)
  const canExpand = Boolean(answer.trim()) && (characters.length > 180 || previewLines.length > 4)
  const answerText = !answer.trim() ? '暂未记录回答' : canExpand && !expanded
    ? previewLines.slice(0, 4).join('\n') + '…' : answer
  return { answerText, answerLines: textLines(answerText), canExpand, expanded: canExpand && expanded }
}

Page({
  ...keyboardPage,
  data: {
    ...keyboardData,
    loading: true, error: '', query: '', hasQuery: false,
    items: [], total: 0, reviewCount: 0, matched: 0
  },

  onShow() {
    this.openingReview = false
    this.suppressedQuestionKey = null
    this.startKeyboard()
    this.loadQuestions()
    // 从原复盘返回时保留原滚动位置；内容缩短时由 scroll-view 自然钳制。
    if (Number.isFinite(this.keyboardActualScrollTop)) {
      this.setData({ keyboardScrollTop: this.keyboardActualScrollTop })
    }
  },

  onHide() { this.stopKeyboard() },
  onUnload() { this.stopKeyboard() },

  loadQuestions() {
    try {
      this.applySnapshot(store.snapshot())
    } catch (error) {
      this.setData({ loading: false, error: error.message })
      updateHomeBadge(0)
    }
  },

  applySnapshot(snapshot) {
    const result = snapshot.questions(this.data.query)
    const previous = this.expandedAnswers || new Map()
    this.questionRows = new Map(result.items.map(item => [item.key, item]))
    this.expandedAnswers = new Map()
    const items = result.items.map(({ sourceFingerprint, ...item }) => {
      const expanded = previous.get(item.key) === sourceFingerprint
      if (expanded) this.expandedAnswers.set(item.key, sourceFingerprint)
      return { ...item, questionLines: textLines(item.q), dateLabel: toDateInput(item.date), ...answerView(item.myAnswer, expanded) }
    })
    this.setData({ ...result, items, loading: false, error: '' })
    updateHomeBadge(snapshot.upcomingCount())
  },

  onSearch(event) {
    this.setData({ query: event.detail.value })
    this.loadQuestions()
    this.ensureKeyboardField()
  },

  clearSearch() {
    this.setData({ query: '' })
    this.loadQuestions()
    this.ensureKeyboardField()
  },

  toggleAnswer(event) {
    const key = event.currentTarget.dataset.key
    const row = this.questionRows && this.questionRows.get(key)
    if (!row) return
    const expanded = !this.expandedAnswers.has(key)
    if (expanded) this.expandedAnswers.set(key, row.sourceFingerprint)
    else this.expandedAnswers.delete(key)
    this.setData({ items: this.data.items.map(item => item.key === key
      ? { ...item, ...answerView(item.myAnswer, expanded) } : item) })
  },

  onQuestionTouchStart() { this.suppressedQuestionKey = null },
  onQuestionLongPress(event) { this.suppressedQuestionKey = event.currentTarget.dataset.key },

  openReview(event) {
    const key = event.currentTarget.dataset.key
    if (this.openingReview || this.suppressedQuestionKey === key || this.data.loading || this.data.error) return
    const item = this.questionRows && this.questionRows.get(key)
    if (!item) return
    try {
      const snapshot = store.snapshot()
      const record = snapshot.get(item.applicationId)
      const review = record && record.interviews.find(candidate => candidate.id === item.reviewId)
      this.applySnapshot(snapshot)
      if (!review) {
        toast(record ? '这篇面试复盘已不存在' : '这条投递记录已不存在')
        return
      }
      this.openingReview = true
      const fail = () => { this.openingReview = false; toast('暂时无法打开页面，请重试') }
      try { wx.navigateTo({ url: applicationUrl('interview', item.applicationId) + '&review=' + encodeURIComponent(item.reviewId), fail }) }
      catch (error) { fail() }
    } catch (error) {
      this.setData({ loading: false, error: error.message })
      updateHomeBadge(0)
    }
  }
})
