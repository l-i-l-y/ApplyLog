const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')

const root = path.resolve(__dirname, '..')
const clone = value => JSON.parse(JSON.stringify(value))

function environment() {
  let stored = ''
  const calls = { reads: 0, writes: 0, writeError: false }
  const wx = {
    getStorageSync(key) {
      assert.equal(key, 'applylog-data')
      calls.reads += 1
      return clone(stored)
    },
    setStorageSync(key, value) {
      assert.equal(key, 'applylog-data')
      if (calls.writeError) throw new Error('disk full')
      stored = clone(value)
      calls.writes += 1
    }
  }
  const now = new Date(2026, 10, 13, 10).getTime()
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  const cache = new Map()
  function load(filename) {
    const absolute = path.resolve(root, filename)
    if (cache.has(absolute)) return cache.get(absolute)
    const module = { exports: {} }
    vm.runInNewContext(fs.readFileSync(absolute, 'utf8'), {
      module, exports: module.exports, wx, Date: Clock,
      require: name => load(path.resolve(path.dirname(absolute), name + '.js'))
    }, { filename: absolute })
    cache.set(absolute, module.exports)
    return module.exports
  }
  return {
    store: load('utils/store.js'), calls, now,
    raw: () => clone(stored), inject: value => { stored = clone(value) },
    restart: () => { cache.clear(); return load('utils/store.js') }
  }
}

const create = (env, fields = {}) => env.store.create({ company: '测试公司', position: '工程师', ...fields })

test('creation persists the trimmed city with its record and channel in one version-1 write', () => {
  const env = environment()
  env.inject({ version: 1, applications: [], extension: { keep: true } })
  const record = create(env, { city: '  上海 \n', channel: '内推' })
  assert.equal(env.calls.writes, 1)
  assert.equal(record.city, '上海')
  assert.equal(env.raw().lastUsedCity, '上海')
  assert.equal(env.raw().lastUsedChannel, '内推')
  assert.deepEqual(env.raw().extension, { keep: true })
  assert.equal(env.raw().version, 1)
  const store = env.restart()
  const reads = env.calls.reads
  const snapshot = store.snapshot()
  assert.equal(snapshot.lastCity(), '上海')
  assert.equal(snapshot.lastChannel(), '内推')
  assert.equal(env.calls.reads - reads, 1)
  env.store.remove(record.id)
  assert.equal(env.restart().snapshot().lastCity(), '上海')
})

test('an explicitly cleared city survives restart and later edits without falling back', () => {
  const env = environment()
  const previous = create(env, { city: '杭州' })
  const latest = create(env, { city: ' \t ' })
  assert.equal(env.raw().lastUsedCity, '')
  assert.equal(env.restart().snapshot().lastCity(), '')
  env.store.update(latest.id, { city: '深圳' })
  env.store.update(previous.id, { city: '北京' })
  assert.equal(env.restart().snapshot().lastCity(), '')
})

test('legacy city fallback uses the latest created real record and keeps unknown metadata', () => {
  const env = environment()
  const earlier = create(env, { city: '北京' })
  const latest = create(env, { city: '上海' })
  env.store.seedDemo()
  const data = env.raw()
  delete data.lastUsedCity
  data.extension = { nested: ['keep'] }
  data.applications.find(record => record.id === earlier.id).createdAt = env.now - 2000
  data.applications.find(record => record.id === earlier.id).updatedAt = env.now + 1000
  data.applications.find(record => record.id === latest.id).createdAt = env.now - 1000
  data.applications.find(record => record.id === latest.id).city = ' 上海 '
  data.applications.reverse()
  env.inject(data)
  assert.equal(env.restart().snapshot().lastCity(), '上海')
  assert.equal(Object.hasOwn(env.raw(), 'lastUsedCity'), false)
  env.store.update(latest.id, { city: '广州' })
  assert.equal(env.store.get(latest.id).city, '广州')
  assert.equal(env.restart().snapshot().lastCity(), '上海')
  assert.deepEqual(env.raw().extension, { nested: ['keep'] })
})

test('legacy fallback accepts a missing city on the latest record as empty', () => {
  const env = environment()
  const earlier = create(env, { city: '北京' })
  const latest = create(env, { city: '上海' })
  const data = env.raw()
  delete data.lastUsedCity
  delete data.applications.find(record => record.id === latest.id).city
  data.applications.find(record => record.id === earlier.id).createdAt = env.now - 1
  env.inject(data)
  assert.equal(env.restart().snapshot().lastCity(), '')
})

test('demo creation, editing and removal leave the city preference intact', () => {
  const env = environment()
  assert.equal(env.store.snapshot().lastCity(), '')
  env.store.seedDemo()
  assert.equal(env.store.snapshot().lastCity(), '')
  env.store.update('demo-cloud', { city: '苏州' })
  assert.equal(env.store.snapshot().lastCity(), '')
  env.store.removeDemo()
  const real = create(env, { city: '杭州' })
  env.store.seedDemo()
  env.store.update('demo-cloud', { city: '南京' })
  env.store.update(real.id, { city: '宁波' })
  env.store.removeDemo()
  assert.equal(env.restart().snapshot().lastCity(), '杭州')
  assert.equal(env.store.list().length, 1)
})

test('clear removes explicit and legacy city preferences while retaining unrelated metadata', () => {
  for (const legacy of [false, true]) {
    const env = environment()
    create(env, { city: '上海', channel: '内推' })
    const data = env.raw()
    if (legacy) delete data.lastUsedCity
    data.extension = { keep: true }
    env.inject(data)
    env.store.clear()
    const cleared = env.raw()
    assert.equal(Object.hasOwn(cleared, 'lastUsedCity'), false)
    assert.equal(Object.hasOwn(cleared, 'lastUsedChannel'), false)
    assert.deepEqual(cleared.applications, [])
    assert.deepEqual(cleared.extension, { keep: true })
    assert.equal(env.restart().snapshot().lastCity(), '')
  }
})

test('validation and storage failures leave both the city preference and saved records unchanged', () => {
  const env = environment()
  const original = create(env, { city: '上海' })
  const previous = env.raw()
  assert.throws(() => create(env, { company: '', city: '杭州' }), /公司名称/)
  assert.deepEqual(env.raw(), previous)
  env.calls.writeError = true
  assert.throws(() => create(env, { city: '杭州' }), /保存失败/)
  assert.throws(() => env.store.update(original.id, { city: '北京' }), /保存失败/)
  assert.throws(() => env.store.clear(), /保存失败/)
  assert.deepEqual(env.raw(), previous)
  assert.equal(env.restart().snapshot().lastCity(), '上海')
  env.calls.writeError = false
  create(env, { city: '杭州' })
  assert.equal(env.restart().snapshot().lastCity(), '杭州')
})

test('editing another field preserves an untouched legacy salary verbatim and cleans new input', () => {
  const env = environment()
  const record = create(env)
  const data = env.raw()
  data.applications[0].salary = '  面议 / 年包  \n'
  env.inject(data)
  env.store.update(record.id, { city: '上海', salary: '  面议 / 年包  \n' })
  assert.equal(env.store.get(record.id).salary, '  面议 / 年包  \n')
  env.store.update(record.id, { note: '只改备注' })
  assert.equal(env.store.get(record.id).salary, '  面议 / 年包  \n')
  env.store.update(record.id, { salary: '  20k–30k \n' })
  assert.equal(env.store.get(record.id).salary, '20k–30k')
})
