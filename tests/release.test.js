const test=require('node:test')
const assert=require('node:assert/strict')
const {environment,clone,tap}=require('./helpers')

function fileSource(e,data){
  const bytes=Buffer.from(JSON.stringify(data),'utf8')
  e.wx.chooseMessageFile=o=>o.success({tempFiles:[{path:'/backup.json',size:bytes.length}]})
  e.wx.getFileSystemManager=()=>({getFileInfo(o){o.success({size:bytes.length})},readFile(o){o.success({data:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)})}})
}
test('restore page selection and confirmation cancellation do not write and repeated confirmation restores once',async()=>{
  const e=environment(),original=e.application(),incoming=e.raw();incoming.applications[0].company='从备份恢复'
  fileSource(e,incoming)
  const page=e.page('backup'),before=e.raw(),writes=e.calls.writes
  await page.chooseFile();assert.equal(page.data.preview.counts.applications,1);assert.equal(e.calls.writes,writes)
  page.confirmRestore();page.confirmRestore();assert.equal(e.calls.modals.length,1)
  e.calls.modals.pop().success({confirm:false});assert.deepEqual(e.raw(),before)
  page.confirmRestore();e.calls.modals.pop().success({confirm:true})
  assert.equal(e.calls.writes,writes+1);assert.equal(e.store.get(original.id).company,'从备份恢复')
  page.confirmRestore();assert.equal(e.calls.writes,writes+1)
  assert.equal(page.data.preview,null);assert.equal(page.data.rollback.available,true)
})
test('restore page keeps preview on write failure for retry and invalidates operations after unload',async()=>{
  const e=environment();e.application();const incoming=e.raw();incoming.applications[0].note='备份内容'
  fileSource(e,incoming);const page=e.page('backup');await page.chooseFile()
  const before=e.raw();e.calls.writeError=true
  page.confirmRestore();e.calls.modals.pop().success({confirm:true})
  assert.deepEqual(e.raw(),before);assert.ok(page.data.preview);assert.match(page.data.error,/失败/)
  e.calls.writeError=false;page.confirmRestore();page.onUnload();e.calls.modals.pop().success({confirm:true})
  assert.deepEqual(e.raw(),before)
})
test('restore refreshes snapshot consumers, badge, question book and defaults without calendar calls',async()=>{
  const e=environment(),app=e.application(),incoming=e.raw();incoming.lastUsedCity='成都';incoming.lastUsedChannel='内推'
  incoming.applications[0].reminders=[{id:'calendar-old',type:'interview',time:e.now+3600000,done:false,calendarAddedAt:e.now,note:'旧日历'}]
  incoming.applications[0].interviews=[{id:'r',round:'一面',date:e.now,selfScore:5,questions:[{q:'恢复的问题',myAnswer:''}]}]
  let calendars=0;e.wx.addPhoneCalendar=()=>calendars++
  const home=e.page('index'),book=e.page('questions'),mine=e.page('mine')
  fileSource(e,incoming);const page=e.page('backup');await page.chooseFile();page.confirmRestore();e.calls.modals.pop().success({confirm:true})
  home.onShow();book.onShow();mine.onShow()
  assert.equal(home.data.reminders.length,1);assert.equal(book.data.total,1);assert.equal(mine.data.questionCount,1)
  assert.equal(e.load('utils/tabbar.js').tabState().badge,'1')
  const edit=e.page('edit');assert.equal(edit.data.form.city,'成都');assert.equal(edit.data.form.channel,'内推')
  const detail=e.page('detail',{id:app.id});detail.addToCalendar(tap('id','calendar-old'))
  assert.equal(calendars,0);assert.equal(e.calls.sheets.length,1)
  e.calls.sheets.pop().success({tapIndex:0})
  assert.equal(e.store.get(app.id).reminders[0].calendarReviewRequired,undefined)
})
test('first-use guide stays dismissed on subsequent visits, retrying failed acknowledgement preserves the notice',()=>{
  const e=environment(),guide=e.load('utils/guide.js')
  assert.equal(guide.shouldShow(),true);guide.acknowledge();assert.equal(guide.shouldShow(),false)
  const home=e.page('index');assert.equal(home.data.showGuide,false)
  e.wx.removeStorageSync(guide.GUIDE_KEY);home.onShow();assert.equal(home.data.showGuide,true)
  e.calls.failWriteKey=guide.GUIDE_KEY;home.dismissGuide();assert.equal(home.data.showGuide,true)
})
test('application version labels distinguish development, trial, release and unknown environments',()=>{
  const e=environment(),info=e.load('utils/app-info.js')
  for(const [envVersion,label] of [['develop','开发版'],['trial','体验版'],['release','正式版'],['other','环境未知']]) {
    e.wx.getAccountInfoSync=()=>({miniProgram:{envVersion,version:'2.0.0'}})
    const result=info.versionInfo();assert.equal(result.environment,label);assert.equal(result.version,envVersion==='release'?'2.0.0':info.APP_VERSION)
  }
})

test('demo management opens only for the development build in WeChat DevTools and fails closed on missing runtime information',()=>{
  const e=environment(),info=e.load('utils/app-info.js')
  for(const envVersion of ['develop','trial','release','other',undefined]) {
    for(const platform of ['devtools','android','ios',undefined]) {
      e.wx.getAccountInfoSync=()=>({miniProgram:{envVersion}})
      e.wx.getDeviceInfo=()=>({platform})
      assert.equal(info.canManageDemo(),envVersion==='develop'&&platform==='devtools',`${envVersion}/${platform}`)
    }
  }
  delete e.wx.getDeviceInfo
  e.wx.getAccountInfoSync=()=>({miniProgram:{envVersion:'develop'}})
  assert.equal(info.canManageDemo(),false)
  e.wx.getDeviceInfo=()=>({platform:'devtools'})
  e.wx.getAccountInfoSync=()=>{throw Error('unavailable')}
  assert.equal(info.canManageDemo(),false)
  delete e.wx.getAccountInfoSync
  assert.equal(info.canManageDemo(),false)
  assert.equal(e.calls.writes,0)
})

test('phone and published environments cannot load or remove demos even by invoking hidden handlers',()=>{
  const e=environment();e.application();e.store.seedDemo()
  e.wx.getDeviceInfo=()=>({platform:'android'})
  e.wx.getAccountInfoSync=()=>({miniProgram:{envVersion:'develop'}})
  const mine=e.page('mine'),before=e.raw(),writes=e.calls.writes
  assert.equal(mine.data.canManageDemo,false)
  mine.data.canManageDemo=true
  mine.loadDemo();mine.removeDemo()
  assert.equal(e.calls.modals.length,0);assert.equal(e.calls.writes,writes);assert.deepEqual(e.raw(),before)
  for(const envVersion of ['trial','release']) {
    e.wx.getDeviceInfo=()=>({platform:'devtools'})
    e.wx.getAccountInfoSync=()=>({miniProgram:{envVersion}})
    mine.onShow();assert.equal(mine.data.canManageDemo,false)
    mine.loadDemo();mine.removeDemo()
    assert.deepEqual(e.raw(),before);assert.equal(e.calls.writes,writes)
  }
})

test('development tools retain working demo management and removal rechecks capability after confirmation',()=>{
  const e=environment(),real=e.application({note:'保留真实记录'})
  e.wx.getDeviceInfo=()=>({platform:'devtools'})
  e.wx.getAccountInfoSync=()=>({miniProgram:{envVersion:'develop'}})
  const mine=e.page('mine');assert.equal(mine.data.canManageDemo,true)
  mine.loadDemo();assert.equal(mine.data.summary.demoCount,6)
  mine.removeDemo();const pending=e.calls.modals.pop()
  e.wx.getDeviceInfo=()=>({platform:'android'})
  pending.success({confirm:true})
  assert.equal(e.store.snapshot().stats().demoCount,6)
  e.wx.getDeviceInfo=()=>({platform:'devtools'})
  mine.onShow();mine.removeDemo();e.calls.modals.pop().success({confirm:true})
  assert.equal(mine.data.summary.demoCount,0)
  assert.equal(e.store.get(real.id).note,'保留真实记录')
})
test('damaged-data rescue remains available and export cancellation never claims a permanent phone backup',async()=>{
  const e=environment();e.inject({version:1,applications:'损坏数据'})
  const mine=e.page('mine');mine.exportJson();assert.match(e.calls.clipboard,/损坏数据/)
  const files=[];e.wx.env={USER_DATA_PATH:'/user'}
  e.wx.getFileSystemManager=()=>({writeFile(o){files.push(o.data);o.success()},readFile(o){o.success({data:files.at(-1)})}})
  e.wx.shareFileMessage=o=>o.fail({errMsg:'shareFileMessage:fail cancel'})
  mine.exportBackup();e.calls.modals.pop().success({confirm:true});await new Promise(resolve=>setTimeout(resolve,0))
  assert.equal(JSON.parse(files[0]).data.applications,'损坏数据')
  assert.ok(mine.data.preparedFileName)
  await mine.shareBackup()
  assert.match(mine.data.fileMessage,/取消|尚未/);assert.doesNotMatch(mine.data.fileMessage,/已保存到手机/)
})

test('clearing local backups removes safety snapshots and only ApplyLog work files, leaving unrelated files alone',async()=>{
  const e=environment(),backup=e.load('utils/backup.js');e.application()
  backup.restore(backup.parseBackup(JSON.stringify({version:1,applications:[]})))
  e.wx.env={USER_DATA_PATH:'/user'};const removed=[]
  e.wx.getFileSystemManager=()=>({readdir(o){o.success({files:['ApplyLog-2026-11-14T10-00-00-000Z-1-abc.json','other.json']})},unlink(o){removed.push(o.filePath);o.success()}})
  await backup.clearLocalBackups()
  assert.equal(backup.rollbackInfo().available,false)
  assert.deepEqual(removed,['/user/ApplyLog-2026-11-14T10-00-00-000Z-1-abc.json'])
})
