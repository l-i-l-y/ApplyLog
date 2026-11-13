const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { keyboardPage, keyboardData, keyboardInset, scrollDelta } = require('../utils/keyboard')

const event = (anchor, height) => ({ currentTarget: { dataset: { anchor } }, detail: { height } })
function page(info = { windowHeight: 568, screenHeight: 568, screenTop: 0 }) {
  const listeners = new Set()
  global.wx = {
    getWindowInfo: () => info,
    onKeyboardHeightChange: fn => listeners.add(fn), offKeyboardHeightChange: fn => listeners.delete(fn)
  }
  const p = { ...keyboardPage, data: { ...keyboardData }, setData(patch, done) {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let target = this.data
      for (const part of parts.slice(0, -1)) target = target[part]
      target[parts.at(-1)] = value
    }
    if (done) done()
  } }
  p.startKeyboard()
  return { p, listeners }
}

function geometryQueries(shellResult, fieldResult) {
  return () => {
    const selectors = []
    const query = {
      select(selector) { selectors.push(selector); return query },
      boundingClientRect() { return query }, scrollOffset() { return query },
      exec(done) {
        if (selectors.length === 1 && selectors[0] === '.page-shell') shellResult(done)
        else fieldResult(done)
      }
    }
    return query
  }
}

test('keyboard inset uses px, subtracts resized viewport and bottom tab area once', () => {
  assert.equal(keyboardInset(250, 568, 568, 0), 250)
  assert.equal(keyboardInset(250, 568, 318, 0), 0)
  assert.equal(keyboardInset(250, 514, 514, 54), 196)
  assert.equal(keyboardInset(0, 568, 568, 0), 0)
})

test('scroll only corrects clipping with a 12px gap, never recenters an already visible field', () => {
  const viewport = { top: 64, bottom: 300 }
  assert.equal(scrollDelta({ top: 100, bottom: 170 }, viewport), 0)
  assert.equal(scrollDelta({ top: 260, bottom: 320 }, viewport), 32)
  assert.equal(scrollDelta({ top: 50, bottom: 110 }, viewport), -26)
})

test('rapid focus switch ignores late blur/height and height zero clears stale focus', async () => {
  const { p, listeners } = page()
  p.onKeyboardFocus(event('first', 230))
  p.onKeyboardFocus(event('second', 280))
  p.onKeyboardBlur(event('first'))
  p.onFieldKeyboardHeight(event('first', 0))
  assert.equal(p.data.keyboardHeight, 280)
  assert.equal(p.keyboardAnchor, 'second')
  p.onFieldKeyboardHeight(event('second', 300))
  assert.equal(p.data.keyboardHeight, 300)
  Array.from(listeners)[0]({ height: 0 })
  assert.equal(p.data.keyboardHeight, 0)
  assert.equal(p.keyboardAnchor, '')
  p.onFieldKeyboardHeight(event('second', 300))
  assert.equal(p.data.keyboardHeight, 0)
  p.stopKeyboard()
})

test('blur fallback, form removal and leaving dispose state/listeners without late work', async () => {
  const { p, listeners } = page()
  p.onKeyboardFocus(event('reminder-note', 230))
  p.onKeyboardBlur(event('reminder-note'))
  p.onKeyboardFocus(event('review-answer-2', 230))
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.equal(p.keyboardAnchor, 'review-answer-2')
  p.releaseKeyboard('review-question-1')
  assert.equal(p.data.keyboardHeight, 230)
  p.releaseKeyboard('review-answer-2')
  assert.equal(p.data.keyboardHeight, 0)
  p.onKeyboardFocus(event('note', 230))
  p.onKeyboardBlur(event('note'))
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.equal(p.data.keyboardHeight, 0)
  p.stopKeyboard()
  assert.equal(listeners.size, 0)
  p.onKeyboardFocus(event('late', 230))
  assert.equal(p.data.keyboardHeight, 0)
  p.startKeyboard(); p.startKeyboard()
  assert.equal(listeners.size, 1)
  p.stopKeyboard()
})

test('resize before the first positive keyboard height retains the unoccluded baseline', () => {
  const { p } = page()
  try {
    p.onKeyboardFocus(event('review-reflection', 0))
    // Some native runtimes resize the window before reporting keyboard height.
    wx.getWindowInfo = () => ({ windowHeight: 318, screenHeight: 568, screenTop: 0 })
    p.keyboardResizeListener()
    p.onFieldKeyboardHeight(event('review-reflection', 250))
    assert.equal(p.data.keyboardInset, 0)
  } finally {
    p.stopKeyboard()
  }
})

test('a pending geometry result cannot scroll after the keyboard closes or the user drags', () => {
  for (const interrupt of [p => p.releaseKeyboard(), p => p.onKeyboardTouchStart(), p => p.stopKeyboard()]) {
    const { p } = page()
    try {
      const pending = []
      p.createSelectorQuery = geometryQueries(done => done([{ bottom: 568 }]), done => pending.push(done))
      p.data.keyboardInputMaxHeight = 276
      p.onKeyboardFocus(event('review-reflection', 250))
      assert.equal(pending.length, 1)
      interrupt(p)
      pending[0]([{ top: 0, bottom: 300, height: 300 }, { top: 280, bottom: 340 }, { scrollTop: 40 }])
      assert.equal(p.data.keyboardScrollTop, 0)
    } finally {
      p.stopKeyboard()
    }
  }
})

test('removing an earlier review question keeps the remaining focused field visible', () => {
  const filename = path.resolve(__dirname, '../pages/interview/interview.js')
  let definition
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: createRequire(filename), Page: value => { definition = value }
  }, { filename })
  const { p } = page()
  try {
    Object.assign(p, definition)
    p.data = {
      ...keyboardData, keyboardScrollTop: 200, keyboardInputMaxHeight: 276,
      form: { questions: [{ key: 1, q: 'earlier', myAnswer: '' }, { key: 2, q: 'focused', myAnswer: 'draft' }] },
      errors: { questionIndex: -1 }
    }
    p.createSelectorQuery = geometryQueries(done => done([{ bottom: 568 }]), done => {
      const top = p.data.form.questions.length === 2 ? 100 : -100
      done([{ top: 0, bottom: 300, height: 300 }, { top, bottom: top + 60 }, { scrollTop: 200 }])
    })
    p.onKeyboardFocus(event('review-answer-2', 250))
    p.onKeyboardTouchStart()
    p.removeQuestion({ currentTarget: { dataset: { index: 0 } } })
    assert.equal(p.keyboardAnchor, 'review-answer-2')
    assert.equal(p.data.form.questions[0].myAnswer, 'draft')
    assert.equal(p.data.keyboardScrollTop, 88)
  } finally {
    p.stopKeyboard()
  }
})

test('Skyline shell geometry accounts for the actual tab area instead of screenTop', () => {
  for (const { bottom, want } of [
    { bottom: 844, want: 300 },
    { bottom: 762, want: 218 },
    { bottom: 544, want: 0 },
    { bottom: 500, want: 0 }
  ]) {
    // The editor and list report the same window info but have different shell bottoms.
    const { p } = page({ screenHeight: 844, screenTop: 82, windowHeight: 762 })
    try {
      p.createSelectorQuery = geometryQueries(done => done([{ bottom }]), done => done([null, null, null]))
      p.onKeyboardFocus(event('field', 300))
      assert.equal(p.data.keyboardInset, want, 'shell bottom ' + bottom)
    } finally {
      p.stopKeyboard()
    }
  }
})

test('a late shell measurement cannot restore keyboard spacing after closing or leaving', () => {
  for (const interrupt of [p => p.releaseKeyboard(), p => p.stopKeyboard()]) {
    const { p } = page({ screenHeight: 844, screenTop: 82, windowHeight: 762 })
    try {
      const pending = []
      p.createSelectorQuery = geometryQueries(done => pending.push(done), done => done([null, null, null]))
      p.onKeyboardFocus(event('field', 300))
      assert.equal(pending.length, 1)
      interrupt(p)
      pending[0]([{ bottom: 762 }])
      assert.equal(p.data.keyboardHeight, 0)
      assert.equal(p.data.keyboardInset, 0)
    } finally {
      p.stopKeyboard()
    }
  }
})

test('touching the scroll area during shell measurement cancels positioning but still reserves keyboard space', () => {
  const { p } = page({ screenHeight: 844, screenTop: 82, windowHeight: 762 })
  try {
    const pending = []
    p.createSelectorQuery = geometryQueries(done => pending.push(done), done => done([null, null, null]))
    p.onKeyboardFocus(event('field', 300))
    p.onKeyboardTouchStart()
    pending[0]([{ bottom: 762 }])
    assert.equal(p.data.keyboardHeight, 300)
    assert.equal(p.data.keyboardInset, 218)
    assert.equal(p.data.keyboardScrollTop, 0)
  } finally {
    p.stopKeyboard()
  }
})

test('the latest keyboard height wins when shell measurements complete out of order', () => {
  const { p } = page({ screenHeight: 844, screenTop: 82, windowHeight: 762 })
  try {
    const pending = []
    p.createSelectorQuery = geometryQueries(done => pending.push(done), done => done([null, null, null]))
    p.onKeyboardFocus(event('field', 300))
    p.onFieldKeyboardHeight(event('field', 250))
    pending[1]([{ bottom: 762 }])
    pending[0]([{ bottom: 762 }])
    assert.equal(p.data.keyboardHeight, 250)
    assert.equal(p.data.keyboardInset, 168)
  } finally {
    p.stopKeyboard()
  }
})
