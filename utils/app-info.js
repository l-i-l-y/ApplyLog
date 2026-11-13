const APP_VERSION = '1.0.1'
function versionInfo() {
  let runtime = {}
  try { runtime = wx.getAccountInfoSync().miniProgram || {} } catch (error) { /* Older environments may omit this API. */ }
  const labels = { develop: '开发版', trial: '体验版', release: '正式版' }
  return { version: runtime.envVersion === 'release' && runtime.version ? runtime.version : APP_VERSION, environment: labels[runtime.envVersion] || '环境未知' }
}
// Local development tools only. Runtime versions do not identify the user's role.
function canManageDemo() {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion === 'develop' && wx.getDeviceInfo().platform === 'devtools'
  } catch (error) { return false }
}
const GUIDE = [
  '求职记录仅保存在当前设备，当前没有云同步。换机、清理小程序数据或本机存储被系统清理都可能丢失记录。',
  '请定期导出备份，并通过微信文件分享等方式保存在小程序之外。小程序内生成的工作文件不是永久备份。',
  '提醒可在应用内查看，也可由你主动加入手机日历。当前没有微信后台到点自动推送；日历通知取决于实际保存的事件及设备权限。',
  '编辑或删除应用内提醒，不会自动修改或删除手机日历事件。恢复备份不能迁移系统日历，请先按“核对手机日历”检查，避免重复添加。',
  '表单有修改时，应用内返回会询问是否放弃；系统返回使用微信支持的离页提醒。微信不拦截手势滑动返回，关闭微信和进程终止等路径也不能保证拦截，这不是自动草稿恢复。'
]
const PRIVACY = [
  '记录内容包括公司、岗位、投递日期与状态、城市、渠道、薪资、职位链接、备注、提醒时间与地点／链接，以及面试问题、回答、评分和心得；也会保存城市／渠道偏好。',
  '本应用当前未接入云同步、登录或求职记录上传服务。记录与恢复前回滚快照保存在微信提供的本机存储，导出工作文件位于小程序私有文件目录。',
  '微信平台自身可能按其规则处理账号、设备、文件分享、权限和反馈等信息；“应用没有主动上传求职记录”不等于微信平台不处理任何数据。',
  '选择恢复文件和加入手机日历均由你主动操作。微信可能要求同意其配置的隐私指引或系统日历权限；日历内容包含公司、岗位、提醒时间、地点、链接及备注。拒绝不会影响本地记录。',
  '备份为未加密的 UTF-8 JSON，包含公司、薪资、面试记录等敏感内容。请只分享给可信对象并妥善保管；复制 JSON 也会将这些内容放入设备剪贴板。',
  '可以逐条删除记录，或在“本机数据”中清空投递、提醒、复盘和偏好，并移除本小程序内的回滚快照及导出工作文件。完整移除本地小程序数据还可使用微信提供的数据管理功能。',
  '应用内删除、清空和恢复不会自动删除手机日历事件或你已保存在外部的备份文件，这些内容需分别在日历或外部保存位置手动处理。',
  '本说明不代替微信后台《用户隐私保护指引》。运营主体及后台所需声明应由开发者按实际情况填写；应用不编造主体身份、联系方式或审核状态。'
]
module.exports = { APP_VERSION, versionInfo, canManageDemo, GUIDE, PRIVACY }
