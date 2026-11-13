
const { STATUS } = require('./constants')
const { addDays, dayStart } = require('./date')

function timeOn(now, offset, hours, minutes) {
  return new Date(addDays(now, offset)).setHours(hours, minutes, 0, 0)
}

function reminder(id, type, time, fields = {}) {
  return { id, type, time, round: '', location: '', link: '', note: '', done: false, ...fields }
}

function buildDemo(now) {
  const examples = [
    {
      key: 'cloud', company: '云岸科技', position: '产品设计师', channel: '内推', city: '上海', daysAgo: 2,
      history: [STATUS.SUBMITTED, STATUS.ASSESSMENT, STATUS.INTERVIEW],
      note: '面试前准备作品集，重点介绍一次完整的产品迭代。',
      reminders: [reminder('demo-r-cloud', 'interview', timeOn(now, 1, 10, 30), { round: '二面', location: '线上会议' })],
      interviews: [{
        id: 'demo-i-cloud', round: '一面', date: dayStart(addDays(now, -1)),
        questions: [{ q: '你怎么判断一次设计迭代是否成功？', myAnswer: '先明确用户目标，再通过完成率和可用性测试验证。' }],
        reflection: '下次先讲结果，再说明关键决策和数据。',
        selfScore: 4
      }]
    },
    {
      key: 'north', company: '北辰设计', position: '用户体验设计师', channel: '官网', city: '杭州', daysAgo: 0,
      history: [STATUS.SUBMITTED],
      reminders: [reminder('demo-r-north', 'followup', timeOn(now, 2, 14, 0), { note: '确认作品集和简历是否已收到。' })]
    },
    {
      key: 'data', company: '澄光数据', position: '前端开发工程师', channel: 'Boss直聘', city: '深圳', daysAgo: 1,
      history: [STATUS.SUBMITTED, STATUS.ASSESSMENT],
      reminders: [reminder('demo-r-data', 'followup', timeOn(now, 3, 16, 0), { note: '查看在线测评的反馈。' })]
    },
    {
      key: 'light', company: '拾光工作室', position: '产品运营', channel: '校招', city: '广州', daysAgo: 5,
      history: [STATUS.SUBMITTED, STATUS.INTERVIEW, STATUS.OFFER], note: '待确认入职日期和书面 Offer。'
    },
    {
      key: 'river', company: '远川互联', position: '产品助理', channel: '猎聘', city: '北京', daysAgo: 8,
      history: [STATUS.SUBMITTED, STATUS.REJECTED]
    },
    {
      key: 'forest', company: '森谷创意', position: '品牌策划', channel: '其他', city: '成都', daysAgo: 11,
      history: [STATUS.SUBMITTED, STATUS.WITHDRAWN]
    }
  ]

  return examples.map(example => {
    const appliedAt = dayStart(addDays(now, -example.daysAgo))
    const createdAt = Math.min(timeOn(now, -example.daysAgo, 9, 0), now)
    const timeline = example.history.map((status, index) => ({
      status,
      time: Math.min(createdAt + index * 6 * 3600000, now),
      note: index === 0 ? '创建示例投递' : ''
    }))
    const last = timeline[timeline.length - 1]
    return {
      id: 'demo-' + example.key, company: example.company, position: example.position,
      channel: example.channel, city: example.city, salary: '', jdLink: '', appliedAt,
      status: last.status, timeline, reminders: example.reminders || [], interviews: example.interviews || [],
      note: example.note || '', createdAt, updatedAt: last.time
    }
  })
}

module.exports = { buildDemo }
