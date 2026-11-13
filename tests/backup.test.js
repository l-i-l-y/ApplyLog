const test = require('node:test')
const assert = require('node:assert/strict')
const { environment, clone } = require('./helpers')

function setup() { const env=environment();return {...env,backup:env.load('utils/backup.js')} }
function fixture(env) {
  const app=env.application()
  env.store.addReminder(app.id,{type:'interview',time:env.now+3600000,round:'一面',note:'第一行\n第二行'})
  env.store.addInterview(app.id,{round:'一面',date:env.now,selfScore:4,questions:[{q:'问题',myAnswer:'回答\n第二行'}],reflection:'复盘'})
  const data=env.raw();data.extension={中文:'保留😀'};data.lastUsedCity='杭州';data.lastUsedChannel='内推'
  data.applications[0].extension={keep:true};data.applications[0].timeline=[]
  data.applications[0].status='withdrawn'
  data.applications[0].reminders[0].calendarAddedAt=env.now
  data.applications[0].reminders[0].extra={keep:1}
  return data
}
test('new and legacy backup formats preview counts without writes and preserve version-1 extensions',()=>{
  const e=setup(),data=fixture(e),writes=e.calls.writes
  e.inject(data)
  const exported=e.backup.createBackup()
  assert.equal(exported.format,'ApplyLogBackup');assert.equal(exported.version,1)
  assert.equal(Date.parse(exported.exportedAt),e.now)
  assert.deepEqual(clone(exported.data),data)
  for(const input of [exported,data]) {
    const preview=e.backup.parseBackup('\uFEFF'+JSON.stringify(input))
    assert.deepEqual(clone(preview.counts),{applications:1,reminders:1,interviews:1})
    assert.deepEqual(clone(preview.data),data)
    assert.equal(preview.exportedAt,input===data?null:exported.exportedAt)
  }
  assert.equal(e.calls.writes,writes)
})
test('invalid JSON, versions, required fields, duplicate IDs, corrupt nested entries and unknown statuses never modify data',()=>{
  const e=setup(),data=fixture(e),before=e.raw(),writes=e.calls.writes
  const bads=['{',JSON.stringify({version:2,applications:[]}),JSON.stringify({format:'Other',version:1,data}),JSON.stringify({format:'ApplyLogBackup',version:2,exportedAt:new Date(e.now).toISOString(),data})]
  for(const mutate of [d=>delete d.applications,d=>d.applications.push(clone(d.applications[0])),d=>delete d.applications[0].timeline,d=>d.applications[0].status='unknown',d=>d.applications[0].timeline=[{status:'bad',time:e.now}],d=>d.applications[0].reminders[0].time='bad',d=>d.applications[0].reminders.push(clone(d.applications[0].reminders[0])),d=>d.applications[0].interviews[0].questions[0].q=3]) { const d=clone(data);mutate(d);bads.push(JSON.stringify(d)) }
  for(const text of bads)assert.throws(()=>e.backup.parseBackup(text))
  assert.deepEqual(e.raw(),before);assert.equal(e.calls.writes,writes)
})
test('UTF-8 and storage/file capacity limits are explicit, with no truncation or disk writes',()=>{
  const e=setup(),data=fixture(e)
  assert.equal(e.backup.utf8Bytes('中😀'),7)
  assert.throws(()=>e.backup.parseBackup(' '.repeat(e.backup.MAX_FILE_BYTES+1)),/过大|上限/)
  data.extension='中'.repeat(Math.ceil(e.backup.MAX_DATA_BYTES/3))
  assert.throws(()=>e.backup.parseBackup(JSON.stringify(data)),/过大|上限/)
  const preview=e.backup.parseBackup(JSON.stringify({version:1,applications:[]})),before=e.raw()
  e.calls.currentSize=10239
  assert.throws(()=>e.backup.restore(preview),/空间|容量/)
  assert.deepEqual(e.raw(),before)
})
test('restore durably backs up exact damaged original, replaces once, refreshes derived data and preserves calendar markers for review',()=>{
  const e=setup(),data=fixture(e),damaged={version:1,applications:'损坏原值',unknown:{keep:true}}
  e.inject(damaged)
  const preview=e.backup.parseBackup(JSON.stringify(data));const writes=e.calls.writes
  e.backup.restore(preview)
  assert.equal(e.calls.writes,writes+1)
  assert.equal(e.calls.allWrites.at(-2),e.backup.ROLLBACK_KEY)
  const actual=e.raw(),app=actual.applications[0],reminder=app.reminders[0]
  assert.deepEqual(actual.extension,data.extension);assert.deepEqual(app.extension,{keep:true})
  assert.equal(app.id,data.applications[0].id);assert.equal(app.status,'withdrawn');assert.deepEqual(app.timeline,[])
  assert.equal(reminder.calendarAddedAt,e.now);assert.equal(reminder.calendarReviewRequired,true);assert.deepEqual(reminder.extra,{keep:1})
  const snap=e.store.snapshot();assert.equal(snap.stats().total,1);assert.equal(snap.stats().pendingStatusCount,1)
  assert.equal(snap.questions().total,1);assert.equal(snap.lastCity(),'杭州');assert.equal(snap.lastChannel(),'内推');assert.equal(snap.upcomingCount(),1)
  assert.equal(e.backup.rollbackInfo().available,true)
  e.backup.rollback();assert.deepEqual(e.raw(),damaged)
})
test('failed safety snapshot or insufficient rollback capacity abort before replacing original',()=>{
  const e=setup(),data=fixture(e),before=e.raw(),preview=e.backup.parseBackup(JSON.stringify(data)),writes=e.calls.writes
  e.calls.failWriteKey=e.backup.ROLLBACK_KEY
  assert.throws(()=>e.backup.restore(preview),/回滚|原数据|备份/)
  assert.equal(e.calls.writes,writes);assert.deepEqual(e.raw(),before)
})
test('replacement failure retains original and read-back corruption automatically rolls back without claiming success',()=>{
  const e=setup(),data=fixture(e),before=e.raw(),preview=e.backup.parseBackup(JSON.stringify(data))
  e.calls.writeError=true
  assert.throws(()=>e.backup.restore(preview),/失败/);assert.deepEqual(e.raw(),before)
  e.calls.writeError=false
  let corrupt=true
  e.calls.afterWrite=(key,value)=>{if(key==='applylog-data'&&corrupt){corrupt=false;e.inject({version:1,applications:[]})}}
  assert.throws(()=>e.backup.restore(preview),/核验|校验/)
  assert.deepEqual(e.raw(),before);assert.equal(e.backup.rollbackInfo().available,true)
})
test('failed automatic rollback clearly reports recovery path and retains verified safety snapshot',()=>{
  const e=setup(),data=fixture(e),before=e.raw(),preview=e.backup.parseBackup(JSON.stringify(data))
  e.calls.afterWrite=(key)=>{if(key==='applylog-data'){e.inject({version:1,applications:[]});e.calls.writeError=true}}
  assert.throws(()=>e.backup.restore(preview),/回滚.*失败|回滚入口/)
  e.calls.afterWrite=null;e.calls.writeError=false
  e.backup.rollback();assert.deepEqual(e.raw(),before)
})
test('stale preview is refused and damaged safety snapshot is never used as a rollback source',()=>{
  const e=setup(),preview=e.backup.parseBackup(JSON.stringify({version:1,applications:[]}))
  e.application({company:'预览之后新增'})
  const before=e.raw();assert.throws(()=>e.backup.restore(preview),/已变化|重新/);assert.deepEqual(e.raw(),before)
  e.wx.setStorageSync(e.backup.ROLLBACK_KEY,{bad:true})
  assert.throws(()=>e.backup.rollback(),/回滚|损坏/);assert.deepEqual(e.raw(),before)
})
test('file export writes exact UTF-8 envelope with unique names and reports sharing only after supported user flow',async()=>{
  const e=setup();e.application();const writes=[],shares=[]
  e.wx.env={USER_DATA_PATH:'/user'}
  e.wx.getFileSystemManager=()=>({writeFile(o){writes.push(o);o.success()},readFile(o){o.success({data:writes.at(-1).data})}})
  e.wx.shareFileMessage=o=>{shares.push(o);o.success()}
  const a=await e.backup.prepareFile(),b=await e.backup.prepareFile()
  assert.match(a.fileName,/ApplyLog.*\.json$/);assert.notEqual(a.fileName,b.fileName)
  assert.equal(writes[0].encoding,'utf8');assert.equal(JSON.parse(writes[0].data).format,'ApplyLogBackup')
  assert.equal(shares.length,0)
  assert.equal((await e.backup.shareFile(a)).shared,true)
  assert.equal((await e.backup.shareFile(b)).shared,true)
  assert.equal(shares.length,2)
})

test('file preparation never invokes tap-only sharing; a separate tap shares synchronously and cancellation keeps the prepared file reusable',async()=>{
  const e=setup();e.application();const files=[];let duringTap=false,shares=0
  e.wx.env={USER_DATA_PATH:'/user'}
  e.wx.getFileSystemManager=()=>({writeFile(o){files.push(o.data);o.success()},readFile(o){o.success({data:files.at(-1)})}})
  e.wx.shareFileMessage=o=>{assert.equal(duringTap,true,'must call WeChat before the tap handler yields');shares++;o.fail({errMsg:'shareFileMessage:fail cancel'})}
  const prepared=await e.backup.prepareFile();assert.equal(shares,0)
  duringTap=true;const first=e.backup.shareFile(prepared);duringTap=false
  assert.equal(shares,1);assert.equal((await first).cancelled,true)
  duringTap=true;const retry=e.backup.shareFile(prepared);duringTap=false
  assert.equal(shares,2);assert.equal((await retry).cancelled,true);assert.equal(files.length,1)
})
test('file selection cancellation, oversize metadata, full content check and privacy refusal have no storage writes',async()=>{
  const e=setup();const writes=e.calls.writes
  e.wx.chooseMessageFile=o=>o.fail({errMsg:'chooseMessageFile:fail cancel'})
  assert.equal(await e.backup.chooseBackup(),null)
  e.wx.chooseMessageFile=o=>o.success({tempFiles:[{path:'/x.json',size:e.backup.MAX_FILE_BYTES+1}]})
  await assert.rejects(e.backup.chooseBackup(),/过大|上限/)
  e.wx.getFileSystemManager=()=>({getFileInfo(o){o.success({size:2})},readFile(o){o.success({data:new ArrayBuffer(e.backup.MAX_FILE_BYTES+1)})}})
  e.wx.chooseMessageFile=o=>o.success({tempFiles:[{path:'/x.json',size:2}]})
  await assert.rejects(e.backup.chooseBackup(),/过大|上限/)
  e.wx.requirePrivacyAuthorize=o=>o.fail({errMsg:'privacy denied'})
  await assert.rejects(e.backup.chooseBackup(),/隐私|授权/)
  assert.equal(e.calls.writes,writes)
})

test('file import validates actual UTF-8 bytes, including emoji, and rejects malformed encoding without replacing characters',async()=>{
  const e=setup(),text=JSON.stringify({version:1,applications:[],extension:'中😀\n完整'}),bytes=Buffer.from(text,'utf8')
  e.wx.chooseMessageFile=o=>o.success({tempFiles:[{path:'/x.json',size:bytes.length}]})
  let payload=bytes
  e.wx.getFileSystemManager=()=>({getFileInfo(o){o.success({size:payload.length})},readFile(o){o.success({data:payload.buffer.slice(payload.byteOffset,payload.byteOffset+payload.length)})}})
  const preview=await e.backup.chooseBackup();assert.equal(preview.data.extension,'中😀\n完整')
  payload=Buffer.from([0x7B,0x22,0x78,0x22,0x3A,0x22,0xED,0xA0,0x80,0x22,0x7D])
  await assert.rejects(e.backup.chooseBackup(),/UTF-8/)
})

test('original rollback snapshot can be exported read-only even when replacement, auto rollback and explicit rollback safety all fail',async()=>{
  const e=setup();e.application({company:'ORIGINAL'});const incoming=e.raw();incoming.applications[0].company='INCOMING'
  const preview=e.backup.parseBackup(JSON.stringify(incoming))
  e.calls.afterWrite=key=>{if(key==='applylog-data'){e.inject({broken:'PARTIAL'});e.calls.writeError=true}}
  assert.throws(()=>e.backup.restore(preview),/自动回滚失败/)
  e.calls.failWriteKey='applylog-rollback-emergency'
  assert.throws(()=>e.backup.rollback(),/回滚|备份/)
  e.calls.failReadKey='applylog-data'
  assert.equal(e.backup.rollbackInfo().available,true)
  const files=[];e.wx.env={USER_DATA_PATH:'/user'}
  e.wx.getFileSystemManager=()=>({writeFile(o){files.push(o.data);o.success()},readFile(o){o.success({data:files.at(-1)})}})
  e.wx.shareFileMessage=o=>o.success()
  const writes=(e.calls.allWrites||[]).length
  const exported=await e.backup.exportRollback()
  assert.match(exported.fileName,/ApplyLog-Rollback-/)
  assert.equal(JSON.parse(files[0]).data.applications[0].company,'ORIGINAL')
  assert.deepEqual(e.raw(),{broken:'PARTIAL'});assert.equal((e.calls.allWrites||[]).length,writes)
})

test('inconsistent absent rollback snapshot and failed safety read-back never write the business key',()=>{
  const e=setup();e.application();const before=e.raw(),writes=e.calls.writes
  e.wx.setStorageSync(e.backup.ROLLBACK_KEY,{format:'ApplyLogRollback',version:1,createdAt:new Date(e.now).toISOString(),snapshot:{exists:false,value:{bad:true}}})
  assert.throws(()=>e.backup.rollback(),/损坏/);assert.equal(e.calls.writes,writes);assert.deepEqual(e.raw(),before)
  const preview=e.backup.parseBackup(JSON.stringify({version:1,applications:[]}))
  e.calls.readTransform=(key,value)=>key===e.backup.ROLLBACK_KEY?{broken:true}:value
  assert.throws(()=>e.backup.restore(preview),/核验|备份/);assert.equal(e.calls.writes,writes);assert.deepEqual(e.raw(),before)
})
