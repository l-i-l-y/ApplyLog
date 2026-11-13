
const STATUS = Object.freeze({
  SUBMITTED: 'submitted',
  INTERVIEW: 'interview',
  OFFER: 'offer',
  REJECTED: 'rejected'
})
const LEGACY_STATUS = Object.freeze({ ASSESSMENT: 'assessment', WITHDRAWN: 'withdrawn' })

const STATUSES = [
  { id: STATUS.SUBMITTED, label: '已投递', color: '#3F5A86', background: '#EAF0F8', chart: '#8EA3CC' },
  { id: STATUS.INTERVIEW, label: '面试中', color: '#93500F', background: '#FDF0DF', chart: '#EFA048' },
  { id: STATUS.OFFER, label: 'Offer', color: '#17694A', background: '#E3F5EA', chart: '#3DB27A' },
  { id: STATUS.REJECTED, label: '未通过', color: '#A63F52', background: '#FBEBEE', chart: '#E58595' }
]

const STATUS_BY_ID = Object.freeze(STATUSES.reduce((map, status) => {
  map[status.id] = status
  return map
}, Object.create(null)))
const READABLE_STATUS_BY_ID = Object.freeze(Object.assign(Object.create(null), STATUS_BY_ID, {
  [LEGACY_STATUS.ASSESSMENT]: { ...STATUS_BY_ID[STATUS.INTERVIEW], id: LEGACY_STATUS.ASSESSMENT, label: '历史：笔试／测评' },
  [LEGACY_STATUS.WITHDRAWN]: { id: LEGACY_STATUS.WITHDRAWN, label: '历史：已放弃', color: '#5E6678', background: '#EEF0F4', chart: '#A9B0BE' }
}))
function effectiveStatus(status) { return status === LEGACY_STATUS.ASSESSMENT ? STATUS.INTERVIEW : status }
const ACTIVE_STATUSES = [STATUS.SUBMITTED, STATUS.INTERVIEW]
const CLOSED_STATUSES = [STATUS.OFFER, STATUS.REJECTED, LEGACY_STATUS.WITHDRAWN]
const REPLY_STATUSES = [LEGACY_STATUS.ASSESSMENT, STATUS.INTERVIEW, STATUS.OFFER, STATUS.REJECTED]
const STATUS_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'active', label: '进行中' },
  { id: STATUS.SUBMITTED, label: '已投递' },
  { id: STATUS.INTERVIEW, label: '面试中' },
  { id: STATUS.OFFER, label: 'Offer' },
  { id: STATUS.REJECTED, label: '未通过' },
  { id: 'closed', label: '已结束' }
]

const CHANNELS = ['官网', 'Boss直聘', '猎聘', '内推', '校招', '其他']
const INTERVIEW_ROUNDS = ['一面', '二面', '三面', '终面', 'HR 面', '其他']
const REMINDER_TYPES = [
  { id: 'interview', label: '面试' },
  { id: 'followup', label: '跟进' }
]

function isDemoId(id) {
  return typeof id === 'string' && id.startsWith('demo-')
}

module.exports = {
  STATUS, LEGACY_STATUS, STATUSES, STATUS_BY_ID, READABLE_STATUS_BY_ID, effectiveStatus,
  ACTIVE_STATUSES, CLOSED_STATUSES, REPLY_STATUSES,
  STATUS_FILTERS, CHANNELS, INTERVIEW_ROUNDS, REMINDER_TYPES, isDemoId
}
