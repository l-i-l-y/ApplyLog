const { test } = require('node:test')
const assert = require('node:assert/strict')
const { environment, clone, tap } = require('./helpers')

test('only four statuses can be newly written, including updates of legacy records', () => {
  const env = environment(), app = env.application()
  const constants = env.load('utils/constants.js')
  assert.deepEqual(clone(constants.STATUSES.map(s => s.id)), ['submitted','interview','offer','rejected'])
  for (const status of ['assessment','withdrawn','unknown','toString']) {
    assert.throws(() => env.store.create({company:'x',position:'p',status}), /状态/)
    assert.throws(() => env.store.changeStatus(app.id,status), /状态/)
    assert.throws(() => env.store.update(app.id,{status}), /状态/)
  }
  assert.equal(env.raw().applications.length, 1)
})

test('legacy states remain readable without writes, assessment groups as interview and withdrawn awaits confirmation', () => {
  const env = environment(), app = env.application()
  const raw = env.raw()
  raw.extra = {keep:true}
  raw.applications = ['assessment','withdrawn','offer','rejected','submitted','interview'].map((status,i) => ({
    ...clone(app), id:'old-'+i, status, timeline:[{status,time:env.now,note:'旧事件', extra:i}], extension:'keep'
  }))
  env.inject(raw)
  const writes = env.calls.writes, snapshot = env.store.snapshot(), summary = snapshot.stats()
  assert.equal(summary.total,6)
  assert.equal(summary.counts.interview,2)
  assert.equal(summary.pendingStatusCount,1)
  assert.equal(summary.replyCount,4)
  assert.equal(summary.offerCount,1)
  assert.deepEqual(clone(snapshot.list({status:'interview'}).map(r=>r.id)), ['old-0','old-5'])
  assert.equal(snapshot.list({status:'active'}).length,3)
  assert.equal(snapshot.list({status:'closed'}).length,3)
  assert.equal(env.calls.writes,writes)
  assert.deepEqual(env.raw(),raw)
  const detail = env.page('detail',{id:'old-1'})
  assert.equal(detail.data.record.needsStatusConfirmation,true)
  assert.equal(detail.data.statusSteps.length,4)
  assert.match(detail.data.timeline[0].label,/历史.*已放弃/)
  env.store.update('old-1',{company:'修改公司'})
  assert.equal(env.store.get('old-1').status,'withdrawn')
  assert.deepEqual(clone(env.store.get('old-1').timeline),raw.applications[1].timeline)
  env.store.changeStatus('old-1','interview')
  assert.equal(env.store.stats().pendingStatusCount,0)
  assert.equal(env.store.get('old-1').timeline[0].status,'withdrawn')
  assert.equal(env.store.get('old-1').extension,'keep')
  assert.deepEqual(env.raw().extra,{keep:true})
})

test('unknown current or historical status is rejected while a legal empty timeline is accepted', () => {
  const env = environment(), app = env.application()
  const valid = env.raw()
  valid.applications[0].timeline = []
  env.inject(valid)
  assert.equal(env.store.get(app.id).timeline.length,0)
  for (const mutate of [
    r=>{delete r.timeline}, r=>{r.timeline={}}, r=>{r.timeline=[{status:'no',time:env.now}]},
    r=>{r.status='unknown'}, r=>{r.status='constructor'}, r=>{r.timeline=[{status:'submitted',time:'bad'}]}
  ]) {
    const broken=clone(valid); mutate(broken.applications[0]); env.inject(broken)
    assert.throws(()=>env.store.list(),/格式异常/)
    assert.throws(()=>env.store.update(app.id,{note:'不要覆盖'}),/格式异常/)
    assert.deepEqual(env.raw(),broken)
  }
})

test('four-state overview, mine and demo preserve totals and legacy explanation', () => {
  const env=environment(), app=env.application(), raw=env.raw()
  raw.applications[0].status='withdrawn'; env.inject(raw)
  const home=env.page('index'), mine=env.page('mine')
  assert.equal(home.data.distribution.length,4)
  assert.equal(home.data.pendingStatusCount,1)
  assert.equal(mine.data.summary.pendingStatusCount,1)
  assert.equal(mine.data.counts.length,4)
  env.store.seedDemo()
  for (const record of env.store.list().filter(r=>r.id!==app.id)) {
    assert.ok(['submitted','interview','offer','rejected'].includes(record.status))
    assert.ok(record.timeline.every(e=>['submitted','interview','offer','rejected'].includes(e.status)))
  }
})

test('timeline deletion uses original position and a full snapshot, leaves current status and other data intact', () => {
  const env=environment(), app=env.application(), raw=env.raw()
  const row=raw.applications[0]
  row.timeline=[
    {status:'submitted',time:env.now,note:'初始',extra:1},
    {status:'interview',time:env.now,note:'相同'},
    {status:'interview',time:env.now,note:'相同'},
    {status:'offer',time:env.now,note:'历史 Offer'}
  ]
  row.reminders=[{id:'keep-reminder',type:'followup',time:env.now+60000,done:true,custom:42}]
  row.custom={keep:true}; env.inject(raw)
  const oldFingerprint=JSON.stringify(row.timeline)
  env.store.removeTimelineEntry(app.id,{index:3,fingerprint:oldFingerprint})
  assert.equal(env.store.stats().offerCount,0)
  assert.equal(env.store.stats().replyCount,1)
  assert.throws(()=>env.store.removeTimelineEntry(app.id,{index:1,fingerprint:oldFingerprint}),/更新|重新/)
  for(const index of [1,1,0]) {
    const timeline=env.store.get(app.id).timeline
    env.store.removeTimelineEntry(app.id,{index,fingerprint:JSON.stringify(timeline)})
  }
  const saved=env.store.get(app.id)
  assert.equal(saved.timeline.length,0)
  assert.equal(saved.status,'submitted')
  assert.equal(env.store.stats().replyCount,0)
  assert.deepEqual(clone(saved.reminders),row.reminders)
  assert.deepEqual(clone(saved.custom),{keep:true})
  assert.deepEqual(clone(saved.interviews),[])
  assert.throws(()=>env.store.removeTimelineEntry(app.id,{index:0,fingerprint:'[]'}),/更新|重新/)
})

test('timeline management confirms once, cancels safely, deletes reversed rows and preserves rows on disk failure', () => {
  const env=environment(), app=env.application()
  env.store.changeStatus(app.id,'interview','相同时间'); env.store.changeStatus(app.id,'offer','最后条目')
  const p=env.page('detail',{id:app.id}), original=env.raw()
  p.deleteTimeline(tap('key',p.data.timeline[0].key))
  assert.equal(env.calls.modals.length,0)
  p.toggleTimelineManagement()
  const target=p.data.timeline[0].key
  p.deleteTimeline(tap('key',target)); p.deleteTimeline(tap('key',target))
  assert.equal(env.calls.modals.length,1)
  assert.match(env.calls.modals[0].content,/删除不会改变当前投递状态；相关历史统计可能随之更新。/)
  env.calls.modals[0].success({confirm:false})
  assert.deepEqual(env.raw(),original)
  p.deleteTimeline(tap('key',target)); env.calls.writeError=true
  env.calls.modals.at(-1).success({confirm:true})
  assert.deepEqual(env.raw(),original)
  assert.equal(p.data.timeline.length,3)
  assert.equal(p.data.timelineBusy,false)
  assert.match(env.calls.toasts.at(-1),/保存失败/)
  env.calls.writeError=false
  p.deleteTimeline(tap('key',target)); env.calls.modals.at(-1).success({confirm:true})
  assert.equal(env.store.get(app.id).timeline.at(-1).status,'interview')
  assert.equal(env.store.get(app.id).status,'offer')
  assert.equal(p.data.timelineManaging,true)
  while(p.data.timeline.length) {
    p.deleteTimeline(tap('key',p.data.timeline[0].key)); env.calls.modals.at(-1).success({confirm:true})
  }
  assert.equal(env.store.get(app.id).timeline.length,0)
})

test('refresh and leaving invalidate pending timeline confirmations, including shifted duplicate rows', () => {
  const env=environment(), app=env.application()
  env.store.changeStatus(app.id,'interview')
  const p=env.page('detail',{id:app.id})
  p.toggleTimelineManagement(); const stale=p.data.timeline[0].key
  p.deleteTimeline(tap('key',stale)); const confirm=env.calls.modals.at(-1)
  p.loadDetail(); confirm.success({confirm:true})
  assert.equal(env.store.get(app.id).timeline.length,2)
  p.deleteTimeline(tap('key',stale))
  assert.equal(env.calls.modals.length,1)
  p.deleteTimeline(tap('key',p.data.timeline[0].key)); const leaving=env.calls.modals.at(-1)
  p.onHide(); leaving.success({confirm:true})
  assert.equal(p.data.timelineManaging,false)
  assert.equal(env.store.get(app.id).timeline.length,2)
  p.onShow(); p.toggleTimelineManagement()
  p.deleteTimeline(tap('key',p.data.timeline[0].key))
  const pending=env.calls.modals.at(-1)
  env.store.changeStatus(app.id,'offer')
  pending.success({confirm:true})
  assert.equal(env.store.get(app.id).timeline.length,3)
  assert.match(env.calls.toasts.at(-1),/更新|重新/)
})

function reminderFixture(env) {
  const app=env.application(), reminder=env.store.addReminder(app.id,{type:'interview',time:env.now+3600000,round:'二面',location:'线上',link:'https://example.test',note:'原备注'})
  return {app,reminder}
}

test('reminder editing retains original ID, completion, extensions and calendar markers while accepting unchanged historical time', () => {
  const env=environment(), {app,reminder}=reminderFixture(env), raw=env.raw()
  const original=raw.applications[0].reminders[0]
  Object.assign(original,{time:env.now-60000+123,done:true,calendarAddedAt:env.now-20000,calendarPendingAt:env.now-10000,extension:{keep:1}})
  env.inject(raw)
  const saved=env.store.updateReminder(app.id,reminder.id,{time:original.time,type:'followup',round:'终面',note:'新备注',done:false,id:'evil',calendarAddedAt:0})
  assert.equal(saved.id,reminder.id); assert.equal(saved.done,true); assert.equal(saved.time,original.time)
  assert.equal(saved.round,''); assert.equal(saved.note,'新备注')
  assert.equal(saved.calendarAddedAt,original.calendarAddedAt)
  assert.equal(saved.calendarPendingAt,original.calendarPendingAt)
  assert.deepEqual(clone(saved.extension),{keep:1})
  assert.equal(env.store.get(app.id).reminders.length,1)
  const before=env.raw()
  assert.throws(()=>env.store.updateReminder(app.id,reminder.id,{time:original.time-60000}),/未来/)
  assert.throws(()=>env.store.updateReminder(app.id,reminder.id,{time:env.now}),/未来/)
  assert.throws(()=>env.store.updateReminder(app.id,reminder.id,{type:'bad'}),/类型/)
  assert.throws(()=>env.store.updateReminder(app.id,reminder.id,{note:'字'.repeat(501)}),/500/)
  assert.deepEqual(env.raw(),before)
  env.store.updateReminder(app.id,reminder.id,{time:env.now+7200000,type:'interview',round:'三面'})
  assert.equal(env.store.get(app.id).reminders[0].round,'三面')
  assert.equal(env.store.get(app.id).reminders[0].done,true)
})

test('independent reminder editor preserves seconds, drafts across type switches and calendar warning without early writes', () => {
  const env=environment(), {app,reminder}=reminderFixture(env), raw=env.raw()
  Object.assign(raw.applications[0].reminders[0],{time:env.now-86400000+45231,done:true,calendarPendingAt:env.now})
  env.inject(raw)
  const writes=env.calls.writes, p=env.page('reminder-edit',{id:app.id,reminder:reminder.id})
  assert.equal(p.data.error,''); assert.equal(p.data.calendarNotice,true)
  assert.equal(p.data.form.note,'原备注')
  p.onInput({currentTarget:{dataset:{field:'note'}},detail:{value:'修改多行\n内容'}})
  p.pickRound({detail:{value:p.data.rounds.indexOf('终面')}})
  p.changeType(tap('type','followup')); p.changeType(tap('type','interview'))
  assert.equal(p.data.rounds[p.data.form.roundIndex],'终面')
  assert.equal(p.data.form.note,'修改多行\n内容')
  assert.equal(env.calls.writes,writes)
  p.saveReminder()
  const saved=env.store.get(app.id).reminders[0]
  assert.equal(saved.id,reminder.id); assert.equal(saved.time,raw.applications[0].reminders[0].time)
  assert.equal(saved.round,'终面'); assert.equal(saved.done,true); assert.equal(saved.calendarPendingAt,env.now)
  assert.equal(env.calls.writes,writes+1)
  p.onHide(); assert.equal(env.calls.keyboards.size,0)
})

test('reminder editor retries disk and return failures without duplicate writes and rejects a changed past time', () => {
  const env=environment(), {app,reminder}=reminderFixture(env)
  const p=env.page('reminder-edit',{id:app.id,reminder:reminder.id}), before=env.raw()
  p.onInput({currentTarget:{dataset:{field:'location'}},detail:{value:'新地点'}})
  env.calls.writeError=true; p.saveReminder()
  assert.deepEqual(env.raw(),before); assert.equal(p.data.saving,false); assert.equal(p.data.form.location,'新地点')
  env.calls.writeError=false; env.calls.navigationError=true
  p.saveReminder(); const writes=env.calls.writes
  assert.equal(p.data.saving,false)
  p.saveReminder(); assert.equal(env.calls.writes,writes)
  assert.equal(env.store.get(app.id).reminders.length,1)
  env.calls.navigationError=false; p.saveReminder(); assert.equal(env.calls.writes,writes)
  p.onShow(); p.pickDate({detail:{value:'2026-11-13'}}); p.saveReminder()
  assert.match(p.data.timeError,/未来/)
  assert.equal(env.calls.writes,writes)
})

test('missing reminder sources show an error and never create replacement records; cancel never writes', () => {
  const env=environment(), {app,reminder}=reminderFixture(env)
  const p=env.page('reminder-edit',{id:app.id,reminder:reminder.id})
  const writes=env.calls.writes; p.cancelEdit(); assert.equal(env.calls.writes,writes)
  env.store.removeReminder(app.id,reminder.id); p.onShow()
  assert.match(p.data.error,/提醒已不存在/); p.saveReminder()
  assert.equal(env.store.get(app.id).reminders.length,0)
  env.store.remove(app.id)
  const absent=env.page('reminder-edit',{id:app.id,reminder:reminder.id})
  assert.match(absent.data.error,/投递记录已不存在/)
  absent.saveReminder(); assert.equal(env.store.list().length,0)
})

test('reminder body opens the original editing route and returning refreshes schedules and badges', () => {
  const env=environment(), {app,reminder}=reminderFixture(env), detail=env.page('detail',{id:app.id})
  detail.openReminder(tap('id',reminder.id)); detail.openReminder(tap('id',reminder.id))
  assert.equal(env.calls.urls.length,1)
  assert.equal(env.calls.urls[0],'/pages/reminder-edit/reminder-edit?id='+encodeURIComponent(app.id)+'&reminder='+encodeURIComponent(reminder.id))
  const raw=env.raw(); raw.applications[0].reminders[0].time=env.now-1000; env.inject(raw)
  const home=env.page('index')
  assert.equal(home.data.overdueCount,1)
  env.store.updateReminder(app.id,reminder.id,{time:env.now+7200000,note:'更新'})
  detail.onShow(); home.onShow()
  assert.equal(detail.data.reminders[0].note,'更新')
  assert.equal(home.data.overdueCount,0); assert.equal(home.data.reminders[0].id,reminder.id)
  assert.equal(env.load('utils/tabbar.js').tabState().badge,'1')
})

function questionFixture(env) {
  const app=env.application()
  const review=env.store.addInterview(app.id,{round:'一面',date:env.now,selfScore:4,questions:[
    {q:'需要回顾的问题',myAnswer:'完整回答'.repeat(90)}, {q:'第二个问题',myAnswer:''}
  ]})
  return {app,review,p:env.page('questions')}
}

test('question cards navigate once to original review and reentry preserves query, scroll and valid expansion', () => {
  const env=environment(), {app,review,p}=questionFixture(env)
  p.onSearch({detail:{value:'问题'}})
  const key=p.data.items[0].key
  p.toggleAnswer(tap('key',key))
  assert.equal(env.calls.urls.length,0)
  p.onKeyboardScroll({detail:{scrollTop:256}})
  p.openReview(tap('key',key)); p.openReview(tap('key',key))
  const url='/pages/interview/interview?id='+encodeURIComponent(app.id)+'&review='+encodeURIComponent(review.id)
  assert.deepEqual(env.calls.urls,[url])
  p.onHide(); p.onShow()
  assert.equal(p.data.query,'问题'); assert.equal(p.data.keyboardScrollTop,256); assert.equal(p.data.items[0].expanded,true)
  p.openReview(tap('key',p.data.items[1].key))
  assert.deepEqual(env.calls.urls,[url,url])
})

test('question long press suppresses its gesture tap, next gesture works, and failed navigation can retry', () => {
  const env=environment(), {p}=questionFixture(env), key=p.data.items[0].key
  p.onQuestionTouchStart(tap('key',key)); p.onQuestionLongPress(tap('key',key)); p.openReview(tap('key',key))
  assert.equal(env.calls.urls.length,0)
  p.onQuestionTouchStart(tap('key',key)); env.calls.openError=true; p.openReview(tap('key',key))
  assert.equal(env.calls.urls.length,1)
  assert.match(env.calls.toasts.at(-1),/重试/)
  env.calls.openError=false; p.openReview(tap('key',key))
  assert.equal(env.calls.urls.length,2)
})

test('question card refreshes deleted source rather than opening an empty editor', () => {
  const env=environment(), {app,p}=questionFixture(env), key=p.data.items[0].key
  env.store.updateInterview(app.id,env.store.get(app.id).interviews[0].id,{questions:[]})
  const raw=env.raw(); raw.applications[0].interviews=[]; env.inject(raw)
  p.openReview(tap('key',key))
  assert.equal(env.calls.urls.length,0)
  assert.equal(p.data.items.length,0)
  assert.match(env.calls.toasts.at(-1),/复盘已不存在/)
})
