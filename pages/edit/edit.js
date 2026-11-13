const { keyboardPage, keyboardData } = require('../../utils/keyboard')
const { leaveGuard } = require('../../utils/leave-guard')

const store = require('../../utils/store')
const { CHANNELS, isDemoId } = require('../../utils/constants')
const { toDateInput, parseDate, dayStart } = require('../../utils/date')
const { returnToPrevious, toast } = require('../../utils/ui')

const SALARY_VALUES = ['', '面议', '5K以下', '5–10K', '10–15K', '15–20K', '20–30K', '30–50K', '50K以上']
const SALARY_OPTIONS = ['暂不填写', ...SALARY_VALUES.slice(1), '自定义输入']

Page({
  ...keyboardPage,
  ...leaveGuard,
  data: {
    ...keyboardData,
    pageTitle: '记一笔投递',
    loading: true,
    error: '',
    saving: false,
    expanded: false,
    focusField: '',
    demo: false,
    today: '',
    channels: CHANNELS,
    salaryOptions: SALARY_OPTIONS,
    salaryIndex: 0,
    salaryCustom: false,
    salaryCustomDraft: '',
    form: { company: '', position: '', date: '', channel: '', city: '', salary: '', jdLink: '', note: '' },
    errors: { company: false, position: false, date: false }
  },

  onLoad(options) {
    this.applicationId = options.id || ''
    if (this.applicationId) this.setData({ pageTitle: '编辑投递', demo: isDemoId(this.applicationId) })
  },

  onShow() {
    this.startKeyboard()
    this.setData({ saving: false, focusField: '' })
    this.loadRecord()
  },

  onHide() { this.stopKeyboard(); this.suspendLeaveGuard() },

  onUnload() { this.stopKeyboard(); this.suspendLeaveGuard() },

  editSnapshot() {
    const { company, position, date, channel, city, salary, jdLink, note } = this.data.form
    return { company, position, date, channel, city, salary, jdLink, note }
  },

  loadRecord() {
    this.setData({ loading: true, error: '' })
    try {
      const today = toDateInput(Date.now())
      const data = store.snapshot()
      const record = this.applicationId ? data.get(this.applicationId) : null
      if (this.applicationId && !record) {
        this.setData({ loading: false, error: '这条投递记录已不存在' })
        if (!this.initialized) returnToPrevious('这条投递记录已不存在', 'none')
        return
      }

      const changes = { loading: false, today }
      if (!this.initialized) {
        if (record) {
          const { company, position, appliedAt, channel = '', city = '', salary = '', jdLink = '', note = '' } = record
          changes.form = { company, position, date: toDateInput(appliedAt), channel, city, salary, jdLink, note }
          const preset = SALARY_VALUES.indexOf(salary)
          changes.salaryIndex = preset < 0 ? SALARY_VALUES.length : preset
          changes.salaryCustom = preset < 0
          changes.salaryCustomDraft = preset < 0 ? salary : ''
        } else {
          changes['form.date'] = today
          changes['form.channel'] = data.lastChannel()
          changes['form.city'] = data.lastCity()
        }
        this.initialized = true
      }
      this.setData(changes, () => this.beginLeaveGuard())
    } catch (error) {
      this.setData({ loading: false, error: error.message })
    }
  },

  onInput(event) {
    const { field } = event.currentTarget.dataset
    const changes = { ['form.' + field]: event.detail.value }
    if (field === 'company' || field === 'position') changes['errors.' + field] = false
    if (field === 'salary') changes.salaryCustomDraft = event.detail.value
    this.setData(changes, () => this.afterFormChange())
  },

  focusNext(event) {
    const { next } = event.currentTarget.dataset
    const visible = ['company', 'position']
    if (this.data.expanded) {
      visible.push('city')
      if (this.data.salaryCustom) visible.push('salary')
      visible.push('jdLink', 'note')
    }
    if (visible.includes(next)) this.setData({ focusField: next })
  },

  clearFocus(event) {
    this.onKeyboardBlur(event)
    if (event.currentTarget.dataset.field === this.data.focusField) this.setData({ focusField: '' })
  },

  toggleMore() {
    const expanded = !this.data.expanded
    if (!expanded && !['edit-company', 'edit-position'].includes(this.keyboardAnchor)) this.releaseKeyboard()
    this.setData({ expanded, focusField: '' })
  },

  chooseChannel(event) {
    const { channel } = event.currentTarget.dataset
    this.setData({ 'form.channel': this.data.form.channel === channel ? '' : channel }, () => this.refreshLeaveGuard())
  },

  pickDate(event) {
    this.setData({ 'form.date': event.detail.value, 'errors.date': false }, () => this.refreshLeaveGuard())
  },

  pickSalary(event) {
    const value = event.detail.value
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return
    const salaryIndex = Number(value)
    if (!Number.isInteger(salaryIndex) || salaryIndex < 0 || salaryIndex >= SALARY_OPTIONS.length) return
    const salaryCustom = salaryIndex === SALARY_VALUES.length
    if (!salaryCustom) this.releaseKeyboard('edit-salary')
    this.setData({
      salaryIndex, salaryCustom, focusField: '',
      'form.salary': salaryCustom ? this.data.salaryCustomDraft : SALARY_VALUES[salaryIndex]
    }, () => this.refreshLeaveGuard())
  },

  saveApplication() {
    if (this.data.saving || this.data.loading || this.data.error) return
    const { form } = this.data
    const appliedAt = parseDate(form.date)
    const errors = {
      company: !form.company.trim(),
      position: !form.position.trim(),
      date: appliedAt === null || appliedAt > dayStart(Date.now())
    }
    if (errors.company || errors.position || errors.date) {
      this.setData({ errors, expanded: this.data.expanded || errors.date })
      toast(errors.company ? '请填写公司名称' : errors.position ? '请填写岗位名称' : '请选择有效的投递日期')
      return
    }

    this.setData({ saving: true })
    const editing = Boolean(this.applicationId)
    try {
      const payload = { ...form, appliedAt }
      const signature = this.formSignature()
      if (this.lastSavedSignature !== signature) {
        if (this.applicationId) store.update(this.applicationId, payload)
        else this.applicationId = store.create(payload).id
        this.lastSavedSignature = signature
      } else if (!store.get(this.applicationId)) throw new Error('这条投递记录已不存在')
      this.markFormSaved()
      this.releaseKeyboard()
      this.setData({ pageTitle: '编辑投递' })
    } catch (error) {
      this.setData({ saving: false })
      toast(error.message)
      return
    }
    returnToPrevious(editing ? '已保存修改' : '投递已保存', 'success', () => this.setData({ saving: false }))
  }
})
