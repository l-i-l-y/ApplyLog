const test=require('node:test')
const assert=require('node:assert/strict')
const {environment,tap}=require('./helpers')
const input=(field,value)=>({currentTarget:{dataset:{field}},detail:{value}})
function setup(name) {
  const e=environment(),app=e.application()
  let options={id:app.id}
  if(name==='reminder-edit'){const r=e.store.addReminder(app.id,{type:'interview',time:e.now+3600000,round:'一面',note:'原备注'});options.reminder=r.id}
  const native=[];e.wx.enableAlertBeforeUnload=o=>{native.push('enable');o.success?.()};e.wx.disableAlertBeforeUnload=o=>{native.push('disable');o?.success?.()}
  const page=e.page(name,options)
  return {e,page,native,app}
}
function change(name,page,value) {
  if(name==='interview')page.onReflection({detail:{value}})
  else page.onInput(input(name==='edit'?'company':'note',value))
}
for(const name of ['edit','interview','reminder-edit']) {
  test(name+': unchanged and presentation-only state can leave; changed content confirms once and cancellation preserves draft',()=>{
    const {e,page,native}=setup(name)
    page.setData({keyboardHeight:250,expanded:true,focusField:'note'})
    page.requestLeave();assert.equal(e.calls.modals.length,0);assert.equal(e.calls.backs,1)
    page.onShow()
    const original=name==='edit'?page.data.form.company:name==='interview'?page.data.form.reflection:page.data.form.note
    change(name,page,'未保存\n中文😀');assert.equal(page.isFormDirty(),true);assert.equal(native.at(-1),'enable')
    const before=e.raw();page.requestLeave();page.requestLeave();assert.equal(e.calls.modals.length,1)
    assert.equal(e.calls.modals[0].cancelText,'继续编辑');assert.equal(e.calls.modals[0].confirmText,'放弃修改')
    e.calls.modals.pop().success({confirm:false});assert.deepEqual(e.raw(),before);assert.equal(page.isFormDirty(),true)
    change(name,page,original);assert.equal(page.isFormDirty(),false)
    page.requestLeave();assert.equal(e.calls.modals.length,0);assert.equal(e.calls.backs,2)
  })
  test(name+': write failure remains dirty; successful save and failed return allow retry without another write or warning',()=>{
    const {e,page}=setup(name)
    if(name==='interview')page.selectScore(tap('score',4))
    change(name,page,'修改内容')
    const save=()=>name==='edit'?page.saveApplication():name==='interview'?page.saveReview():page.saveReminder()
    e.calls.writeError=true;save();assert.equal(page.isFormDirty(),true)
    e.calls.writeError=false;e.calls.navigationError=true;save()
    assert.equal(page.isFormDirty(),false);assert.equal(page.data.saving,false)
    const writes=e.calls.writes;e.calls.navigationError=false;save();assert.equal(e.calls.writes,writes)
    page.onShow();page.requestLeave();assert.equal(e.calls.modals.length,0)
  })
  test(name+': confirmed discard, navigation failure and API unavailability keep the draft usable',()=>{
    const {e,page}=setup(name);change(name,page,'保留草稿')
    e.calls.navigationError=true;page.requestLeave();e.calls.modals.pop().success({confirm:true})
    assert.equal(page.isFormDirty(),true);assert.equal(page.leaveNavigating,false)
    e.wx.enableAlertBeforeUnload=undefined;page.onHide();page.onShow();assert.equal(page.isFormDirty(),true)
    e.calls.navigationError=false;page.requestLeave();e.calls.modals.pop().success({confirm:true});assert.ok(e.calls.backs>=2)
  })
}
test('question UI keys, adding empty rows and restoring type/salary selections do not create false modifications',()=>{
  const {e,page}=setup('interview');page.addQuestion();page.removeQuestion(tap('index',0));assert.equal(page.isFormDirty(),false)
  const reminder=setup('reminder-edit').page;reminder.changeType(tap('type','followup'));assert.equal(reminder.isFormDirty(),true);reminder.changeType(tap('type','interview'));assert.equal(reminder.isFormDirty(),false)
  const edit=e.page('edit');edit.pickSalary({detail:{value:edit.data.salaryOptions.length-1}});edit.pickSalary({detail:{value:0}});assert.equal(edit.isFormDirty(),false)
})
