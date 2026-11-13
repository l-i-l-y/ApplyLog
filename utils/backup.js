const store = require('./store')
const { privacyAuthorization } = require('./privacy')

const FORMAT = 'ApplyLogBackup'
const VERSION = 1
const DATA_KEY = 'applylog-data'
const ROLLBACK_KEY = 'applylog-restore-rollback'
const EMERGENCY_KEY = 'applylog-rollback-emergency'
// WeChat: 1 MiB per storage key, 10 MiB total (also check the runtime limit).
// Allow 2 MiB files for indentation in legacy exports; restored compact data must fit one key.
const MAX_DATA_BYTES = 1024 * 1024
const MAX_FILE_BYTES = 2 * MAX_DATA_BYTES
let sequence = 0

function utf8Bytes(text) {
  let size = 0
  for (let i = 0; i < text.length; i++) {
    const n = text.charCodeAt(i)
    if (n < 0x80) size++
    else if (n < 0x800) size += 2
    else if (n >= 0xD800 && n <= 0xDBFF && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xDC00 && text.charCodeAt(i + 1) <= 0xDFFF) { size += 4; i++ }
    else size += 3
  }
  return size
}
function decodeUtf8(buffer) {
  if (!buffer || Object.prototype.toString.call(buffer) !== '[object ArrayBuffer]') throw new Error('未能读取完整的 UTF-8 文件')
  const bytes = new Uint8Array(buffer)
  if (bytes.length > MAX_FILE_BYTES) throw new Error('备份文件过大，单文件上限为 2 MiB')
  const chunks = []; let chunk = ''
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i++]; let code = first, remaining = 0, minimum = 0
    if (first < 0x80) code = first
    else if (first >= 0xC2 && first <= 0xDF) { code = first & 31; remaining = 1; minimum = 0x80 }
    else if (first >= 0xE0 && first <= 0xEF) { code = first & 15; remaining = 2; minimum = 0x800 }
    else if (first >= 0xF0 && first <= 0xF4) { code = first & 7; remaining = 3; minimum = 0x10000 }
    else throw new Error('文件不是有效的 UTF-8 编码，未修改任何文本')
    while (remaining--) {
      const next = bytes[i++]
      if (next === undefined || next < 0x80 || next > 0xBF) throw new Error('文件不是有效的 UTF-8 编码，未修改任何文本')
      code = (code << 6) | (next & 63)
    }
    if (code < minimum || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) throw new Error('文件不是有效的 UTF-8 编码，未修改任何文本')
    chunk += String.fromCodePoint(code)
    if (chunk.length >= 4096) { chunks.push(chunk); chunk = '' }
  }
  return chunks.join('') + chunk
}
function json(value) {
  try {
    const text = JSON.stringify(value)
    if (typeof text !== 'string') throw new Error()
    return text
  } catch (error) { throw new Error('数据无法完整转换为 JSON，请先复制原始数据救援') }
}
const clone = value => JSON.parse(json(value))
function same(a, b) {
  const pairs = [[a, b]]
  while (pairs.length) {
    const [x, y] = pairs.pop()
    if (x === y) continue
    if (!x || !y || typeof x !== 'object' || typeof y !== 'object' || Array.isArray(x) !== Array.isArray(y)) return false
    const keys = Object.keys(x), other = Object.keys(y)
    if (keys.length !== other.length || keys.some(key => !Object.prototype.hasOwnProperty.call(y, key))) return false
    for (const key of keys) pairs.push([x[key], y[key]])
  }
  return true
}
function storageInfo() {
  let info
  try { info = wx.getStorageInfoSync() } catch (error) { throw new Error('无法核对本机存储容量，已停止恢复') }
  if (!info || !Array.isArray(info.keys) || !Number.isFinite(info.currentSize) || !Number.isFinite(info.limitSize) || info.currentSize < 0 || info.limitSize <= 0) throw new Error('无法核对本机存储容量，已停止恢复')
  return info
}
function current() {
  const info = storageInfo()
  try { return info.keys.includes(DATA_KEY) ? { exists: true, value: clone(wx.getStorageSync(DATA_KEY)) } : { exists: false, value: null } }
  catch (error) { throw new Error('无法完整读取原数据，已停止恢复') }
}
function dataSize(data) {
  const size = utf8Bytes(json(data))
  if (size > MAX_DATA_BYTES) throw new Error('数据过大：恢复后的单项数据上限为 1 MiB，不会截断内容')
  return size
}
function counts(data) {
  return data.applications.reduce((result, item) => ({ applications: result.applications + 1, reminders: result.reminders + item.reminders.length, interviews: result.interviews + item.interviews.length }), { applications: 0, reminders: 0, interviews: 0 })
}
function createBackup(data = store.exportData()) {
  // Intentionally do not validate here: damaged data must retain a rescue export.
  return { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), data: clone(data) }
}
function parseBackup(text) {
  if (typeof text !== 'string' || utf8Bytes(text) > MAX_FILE_BYTES) throw new Error('备份文件过大，单文件上限为 2 MiB')
  let parsed
  try { parsed = JSON.parse(text.replace(/^\uFEFF/, '')) } catch (error) { throw new Error('文件不是有效的 UTF-8 JSON 备份') }
  let data = parsed, exportedAt = null
  if (!parsed || !Array.isArray(parsed.applications)) {
    if (!parsed || parsed.format !== FORMAT) throw new Error('备份格式无法识别，请选择 ApplyLog 备份或旧版完整 JSON')
    if (parsed.version !== VERSION) throw new Error('备份文件版本无法读取')
    if (typeof parsed.exportedAt !== 'string' || !Number.isFinite(Date.parse(parsed.exportedAt))) throw new Error('备份时间格式异常')
    data = parsed.data; exportedAt = parsed.exportedAt
  }
  store.validateData(data)
  dataSize(data)
  return { data: clone(data), exportedAt, counts: counts(data), baseline: current() }
}
function calendarReview(data) {
  const result = clone(data)
  for (const app of result.applications) for (const reminder of app.reminders) {
    if (reminder.calendarAddedAt !== undefined || reminder.calendarPendingAt !== undefined) reminder.calendarReviewRequired = true
  }
  return result
}
function safetyRecord(snapshot) { return { format: 'ApplyLogRollback', version: VERSION, createdAt: new Date().toISOString(), snapshot: clone(snapshot) } }
function readSafety(key) {
  let saved
  try { saved = wx.getStorageSync(key) } catch (error) { throw new Error('无法读取回滚快照，请重试或导出原始数据救援') }
  if (!saved || saved.format !== 'ApplyLogRollback' || saved.version !== VERSION || !Number.isFinite(Date.parse(saved.createdAt)) || !saved.snapshot || typeof saved.snapshot.exists !== 'boolean' || !Object.prototype.hasOwnProperty.call(saved.snapshot, 'value') || (!saved.snapshot.exists && saved.snapshot.value !== null)) throw new Error('回滚快照不存在或已损坏，不能覆盖当前数据')
  return saved
}
function prepareSafety(snapshot, replacement, key) {
  const saved = safetyRecord(snapshot), text = json(saved), bytes = utf8Bytes(text), info = storageInfo()
  if (bytes > MAX_DATA_BYTES) throw new Error('原数据过大，无法完整保存回滚备份，已停止恢复')
  let previousSize = 0
  if (info.keys.includes(key)) {
    try { previousSize = utf8Bytes(json(wx.getStorageSync(key))) } catch (error) { throw new Error('无法核对旧回滚备份，已停止恢复') }
  }
  const oldSize = snapshot.exists ? utf8Bytes(json(snapshot.value)) : 0
  const nextSize = replacement.exists ? dataSize(replacement.value) : 0
  const peak = info.currentSize * 1024 - previousSize + bytes + Math.max(0, nextSize - oldSize) + 512
  if (peak > info.limitSize * 1024) throw new Error('本机存储空间不足，无法同时保留原数据与回滚备份，已停止恢复')
  try {
    wx.setStorageSync(key, saved)
    if (!same(wx.getStorageSync(key), saved)) throw new Error()
  } catch (error) { throw new Error('无法完整保存并核验原数据回滚备份，已停止恢复') }
}
function writeSnapshot(snapshot) {
  if (snapshot.exists) wx.setStorageSync(DATA_KEY, snapshot.value)
  else wx.removeStorageSync(DATA_KEY)
}
function commit(replacement, original, safetyKey) {
  prepareSafety(original, replacement, safetyKey)
  let reason = '恢复写入失败'
  try {
    writeSnapshot(replacement)
    reason = '恢复后的数据核验失败'
    if (!same(current(), replacement)) throw new Error()
  } catch (error) {
    try {
      if (!same(current(), original)) writeSnapshot(original)
      if (!same(current(), original)) throw new Error()
    } catch (rollbackError) {
      throw new Error(reason + '；自动回滚失败。原值仍在' + (safetyKey === ROLLBACK_KEY ? '回滚快照，请使用回滚入口' : '回滚前救援快照，请导出该快照') + '，不要清空本机数据')
    }
    throw new Error(reason + '；原数据已保留或自动回滚，请重试')
  }
}
function restore(preview) {
  if (!preview || !preview.baseline) throw new Error('请重新选择并预览备份')
  const original = current()
  if (!same(original, preview.baseline)) throw new Error('预览后本机数据已变化，请重新选择备份并确认')
  store.validateData(preview.data)
  const data = calendarReview(preview.data)
  dataSize(data)
  commit({ exists: true, value: data }, original, ROLLBACK_KEY)
  return counts(data)
}
function rollbackInfo() {
  const info = storageInfo()
  let result = { available: false, emergencyAvailable: info.keys.includes(EMERGENCY_KEY) }
  if (info.keys.includes(ROLLBACK_KEY)) {
    const saved = readSafety(ROLLBACK_KEY)
    let alreadyCurrent = false
    try { alreadyCurrent = same(current(), saved.snapshot) } catch (error) { /* Still offer read-only export if the business key cannot be read. */ }
    result = { ...result, available: true, createdAt: saved.createdAt, alreadyCurrent }
  }
  return result
}
function rollback() {
  const saved = readSafety(ROLLBACK_KEY), original = current()
  if (same(original, saved.snapshot)) return false
  // Keep the original rollback source intact. A separate emergency snapshot protects a failed rollback.
  commit(saved.snapshot, original, EMERGENCY_KEY)
  return true
}
const cancelled = error => /cancel|取消/i.test(String(error && (error.errMsg || error.message)))
function invoke(target, method, options) {
  return new Promise((resolve, reject) => {
    if (!target || typeof target[method] !== 'function') { reject(new Error('当前微信不支持此文件功能，请升级微信或先复制 JSON 备份')); return }
    try { target[method]({ ...options, success: resolve, fail: reject }) } catch (error) { reject(error) }
  })
}
function fileSystem() {
  if (typeof wx.getFileSystemManager !== 'function') throw new Error('当前微信不支持文件操作，请升级或先复制 JSON')
  return wx.getFileSystemManager()
}
async function chooseBackup() {
  await privacyAuthorization()
  let result
  try { result = await invoke(wx, 'chooseMessageFile', { count: 1, type: 'file', extension: ['json'] }) }
  catch (error) { if (cancelled(error)) return null; throw new Error('未能选择备份文件，请检查微信隐私授权后重试') }
  const file = result.tempFiles && result.tempFiles[0]
  if (!file || typeof file.path !== 'string') throw new Error('未获得可读取的备份文件')
  if (Number.isFinite(file.size) && file.size > MAX_FILE_BYTES) throw new Error('备份文件过大，单文件上限为 2 MiB')
  const fs = fileSystem()
  let size, content
  try {
    size = await invoke(fs, 'getFileInfo', { filePath: file.path })
    if (!Number.isFinite(size.size) || size.size < 0) throw new Error()
    if (size.size > MAX_FILE_BYTES) throw new Error('备份文件过大，单文件上限为 2 MiB')
    content = await invoke(fs, 'readFile', { filePath: file.path })
  } catch (error) { throw new Error(error.message && /过大/.test(error.message) ? error.message : '无法完整读取备份文件，请重新选择 UTF-8 JSON') }
  return parseBackup(decodeUtf8(content.data))
}
async function prepareFile(data, kind = '') {
  const text = json(createBackup(data))
  if (utf8Bytes(text) > MAX_FILE_BYTES) throw new Error('导出文件超过 2 MiB，请先使用原始 JSON 复制救援')
  const fileName = 'ApplyLog' + (kind ? '-' + kind : '') + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + (++sequence) + '-' + Math.random().toString(36).slice(2, 8) + '.json'
  if (!wx.env || !wx.env.USER_DATA_PATH) throw new Error('无法获取文件目录，请先复制 JSON 备份')
  const filePath = wx.env.USER_DATA_PATH + '/' + fileName, fs = fileSystem()
  try {
    await invoke(fs, 'writeFile', { filePath, data: text, encoding: 'utf8' })
    const read = await invoke(fs, 'readFile', { filePath, encoding: 'utf8' })
    if (read.data !== text) throw new Error()
  } catch (error) { throw new Error('备份文件写入或核验失败，请检查空间后重试；也可先复制 JSON') }
  return { filePath, fileName }
}
// Invoke synchronously in a fresh button tap. Awaiting file I/O or a modal first loses
// the WeChat user-TAP context, even though the file was generated successfully.
function shareFile(file) {
  if (!file || typeof file.filePath !== 'string' || typeof file.fileName !== 'string') return Promise.reject(new Error('请先生成并核验备份文件'))
  if (typeof wx.shareFileMessage !== 'function') return Promise.resolve({ ...file, shared: false, unsupported: true })
  return invoke(wx, 'shareFileMessage', { filePath: file.filePath, fileName: file.fileName }).then(
    () => ({ ...file, shared: true }),
    error => {
      if (cancelled(error)) return { ...file, shared: false, cancelled: true }
      console.error('ApplyLog file share failed', error)
      if (/TAP|gesture/i.test(String(error && error.errMsg))) throw new Error('微信要求直接点击分享，请点“分享备份文件”重试')
      throw new Error('微信文件分享未完成，请重试；尚未确认保存到小程序之外')
    }
  )
}
function exportSafety(key, kind) { const saved = readSafety(key); return prepareFile(saved.snapshot.exists ? saved.snapshot.value : { version: 1, applications: [] }, kind) }
function exportRollback() { return exportSafety(ROLLBACK_KEY, 'Rollback') }
function exportEmergency() { return exportSafety(EMERGENCY_KEY, 'Emergency') }

async function clearLocalBackups() {
  try {
    wx.removeStorageSync(ROLLBACK_KEY)
    wx.removeStorageSync(EMERGENCY_KEY)
    if (wx.env && wx.env.USER_DATA_PATH && typeof wx.getFileSystemManager === 'function') {
      const fs = fileSystem(), result = await invoke(fs, 'readdir', { dirPath: wx.env.USER_DATA_PATH })
      for (const name of result.files) {
        if (/^ApplyLog-(?:(?:Rollback|Emergency)-)?\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-\d+-[a-z0-9]*\.json$/i.test(name)) await invoke(fs, 'unlink', { filePath: wx.env.USER_DATA_PATH + '/' + name })
      }
    }
  } catch (error) { throw new Error('投递已清空，但本机回滚快照或备份工作文件未完全移除，请重试；外部备份及系统日历需自行删除') }
}

module.exports = { FORMAT, VERSION, ROLLBACK_KEY, MAX_DATA_BYTES, MAX_FILE_BYTES, utf8Bytes, createBackup, parseBackup, restore, rollbackInfo, rollback, chooseBackup, prepareFile, shareFile, exportRollback, exportEmergency, clearLocalBackups }
