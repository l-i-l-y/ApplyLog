
const { STATUS, STATUS_BY_ID } = require('../../utils/constants')

Component({
  properties: {
    status: { type: String, value: STATUS.SUBMITTED, observer: 'updateStatus' }
  },
  data: { appearance: STATUS_BY_ID[STATUS.SUBMITTED] },
  methods: {
    updateStatus(status) {
      this.setData({ appearance: STATUS_BY_ID[status] || STATUS_BY_ID[STATUS.SUBMITTED] })
    }
  }
})
