
const STATUS = Object.freeze({
  SUBMITTED: 'submitted',
  ASSESSMENT: 'assessment',
  INTERVIEW: 'interview',
  OFFER: 'offer',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn'
})

const STATUSES = [
  { id: STATUS.SUBMITTED, label: '已投递', color: '#4E6385', background: '#EBF0F8', chart: '#C1CEE9' },
  { id: STATUS.ASSESSMENT, label: '笔试/测评', short: '笔试', color: '#08676D', background: '#E1F4F3', chart: '#72E0DB' },
  { id: STATUS.INTERVIEW, label: '面试中', color: '#985016', background: '#FFF0DF', chart: '#FFC588' },
  { id: STATUS.OFFER, label: 'Offer', color: '#176C4A', background: '#E2F6EA', chart: '#A6EDBD' },
  { id: STATUS.REJECTED, label: '未通过', color: '#A14655', background: '#FBECEF', chart: '#FFAFBC' },
  { id: STATUS.WITHDRAWN, label: '已放弃', color: '#656D7D', background: '#EEF0F4', chart: '#E5E7F1' }
]

const STATUS_BY_ID = Object.freeze(STATUSES.reduce((map, status) => {
  map[status.id] = status
  return map
}, Object.create(null)))
const ACTIVE_STATUSES = [STATUS.SUBMITTED, STATUS.ASSESSMENT, STATUS.INTERVIEW]
const CLOSED_STATUSES = [STATUS.REJECTED, STATUS.WITHDRAWN]
const REPLY_STATUSES = [STATUS.ASSESSMENT, STATUS.INTERVIEW, STATUS.OFFER, STATUS.REJECTED]
const STATUS_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'active', label: '进行中' },
  { id: STATUS.INTERVIEW, label: '面试中' },
  { id: STATUS.OFFER, label: 'Offer' },
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
  STATUS, STATUSES, STATUS_BY_ID, ACTIVE_STATUSES, CLOSED_STATUSES, REPLY_STATUSES,
  STATUS_FILTERS, CHANNELS, INTERVIEW_ROUNDS, REMINDER_TYPES, isDemoId
}
