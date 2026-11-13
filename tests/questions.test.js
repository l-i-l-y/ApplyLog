const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')

const root = path.resolve(__dirname, '..')
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const tap = key => ({ currentTarget: { dataset: { key } } })
function environment() {
  let stored = ''
  const calls = { reads: 0, writes: 0, urls: [], toasts: [] }
  const listeners = new Set()
  const resizeListeners = new Set()
  const now = new Date(2026, 10, 13, 10).getTime()
  const wx = {
    getStorageSync: () => { calls.reads++; if (calls.readError) throw Error('unavailable'); return clone(stored) },
    setStorageSync: (key, value) => { assert.equal(key, 'applylog-data'); stored = clone(value); calls.writes++ },
    showToast: options => calls.toasts.push(options.title),
    navigateTo: options => calls.urls.push(options.url),
    setTabBarBadge() {}, removeTabBarBadge() {},
    onKeyboardHeightChange: callback => listeners.add(callback),
    offKeyboardHeightChange: callback => listeners.delete(callback),
    onWindowResize: callback => resizeListeners.add(callback),
    offWindowResize: callback => resizeListeners.delete(callback)
  }
  const cache = new Map()
  class Clock extends Date { static now() { return now } }
  function load(file) {
    const absolute = path.resolve(root, file)
    if (cache.has(absolute)) return cache.get(absolute)
    const module = { exports: {} }
    vm.runInNewContext(fs.readFileSync(absolute, 'utf8'), {
      module, exports: module.exports, wx, Date: Clock, console, setTimeout, clearTimeout,
      getCurrentPages: () => [], getApp: () => ({}),
      require: name => load(path.resolve(path.dirname(absolute), name + '.js')),
      Page: definition => { module.exports = definition }
    }, { filename: absolute })
    cache.set(absolute, module.exports)
    return module.exports
  }
  function page(name) {
    const definition = load('pages/' + name + '/' + name + '.js')
    const instance = { ...definition, data: clone(definition.data), setData(changes, done) {
      for (const [key, value] of Object.entries(changes)) this.data[key] = clone(value)
      if (done) done()
    } }
    if (instance.onLoad) instance.onLoad({})
    instance.onShow()
    return instance
  }
  const store = load('utils/store.js')
  return { store, page, calls, listeners, resizeListeners, now,
    raw: () => clone(stored), inject: data => { stored = clone(data) },
    application: (company = '甲公司', position = '前端工程师') => store.create({ company, position }),
    review: (id, questions, fields = {}) => store.addInterview(id, { round: '一面', date: now, selfScore: 4, questions, ...fields }) }
}

test('empty question book derives zero counts without writing storage', () => {
  const env = environment()
  const result = env.store.snapshot().questions()
  assert.deepEqual(clone(result), { items: [], total: 0, reviewCount: 0, matched: 0, hasQuery: false })
  assert.equal(env.calls.reads, 1)
  assert.equal(env.calls.writes, 0)
})

test('collects saved nonblank questions only, preserving duplicates, full text, metadata and original indexes', () => {
  const env = environment()
  const app = env.application()
  env.review(app.id, [], { reflection: '只有心得' })
  const review = env.review(app.id, [{ q: '占位', myAnswer: '' }])
  const raw = env.raw()
  raw.extension = { keep: true }
  raw.applications[0].interviews[1].questions = [
    { q: '  \n ', myAnswer: '历史空题不收录', extra: 'keep' },
    { q: '  很长的问题\n' + '完整'.repeat(200), myAnswer: ' 回答\n' + '细节'.repeat(200), id: 'unknown' },
    { q: '重复问题', myAnswer: '   ' }, { q: '重复问题', myAnswer: '' }
  ]
  env.inject(raw)
  const writes = env.calls.writes
  const result = env.store.snapshot().questions()
  assert.equal(result.total, 3)
  assert.equal(result.reviewCount, 1)
  assert.equal(result.matched, 3)
  assert.deepEqual(clone(result.items.map(item => item.questionIndex)), [1, 2, 3])
  assert.equal(result.items[0].q, raw.applications[0].interviews[1].questions[1].q)
  assert.equal(result.items[0].myAnswer, raw.applications[0].interviews[1].questions[1].myAnswer)
  assert.equal(result.items[0].applicationId, app.id)
  assert.equal(result.items[0].reviewId, review.id)
  assert.equal(new Set(result.items.map(item => item.key)).size, 3)
  assert.equal(env.calls.writes, writes)
  assert.deepEqual(env.raw(), raw)
})

test('sorts by interview day descending then application ID, review ID and original question order', () => {
  const env = environment()
  const first = env.application('A公司')
  const second = env.application('B公司')
  env.review(first.id, [{ q: '旧日期', myAnswer: '' }], { date: env.now - 86400000 })
  env.review(first.id, [{ q: 'A-2', myAnswer: '' }])
  env.review(first.id, [{ q: 'A-1-1', myAnswer: '' }, { q: 'A-1-2', myAnswer: '' }])
  env.review(second.id, [{ q: 'B-1', myAnswer: '' }])
  const raw = env.raw()
  const a = raw.applications.find(item => item.id === first.id)
  const b = raw.applications.find(item => item.id === second.id)
  a.id = 'a'; b.id = 'b'
  a.interviews[0].id = 'old'; a.interviews[1].id = 'z'; a.interviews[2].id = 'a'
  env.inject(raw)
  const expected = ['A-1-1', 'A-1-2', 'A-2', 'B-1', '旧日期']
  assert.deepEqual(clone(env.store.snapshot().questions().items.map(item => item.q)), expected)
  raw.applications.reverse(); a.interviews.reverse(); env.inject(raw)
  assert.deepEqual(clone(env.store.snapshot().questions().items.map(item => item.q)), expected)
})

test('question, company and position search is trimmed and case insensitive with global and matched counts', () => {
  const env = environment()
  const first = env.application('Acme', '前端')
  const second = env.application('第二公司', 'Java Engineer')
  env.review(first.id, [{ q: '闭包如何工作', myAnswer: 'answeronly' }, { q: '请设计缓存', myAnswer: '' }])
  env.review(second.id, [{ q: 'Java GC', myAnswer: '' }])
  const before = env.calls.reads
  const snapshot = env.store.snapshot()
  for (const [query, matched, hasQuery] of [['闭包', 1, true], [' acME ', 2, true], ['ENGINEER', 1, true], ['answeronly', 0, true], ['不存在', 0, true], [' \n ', 3, false]]) {
    const result = snapshot.questions(query)
    assert.equal(result.total, 3)
    assert.equal(result.reviewCount, 2)
    assert.equal(result.matched, matched)
    assert.equal(result.hasQuery, hasQuery)
  }
  assert.equal(env.calls.reads - before, 1)
})

test('mine entry shares its snapshot and refreshes effective question count after editing and demo removal', () => {
  const env = environment()
  const app = env.application()
  const review = env.review(app.id, [{ q: '真实题目', myAnswer: '' }])
  env.store.seedDemo()
  const before = env.calls.reads
  const mine = env.page('mine')
  assert.equal(env.calls.reads - before, 1)
  assert.ok(mine.data.questionCount > 1)
  mine.openQuestions()
  assert.equal(env.calls.urls.at(-1), '/pages/questions/questions')
  env.store.removeDemo(); mine.onShow()
  assert.equal(mine.data.questionCount, 1)
  env.store.updateInterview(app.id, review.id, { questions: [] }); mine.onShow()
  assert.equal(mine.data.questionCount, 0)
})

test('book reads one snapshot on refresh, formats sources and expands long answers', () => {
  const env = environment()
  const app = env.application()
  const answer = '完整回答'.repeat(120)
  env.review(app.id, [{ q: '完整问题'.repeat(120), myAnswer: answer }, { q: '无回答', myAnswer: '' }])
  const before = env.calls.reads
  const page = env.page('questions')
  assert.equal(env.calls.reads - before, 1)
  assert.equal(page.data.total, 2)
  assert.equal(page.data.reviewCount, 1)
  const item = page.data.items[0]
  assert.equal(item.dateLabel, '2026-11-13')
  assert.equal(item.company, '甲公司')
  assert.equal(item.position, '前端工程师')
  assert.equal(item.round, '一面')
  assert.equal(item.expanded, false)
  assert.equal(item.canExpand, true)
  assert.ok(item.answerText.length < answer.length)
  page.toggleAnswer(tap(item.key))
  assert.equal(page.data.items[0].answerText, answer)
  page.toggleAnswer(tap(item.key))
  assert.equal(page.data.items[0].expanded, false)
  assert.equal(page.data.items[1].answerText, '暂未记录回答')
  page.onUnload()
})

test('onShow preserves query, scroll and expansion for unchanged source but resets changed source state', () => {
  const env = environment()
  const app = env.application()
  const answer = '长回答'.repeat(80)
  const review = env.review(app.id, [{ q: '保留题', myAnswer: answer }])
  const page = env.page('questions')
  page.onSearch({ detail: { value: ' 保留 ' } })
  page.toggleAnswer(tap(page.data.items[0].key))
  page.onKeyboardScroll({ detail: { scrollTop: 300 } })
  page.onHide(); page.onShow()
  assert.equal(page.data.query, ' 保留 ')
  assert.equal(page.data.items[0].expanded, true)
  assert.equal(page.data.keyboardScrollTop, 300)
  env.store.updateInterview(app.id, review.id, { questions: [{ q: '保留题改', myAnswer: answer + '已编辑' }] })
  page.onShow()
  assert.equal(page.data.items[0].q, '保留题改')
  assert.equal(page.data.items[0].expanded, false)
  page.clearSearch()
  assert.equal(page.data.query, '')
  assert.equal(page.data.hasQuery, false)
  page.onUnload()
})

test('deleting an earlier identical question never reuses expansion state at the shifted index', () => {
  const env = environment()
  const app = env.application()
  const question = { q: '相同题', myAnswer: '重复回答'.repeat(60) }
  const review = env.review(app.id, [question, question, question])
  const page = env.page('questions')
  page.toggleAnswer(tap(page.data.items[1].key))
  env.store.updateInterview(app.id, review.id, { questions: [question, question] })
  page.onShow()
  assert.equal(page.data.items.length, 2)
  assert.ok(page.data.items.every(item => !item.expanded))
  page.onUnload()
})

test('opening source revalidates against one fresh snapshot and refreshes deleted applications or reviews', () => {
  const env = environment()
  const app = env.application()
  const review = env.review(app.id, [{ q: '题', myAnswer: '' }])
  const page = env.page('questions')
  const item = page.data.items[0]
  let before = env.calls.reads
  page.openReview(tap(item.key))
  assert.equal(env.calls.reads - before, 1)
  assert.equal(env.calls.urls.at(-1), '/pages/interview/interview?id=' + encodeURIComponent(app.id) + '&review=' + encodeURIComponent(review.id))
  page.onHide(); page.onShow()
  const raw = env.raw()
  raw.applications[0].interviews = []; env.inject(raw)
  before = env.calls.reads
  page.openReview(tap(item.key))
  assert.equal(env.calls.reads - before, 1)
  assert.equal(env.calls.urls.length, 1)
  assert.equal(page.data.total, 0)
  assert.match(env.calls.toasts.at(-1), /不存在/)
  env.review(app.id, [{ q: '再添加', myAnswer: '' }]); page.onShow()
  env.store.remove(app.id)
  page.openReview(tap(page.data.items[0].key))
  assert.equal(env.calls.urls.length, 1)
  assert.equal(page.data.items.length, 0)
  page.onUnload()
})

test('demo rows are marked and vanish on return after removing examples', () => {
  const env = environment()
  env.store.seedDemo()
  const page = env.page('questions')
  assert.ok(page.data.total > 0)
  assert.ok(page.data.items.every(item => item.demo))
  env.store.removeDemo(); page.onShow()
  assert.equal(page.data.total, 0)
  assert.equal(page.data.reviewCount, 0)
  page.onUnload()
})

test('read failures show a separate error, preserve query, block stale navigation and recover on retry', () => {
  const env = environment()
  const app = env.application()
  env.review(app.id, [{ q: '题', myAnswer: '' }])
  const page = env.page('questions')
  page.onSearch({ detail: { value: '题' } })
  const key = page.data.items[0].key
  env.calls.readError = true
  page.openReview(tap(key))
  assert.equal(env.calls.urls.length, 0)
  assert.match(page.data.error, /读取/)
  assert.equal(page.data.loading, false)
  assert.equal(page.data.query, '题')
  env.calls.readError = false
  page.loadQuestions()
  assert.equal(page.data.error, '')
  assert.equal(page.data.matched, 1)
  page.onSearch({ detail: { value: '未匹配' } })
  assert.equal(page.data.total, 1)
  assert.equal(page.data.matched, 0)
  assert.equal(page.data.error, '')
  page.onUnload()
})

test('book search uses shared keyboard lifecycle, releases inset and rejects late events without losing query', () => {
  const env = environment()
  const page = env.page('questions')
  const event = { currentTarget: { dataset: { anchor: 'questions-search' } }, detail: { height: 300 } }
  page.onSearch({ detail: { value: '输入保留' } })
  page.onKeyboardFocus(event)
  assert.equal(page.data.keyboardInset, 300)
  assert.equal(env.listeners.size, 1)
  assert.equal(env.resizeListeners.size, 1)
  const stale = [...env.listeners][0]
  page.onHide()
  assert.equal(env.listeners.size, 0)
  assert.equal(env.resizeListeners.size, 0)
  stale({ height: 350 }); page.onFieldKeyboardHeight(event)
  assert.equal(page.data.keyboardInset, 0)
  page.onShow()
  assert.equal(page.data.query, '输入保留')
  page.onKeyboardFocus(event)
  page.onFieldKeyboardHeight({ ...event, detail: { height: 0 } })
  assert.equal(page.data.keyboardInset, 0)
  assert.equal(page.keyboardAnchor, '')
  page.onUnload()
  assert.equal(env.listeners.size, 0)
})

test('typing leaves a visible search field stationary, corrects clipping only and ignores measurements after manual scrolling', () => {
  const env = environment()
  const page = env.page('questions')
  const scrollChanges = []
  const setData = page.setData
  page.setData = function (changes, done) {
    if (Object.hasOwn(changes, 'keyboardScrollTop')) scrollChanges.push(changes.keyboardScrollTop)
    setData.call(this, changes, done)
  }
  let field = { top: 80, bottom: 124 }
  let queued
  let delay = false
  page.createSelectorQuery = () => {
    const query = { select() { return query }, boundingClientRect() { return query }, scrollOffset() { return query },
      exec(done) {
        const results = [{ top: 60, bottom: 300, height: 240 }, field, { scrollTop: 64 }]
        if (delay) queued = () => done(results)
        else done(results)
      } }
    return query
  }
  page.onKeyboardFocus({ currentTarget: { dataset: { anchor: 'questions-search' } }, detail: { height: 300 } })
  for (const value of ['工', '工程', '工程师']) page.onSearch({ detail: { value } })
  assert.deepEqual(scrollChanges, [])
  field = { top: 296, bottom: 340 }
  page.onSearch({ detail: { value: '工程师 ' } })
  assert.deepEqual(scrollChanges, [64, 116])
  delay = true
  page.onSearch({ detail: { value: '工程师 上海' } })
  page.onKeyboardTouchStart()
  page.onKeyboardScroll({ detail: { scrollTop: 150 } })
  queued()
  assert.deepEqual(scrollChanges, [64, 116])
  assert.equal(page.keyboardActualScrollTop, 150)
  assert.equal(page.data.query, '工程师 上海')
  page.onUnload()
})

test('mixed line endings and blank lines render as separate rows while expanding preserves source text', () => {
  const env = environment()
  const app = env.application()
  env.review(app.id, [{ q: '占位', myAnswer: '' }])
  const raw = env.raw()
  const q = '首行\r\n\r中行\n末行\r'
  const myAnswer = '答一\r\n\r答三\n答四\r答五\r\n'
  raw.applications[0].interviews[0].questions[0] = { q, myAnswer }
  env.inject(raw)
  const page = env.page('questions')
  const item = page.data.items[0]
  assert.deepEqual(item.questionLines.map(line => line.text), ['首行', '', '中行', '末行', ''])
  assert.equal(new Set(item.questionLines.map(line => line.key)).size, 5)
  assert.deepEqual(item.answerLines.map(line => line.text), ['答一', '', '答三', '答四…'])
  assert.equal(item.canExpand, true)
  page.toggleAnswer(tap(item.key))
  assert.deepEqual(page.data.items[0].answerLines.map(line => line.text), ['答一', '', '答三', '答四', '答五', ''])
  assert.equal(page.data.items[0].answerText, myAnswer)
  page.toggleAnswer(tap(item.key))
  assert.deepEqual(page.data.items[0].answerLines.map(line => line.text), ['答一', '', '答三', '答四…'])
  assert.deepEqual(env.raw(), raw)
  page.onUnload()
})

test('a short CRLF answer preserves its exact string without a spurious expand control', () => {
  const env = environment()
  const app = env.application()
  env.review(app.id, [{ q: '问题', myAnswer: '首行\r\n次行' }])
  const page = env.page('questions')
  assert.equal(page.data.items[0].answerText, '首行\r\n次行')
  assert.deepEqual(page.data.items[0].answerLines.map(line => line.text), ['首行', '次行'])
  assert.equal(page.data.items[0].canExpand, false)
  page.onUnload()
})
