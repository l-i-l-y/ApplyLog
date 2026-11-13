
const { STATUS, STATUS_BY_ID, READABLE_STATUS_BY_ID, effectiveStatus } = require('../../utils/constants')

Component({
  properties: {
    status: { type: String, value: STATUS.SUBMITTED, observer: 'updateStatus' }
  },
  data: { appearance: STATUS_BY_ID[STATUS.SUBMITTED] },
  methods: {
    updateStatus(status) {
      this.setData({ appearance: READABLE_STATUS_BY_ID[effectiveStatus(status)] || { label: '未知状态', color: '#5E6678', background: '#EEF0F4' } })
    }
  }
})
