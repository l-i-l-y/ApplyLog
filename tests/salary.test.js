const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')

const root = path.resolve(__dirname, '..')
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))

// Exercise the actual page and store; only the native WeChat boundary is simulated.
function environment() {
  let stored = ''
  const calls = { reads: 0, writes: 0, toasts: [] }
  const wx = {
    getStorageSync() { calls.reads += 1; return clone(stored) },
    setStorageSync(_key, value) {
      if (calls.writeError) throw new Error('disk full')
      stored = clone(value)
      calls.writes += 1
    },
    showToast: options => calls.toasts.push(options),
    navigateBack: options => calls.navigationError ? options.fail() : options.success(),
    switchTab: options => calls.navigationError ? options.fail() : options.success()
  }
  const cache = new Map()
  function load(filename) {
    const absolute = path.resolve(root, filename)
    if (cache.has(absolute)) return cache.get(absolute)
    const module = { exports: {} }
    cache.set(absolute, module.exports)
    vm.runInNewContext(fs.readFileSync(absolute, 'utf8'), {
      module, exports: module.exports, wx, console, setTimeout, clearTimeout,
      getCurrentPages: () => [{}, {}],
      require: name => load(path.relative(root, path.resolve(path.dirname(absolute), name + '.js'))),
      Page: definition => { module.exports = definition }
    }, { filename: absolute })
    cache.set(absolute, module.exports)
    return module.exports
  }
  function page(options = {}) {
    const definition = load('pages/edit/edit.js')
    const instance = { ...definition, data: clone(definition.data) }
    instance.setData = (changes, done) => {
      for (const [key, value] of Object.entries(changes)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
        let target = instance.data
        for (const part of parts.slice(0, -1)) target = target[part]
        target[parts.at(-1)] = clone(value)
      }
      if (done) done()
    }
    instance.onLoad(options)
    instance.onShow()
    return instance
  }
  return {
    store: load('utils/store.js'), page, calls,
    raw: () => clone(stored), inject: value => { stored = clone(value) },
    restart: () => cache.clear()
  }
}

const input = (page, field, value) => page.onInput({ currentTarget: { dataset: { field } }, detail: { value } })
const select = (page, index) => page.pickSalary({ detail: { value: String(index) } })
const next = (page, target) => page.focusNext({ currentTarget: { dataset: { next: target } } })
const ready = page => {
  input(page, 'company', '测试公司')
  input(page, 'position', '工程师')
}

test('salary picker saves and reopens every preset, including separate empty and negotiable choices', () => {
  const values = ['', '面议', '5K以下', '5–10K', '10–15K', '15–20K', '20–30K', '30–50K', '50K以上']
  for (const [index, salary] of values.entries()) {
    const env = environment()
    const page = env.page()
    assert.equal(page.data.salaryIndex, 0)
    ready(page)
    select(page, index)
    assert.equal(page.data.form.salary, salary)
    page.saveApplication()
    assert.equal(env.store.get(page.applicationId).salary, salary)
    env.restart()
    const reopened = env.page({ id: page.applicationId })
    assert.equal(reopened.data.salaryIndex, index)
    assert.equal(reopened.data.salaryCustom, false)
    assert.equal(env.raw().version, 1)
  }
})

test('unmatched historical salaries open as custom without conversion or truncation', () => {
  for (const salary of ['30万/年 · 16薪', '15-20K', '自定义输入', '旧薪资说明'.repeat(12), '  30万/年  ']) {
    const env = environment()
    const record = env.store.create({ company: '原公司', position: '原岗位', salary })
    const data = env.raw()
    data.applications[0].salary = salary
    data.applications[0].extension = { keep: true }
    env.inject(data)
    const page = env.page({ id: record.id })
    assert.equal(page.data.salaryIndex, 9)
    assert.equal(page.data.salaryCustom, true)
    assert.equal(page.data.form.salary, salary)
    assert.equal(page.data.salaryCustomDraft, salary)
    input(page, 'company', '改名公司')
    page.saveApplication()
    assert.equal(env.store.get(record.id).salary, salary)
    assert.deepEqual(env.raw().applications[0].extension, { keep: true })
  }
})

test('custom salary draft survives switching through presets, clearing, collapsing and onShow', () => {
  const env = environment()
  const page = env.page()
  ready(page)
  select(page, 9)
  input(page, 'salary', '年薪 30万 + 奖金')
  select(page, 5)
  assert.equal(page.data.form.salary, '15–20K')
  select(page, 0)
  assert.equal(page.data.form.salary, '')
  select(page, 1)
  assert.equal(page.data.form.salary, '面议')
  page.toggleMore()
  page.toggleMore()
  page.onShow()
  select(page, 9)
  assert.equal(page.data.form.salary, '年薪 30万 + 奖金')
  assert.equal(page.data.salaryCustomDraft, '年薪 30万 + 奖金')
  page.saveApplication()
  assert.equal(env.store.get(page.applicationId).salary, '年薪 30万 + 奖金')
})

test('picker cancellation and invalid indexes leave salary and custom draft untouched', () => {
  const page = environment().page()
  select(page, 9)
  input(page, 'salary', '月薪 18000')
  const before = clone(page.data)
  // No bindcancel means the native picker discards its pending wheel selection.
  const markup = fs.readFileSync(path.join(root, 'pages/edit/edit.wxml'), 'utf8')
  const picker = markup.match(/<picker\b[^>]*bindchange="pickSalary"[^>]*>/)[0]
  const cancel = picker.match(/bindcancel="([^"]+)"/)
  if (cancel) page[cancel[1]]({ detail: {} })
  assert.deepEqual(page.data, before)
  for (const value of [-1, 10, 1.5, 'invalid', '', null]) {
    page.pickSalary({ detail: { value } })
    assert.deepEqual(page.data, before)
  }
})

test('salary saves retain drafts on disk failure and reuse the same record after navigation failure', () => {
  const env = environment()
  const page = env.page()
  ready(page)
  select(page, 9)
  input(page, 'salary', '40万/年')
  env.calls.writeError = true
  page.saveApplication()
  assert.equal(env.calls.writes, 0)
  assert.equal(page.data.saving, false)
  assert.equal(page.data.form.salary, '40万/年')
  assert.equal(page.data.salaryCustomDraft, '40万/年')
  env.calls.writeError = false
  env.calls.navigationError = true
  page.saveApplication()
  assert.equal(page.data.saving, false)
  const id = page.applicationId
  env.calls.navigationError = false
  page.saveApplication()
  page.saveApplication()
  assert.equal(page.applicationId, id)
  assert.equal(env.store.list().length, 1)
  assert.equal(env.store.get(id).salary, '40万/年')
})

test('new-city default initializes once while existing records keep their own city', () => {
  const env = environment()
  const original = env.store.create({ company: '原公司', position: '工程师', city: '上海' })
  env.store.create({ company: '新公司', position: '工程师', city: '杭州' })
  const reads = env.calls.reads
  const page = env.page()
  assert.equal(env.calls.reads - reads, 1)
  assert.equal(page.data.form.city, '杭州')
  input(page, 'city', '')
  page.onShow()
  assert.equal(page.data.form.city, '')
  assert.equal(env.page({ id: original.id }).data.form.city, '上海')
})

test('Next targets only visible input fields and never expands or saves', () => {
  const env = environment()
  const page = env.page()
  next(page, 'position')
  assert.equal(page.data.focusField, 'position')
  next(page, 'city')
  assert.notEqual(page.data.focusField, 'city')
  assert.equal(page.data.expanded, false)
  page.toggleMore()
  next(page, 'city')
  assert.equal(page.data.focusField, 'city')
  next(page, 'salary')
  assert.notEqual(page.data.focusField, 'salary')
  next(page, 'jdLink')
  assert.equal(page.data.focusField, 'jdLink')
  select(page, 9)
  next(page, 'salary')
  assert.equal(page.data.focusField, 'salary')
  next(page, 'note')
  assert.equal(page.data.focusField, 'note')
  assert.equal(env.calls.writes, 0)
})
