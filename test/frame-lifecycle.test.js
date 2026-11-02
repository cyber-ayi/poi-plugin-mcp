const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createPoiWebviewRuntime } = require('../lib/poi-webview-runtime')

const disposed = () => new Error('Render frame was disposed before WebFrameMain could be accessed')
const game = (routingId = 2) => ({ processId: 1, routingId,
  url: 'https://test.kancolle-server.com/game', name: 'game', isDestroyed: () => false })

function fixture(mainFrame) {
  let resolves = 0
  const webContents = { mainFrame }
  const runtime = createPoiWebviewRuntime({
    getStore: () => ({ ref: { getWebContentsId: () => 7 } }),
    resolveWebContents: () => { resolves++; return webContents },
  })
  return { runtime, webContents, resolves: () => resolves }
}

test('disposed siblings do not hide the live game frame or execute inspection', async () => {
  const main = { ...game(0), url: 'https://www.dmm.com/' }
  const live = game()
  let executions = 0
  live.executeJavaScript = () => { executions++; return Promise.resolve({}) }
  const dead = { isDestroyed: () => true }
  Object.defineProperty(dead, 'url', { get() { throw Error('must not read dead frame') } })
  main.framesInSubtree = [main, dead, live]
  const f = fixture(main)
  assert.deepEqual(await f.runtime.listFrames(), [{ id: '1:2', name: 'game',
    url: 'https://test.kancolle-server.com/game' }])
  await assert.rejects(f.runtime.readStorage({ frameId: '1:9' }), /Unknown WebView frame/)
  await assert.rejects(f.runtime.readStorage({}), /frameId is required/)
  assert.equal(executions, 0)
})

test('disposal during each metadata getter skips only that candidate', async () => {
  for (const key of ['processId', 'routingId', 'name', 'url', 'isDestroyed']) {
    const dead = game(9)
    Object.defineProperty(dead, key, { get() { throw disposed() } })
    const live = game()
    live.framesInSubtree = [dead, live]
    assert.deepEqual((await fixture(live).runtime.listFrames()).map(f => f.id), ['1:2'])
  }
  const racing = game(9)
  let checks = 0
  racing.isDestroyed = () => ++checks > 1
  const live = game()
  live.framesInSubtree = [live, racing]
  assert.deepEqual((await fixture(live).runtime.listFrames()).map(f => f.id), ['1:2'])
})

test('a replaced main frame is reacquired while the WebContents proxy stays cached', async () => {
  const old = game()
  old.isDestroyed = () => true
  const f = fixture(old)
  assert.deepEqual(await f.runtime.listFrames(), [])
  const replacement = game(3)
  f.webContents.mainFrame = replacement
  assert.deepEqual((await f.runtime.listFrames()).map(f => f.id), ['1:3'])
  assert.equal(f.resolves(), 1)
  await assert.rejects(f.runtime.readStorage({ frameId: '1:2' }), /Unknown WebView frame/)
})

test('disposed main-frame/tree getters fail closed and recover on the next request', async () => {
  for (const key of ['mainFrame', 'framesInSubtree']) {
    const main = game()
    const f = fixture(main)
    const target = key === 'mainFrame' ? f.webContents : main
    Object.defineProperty(target, key, { configurable: true, get() { throw disposed() } })
    assert.deepEqual(await f.runtime.listFrames(), [])
    await assert.rejects(f.runtime.readStorage({ frameId: '1:2' }), /game frame is not ready/)
    delete target[key]
    if (key === 'mainFrame') target.mainFrame = main
    assert.deepEqual((await f.runtime.listFrames()).map(f => f.id), ['1:2'])
    assert.equal(f.resolves(), 1)
  }
})

test('unrelated enumeration errors remain visible', async () => {
  for (const key of ['mainFrame', 'framesInSubtree', 'url']) {
    const main = game()
    const f = fixture(main)
    const target = key === 'mainFrame' ? f.webContents : main
    Object.defineProperty(target, key, { get() { throw Error('unrelated failure') } })
    await assert.rejects(f.runtime.listFrames(), /unrelated failure/)
  }
})
