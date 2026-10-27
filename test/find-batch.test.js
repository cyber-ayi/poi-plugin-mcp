const assert = require('node:assert/strict')
const vm = require('node:vm')
const { test } = require('node:test')
const { createPoiWebviewRuntime } = require('../lib/poi-webview-runtime')
function node(attributes = {}, children = []) {
  return { visible: true, renderable: true, worldAlpha: 1, interactive: true,
    worldTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    hitArea: { x: 1, y: 1, width: 10, height: 10 }, children, ...attributes }
}
function fixture(root) {
  let calls = 0
  const renderer = { view: { isConnected: true }, _lastObjectRendered: root }
  const frame = { processId: 1, routingId: 2, url: 'https://test.kancolle-server.com/game',
    executeJavaScript(expression) {
      calls++
      return Promise.resolve(vm.runInNewContext(expression, {
        URL, PIXI: { ticker: { shared: { _head: { next: { context: { renderer } } } } } },
      }))
    },
  }
  return { calls: () => calls, renderer, runtime: createPoiWebviewRuntime({
    now: () => new Date(0), getStore: () => ({ ref: { getWebContents: () => ({ mainFrame: frame }) } }),
  }) }
}
const base = { root: 'pixi.last-rendered', projection: 'pixi.interactive', frameId: '1:2' }
const clean = value => JSON.parse(JSON.stringify(value))

test('scoped results retain serial tokens, bounds, filtering and independent budgets in one IPC', async () => {
  const root = node({}, [node({ memSlotItemId: 9 }, [node({ _text: 'item' })]), node({ _show_list: false })])
  const f = fixture(root)
  const scopes = [
    { rootPath: [], maxNodes: 50, maxDepth: 3, selectKeys: ['memSlotItemId', '_text'] },
    { rootPath: ['children', '0'], maxNodes: 50, anyRequiredKeys: ['_text'], selectKeys: ['_text'] },
    { rootPath: ['children', '1'], maxNodes: 10, selectKeys: ['_show_list'] },
  ]
  const serial = await Promise.all(scopes.map(scope => f.runtime.findObjects({ ...base, ...scope })))
  const before = f.calls()
  const batch = await f.runtime.findObjects({ ...base, scopes })
  assert.equal(f.calls() - before, 1)
  assert.equal(batch.schemaVersion, 1)
  assert.equal(batch.frameId, base.frameId)
  assert.deepEqual(clean(batch.results.map(r => r.scene)), clean(serial))
  assert.deepEqual(clean(batch.results.map(r => r.scopeIndex)), [0, 1, 2])
  assert.deepEqual(clean(batch.results.map(r => r.rootPath)), scopes.map(s => s.rootPath))
})

test('each scope keeps hidden-parent pruning and node/match/depth truncation metadata', async () => {
  const f = fixture(node({}, [node({ visible: false }, [node({ memSlotItemId: 9 })]), node({ memSlotItemId: 10 })]))
  const scopes = [
    { rootPath: [], maxNodes: 50, anyRequiredKeys: ['memSlotItemId'], selectKeys: ['memSlotItemId'] },
    { rootPath: [], maxNodes: 1 }, { rootPath: [], maxNodes: 50, maxMatches: 1 },
    { rootPath: [], maxNodes: 50, maxDepth: 0 },
  ]
  const result = await f.runtime.findObjects({ ...base, scopes })
  assert.deepEqual(clean(result.results[0].scene.matches.map(m => m.attributes.memSlotItemId)), [10])
  assert.ok(result.results[0].scene.prunedSubtrees > 0)
  assert.deepEqual(clean(result.results.slice(1).map(r => r.scene.truncatedBy)), ['maxNodes', 'maxMatches', 'maxDepth'])
})

test('no cache survives to the next invocation and root replacement aborts a batch', async () => {
  const root = node({ _text: 'before' })
  const f = fixture(root), request = { ...base, scopes: [{ rootPath: [], selectKeys: ['_text'] }] }
  const before = await f.runtime.findObjects(request)
  root._text = 'after'
  const after = await f.runtime.findObjects(request)
  assert.notEqual(before.results[0].scene.pageToken, after.results[0].scene.pageToken)
  const proxy = new Proxy(root, { getOwnPropertyDescriptor(target, key) {
    f.renderer._lastObjectRendered = node({ _text: 'replacement' })
    return Reflect.getOwnPropertyDescriptor(target, key)
  } })
  f.renderer._lastObjectRendered = proxy
  await assert.rejects(f.runtime.findObjects(request), /root changed/)
})

test('reject invalid paths, fields, keys, per-scope/aggregate budgets before IPC', async () => {
  const f = fixture(node())
  const bad = [
    { scopes: [] }, { scopes: Array(9).fill({ rootPath: [] }) },
    { scopes: [{ rootPath: ['__proto__'] }] }, { scopes: [{ rootPath: ['children', '-1'] }] },
    { scopes: [{ rootPath: [], includeHidden: true }] }, { scopes: [{ rootPath: [], script: 'fetch()' }] },
    { scopes: [{ rootPath: [], selectKeys: ['authorization'] }] }, { scopes: [{ rootPath: [], selectKeys: false }] },
    { scopes: [{ rootPath: [], maxNodes: 50001 }] }, { scopes: [{ rootPath: [], maxMatches: 257 }] },
    { scopes: Array(3).fill({ rootPath: [], maxNodes: 50000 }) }, { root: 'globalThis', scopes: [{ rootPath: [] }] },
    { source: 'webview.find', script: 'fetch()', scopes: [{ rootPath: [] }] },
  ]
  for (const invalid of bad) await assert.rejects(f.runtime.findObjects({ ...base, ...invalid }))
  assert.equal(f.calls(), 0)
})
