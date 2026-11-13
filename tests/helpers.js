const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const tap = (key, value) => ({ currentTarget: { dataset: { [key]: value } } })

function environment() {
  let stored = '', now = new Date(2026, 10, 14, 10).getTime()
  const auxiliary = new Map()
  const calls = { reads: 0, writes: 0, modals: [], toasts: [], urls: [], backs: 0, sheets: [], keyboards: new Set(), resizes: new Set() }
  const wx = {
    getStorageSync(key) {
      if (key === 'applylog-data') calls.reads++
      if (calls.readError || calls.failReadKey === key) throw Error('unavailable')
      const value = clone(key === 'applylog-data' ? stored : auxiliary.get(key) ?? '')
      return calls.readTransform ? calls.readTransform(key, value) : value
    },
    setStorageSync(key, data) {
      if ((key === 'applylog-data' && calls.writeError) || calls.failWriteKey === key) throw Error('disk full')
      if (key === 'applylog-data') { stored = clone(data); calls.writes++ }
      else auxiliary.set(key, clone(data))
      ;(calls.allWrites ||= []).push(key)
      calls.afterWrite?.(key, clone(data))
    },
    removeStorageSync(key) { if (key === 'applylog-data') { stored = ''; calls.writes++ } else auxiliary.delete(key) },
    getStorageInfoSync() {
      if (calls.capacityError) throw Error('unavailable')
      return { keys: [...(stored === '' ? [] : ['applylog-data']), ...auxiliary.keys()], currentSize: calls.currentSize ?? 10, limitSize: calls.limitSize ?? 10240 }
    },
    showToast: options => calls.toasts.push(options.title),
    showModal: options => calls.modals.push(options),
    showActionSheet: options => calls.sheets.push(options),
    navigateTo(options) { calls.urls.push(options.url); calls.lastNavigation = options; if (calls.openError) options.fail?.() },
    navigateBack(options) { calls.backs++; if (calls.navigationError) options.fail?.(); else options.success?.() },
    switchTab(options) { if (calls.navigationError) options.fail?.(); else options.success?.() },
    setClipboardData(options) { calls.clipboard = options.data; options.success?.() },
    getWindowInfo: () => ({ screenWidth: 390, screenHeight: 844, windowWidth: 390, windowHeight: 844, safeArea: { top: 47, bottom: 810 } }),
    onKeyboardHeightChange: listener => calls.keyboards.add(listener),
    offKeyboardHeightChange: listener => calls.keyboards.delete(listener),
    onWindowResize: listener => calls.resizes.add(listener),
    offWindowResize: listener => calls.resizes.delete(listener)
  }
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  const cache = new Map()
  function load(file) {
    const absolute = path.resolve(root, file)
    if (cache.has(absolute)) return cache.get(absolute)
    const module = { exports: {} }
    vm.runInNewContext(fs.readFileSync(absolute, 'utf8'), {
      module, exports: module.exports, wx, Date: Clock, console, setTimeout, clearTimeout,
      getCurrentPages: () => [{}, {}],
      require: name => load(path.resolve(path.dirname(absolute), name + '.js')),
      Page: definition => { module.exports = definition },
      Component: definition => { module.exports = definition }
    }, {filename:absolute})
    cache.set(absolute, module.exports)
    return module.exports
  }
  function page(name, options = {}) {
    const definition = load('pages/' + name + '/' + name + '.js')
    const instance = { ...definition, data: clone(definition.data), setData(patch, done) {
      for (const [key,value] of Object.entries(patch)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
        let target = this.data
        for (const part of parts.slice(0,-1)) target = target[part]
        target[parts.at(-1)] = clone(value)
      }
      done?.()
    } }
    instance.onLoad?.(options)
    instance.onShow?.()
    return instance
  }
  const store = load('utils/store.js')
  return { store, load, page, calls, wx, now, advance(ms) { now += ms },
    raw: () => clone(stored), inject(value) { stored = clone(value) },
    application(fields = {}) { return store.create({company:'测试公司', position:'开发工程师', ...fields}) } }
}
module.exports = { environment, clone, tap }
