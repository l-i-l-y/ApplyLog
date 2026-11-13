const { keyboardPage, keyboardData } = require('../../utils/keyboard')
const { leaveGuard } = require('../../utils/leave-guard')

const store = require('../../utils/store')
const { INTERVIEW_ROUNDS, isDemoId } = require('../../utils/constants')
const { toDateInput, parseDate, dayStart } = require('../../utils/date')
const { returnToPrevious, toast } = require('../../utils/ui')

Page({
  ...keyboardPage,
  ...leaveGuard,
  data: {
    ...keyboardData,
    loading: true,
    error: '',
    saving: false,
    title: '面试复盘',
    company: '',
    position: '',
    demo: false,
    today: '',
    rounds: INTERVIEW_ROUNDS,
    stars: [1, 2, 3, 4, 5],
    form: { roundIndex: 0, date: '', questions: [], reflection: '', selfScore: 0 },
    errors: { date: false, score: false, questionIndex: -1 }
  },

  onLoad(options) {
    this.applicationId = options.id || ''
    this.reviewId = options.review || ''
    this.questionSequence = 0
    this.originalQuestions = new Map()
    this.setData({ title: this.reviewId ? '编辑面试复盘' : '面试复盘', demo: isDemoId(this.applicationId) })
  },

  onShow() {
    this.startKeyboard()
    this.setData({ saving: false })
    this.loadReview()
  },

  onHide() { this.stopKeyboard(); this.suspendLeaveGuard() },

  onUnload() { this.stopKeyboard(); this.suspendLeaveGuard() },

  editSnapshot() {
    const form = this.data.form
    return { round: INTERVIEW_ROUNDS[form.roundIndex], date: form.date, reflection: form.reflection || '', selfScore: form.selfScore,
      questions: form.questions.filter(item => item.q.trim() || item.myAnswer.trim()).map(({ q, myAnswer }) => ({ q, myAnswer })) }
  },

  loadReview() {
    if (!this.initialized) this.setData({ loading: true, error: '' })
    try {
      const record = store.get(this.applicationId)
      const review = record && this.reviewId ? record.interviews.find(item => item.id === this.reviewId) : null
      if (!record || (this.reviewId && !review)) {
        const message = record ? '这篇面试复盘已不存在' : '这条投递记录已不存在'
        this.setData({ loading: false, error: message })
        if (!this.initialized) returnToPrevious(message, 'none')
        return
      }
      const today = toDateInput(Date.now())
      const changes = { loading: false, error: '', company: record.company, position: record.position, today }
      if (!this.initialized) {
        changes.form = review ? {
          roundIndex: INTERVIEW_ROUNDS.indexOf(review.round),
          date: toDateInput(review.date),
          questions: review.questions.length ? review.questions.map(item => this.makeQuestion(item)) : [this.makeQuestion()],
          reflection: review.reflection,
          selfScore: review.selfScore
        } : { roundIndex: 0, date: today, questions: [this.makeQuestion()], reflection: '', selfScore: 0 }
        this.initialized = true
      }
      this.setData(changes, () => this.beginLeaveGuard())
    } catch (error) {
      this.setData({ loading: false, error: error.message })
    }
  },

  makeQuestion(original) {
    const key = ++this.questionSequence
    if (original) this.originalQuestions.set(key, original)
    return { key, q: original ? original.q : '', myAnswer: original ? original.myAnswer : '' }
  },

  pickRound(event) {
    this.setData({ 'form.roundIndex': Number(event.detail.value) }, () => this.refreshLeaveGuard())
  },

  pickDate(event) {
    this.setData({ 'form.date': event.detail.value, 'errors.date': false }, () => this.refreshLeaveGuard())
  },

  onQuestionInput(event) {
    const { index, field } = event.currentTarget.dataset
    const changes = { ['form.questions[' + index + '].' + field]: event.detail.value }
    if (field === 'q' && Number(index) === this.data.errors.questionIndex) changes['errors.questionIndex'] = -1
    this.setData(changes, () => this.afterFormChange())
  },

  addQuestion() {
    this.setData({ 'form.questions': this.data.form.questions.concat(this.makeQuestion()) }, () => this.afterFormChange())
  },

  removeQuestion(event) {
    const index = Number(event.currentTarget.dataset.index)
    const question = this.data.form.questions[index]
    if (question) {
      this.releaseKeyboard('review-question-' + question.key)
      this.releaseKeyboard('review-answer-' + question.key)
    }
    this.setData({
      'form.questions': this.data.form.questions.filter((_item, position) => position !== index),
      'errors.questionIndex': -1
    }, () => this.afterFormChange())
  },

  onReflection(event) {
    this.setData({ 'form.reflection': event.detail.value }, () => this.afterFormChange())
  },

  selectScore(event) {
    this.setData({ 'form.selfScore': Number(event.currentTarget.dataset.score), 'errors.score': false }, () => this.refreshLeaveGuard())
  },

  saveReview() {
    if (this.data.saving || this.data.loading || this.data.error) return
    const form = this.data.form
    const date = parseDate(form.date)
    const errors = {
      date: date === null || date > dayStart(Date.now()),
      score: !Number.isInteger(form.selfScore) || form.selfScore < 1 || form.selfScore > 5,
      questionIndex: form.questions.findIndex(item => !item.q.trim() && item.myAnswer.trim())
    }
    if (errors.date || errors.score || errors.questionIndex >= 0) {
      this.setData({ errors })
      const message = errors.date ? '请选择有效的面试日期' :
        errors.questionIndex >= 0 ? '请补全对应的面试问题' : '请选择自评星级'
      toast(message)
      return
    }
    this.setData({ saving: true })
    try {
      const payload = {
        round: INTERVIEW_ROUNDS[form.roundIndex], date,
        questions: form.questions.map(({ key, q, myAnswer }) => ({ ...this.originalQuestions.get(key), q, myAnswer })),
        reflection: form.reflection, selfScore: form.selfScore
      }
      const signature = this.formSignature()
      if (this.lastSavedSignature !== signature) {
        if (this.reviewId) store.updateInterview(this.applicationId, this.reviewId, payload)
        else this.reviewId = store.addInterview(this.applicationId, payload).id
        this.lastSavedSignature = signature
      } else {
        const current = store.get(this.applicationId)
        if (!current || !current.interviews.some(item => item.id === this.reviewId)) throw new Error('这篇面试复盘已不存在')
      }
      this.markFormSaved()
      this.releaseKeyboard()
      this.setData({ title: '编辑面试复盘' })
    } catch (error) {
      this.setData({ saving: false })
      toast(error.message)
      return
    }
    returnToPrevious('复盘已保存', 'success', () => this.setData({ saving: false }))
  }
})
