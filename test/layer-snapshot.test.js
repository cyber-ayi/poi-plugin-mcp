const assert = require('node:assert/strict')
const vm = require('node:vm')
const { test } = require('node:test')
const { createPoiWebviewRuntime } = require('../lib/poi-webview-runtime')
const { createPoiDataQuery } = require('../lib/poi-data-query')

function fixture(children) {
  const root = { children }
  let executions = 0
  const frame = {
    processId: 1, routingId: 2, url: 'https://test.kancolle-server.com/game',
    executeJavaScript(expression) {
      executions++
      return Promise.resolve(vm.runInNewContext(expression, {
        PIXI: { ticker: { shared: { _head: { next: { context: {
          renderer: { view: { isConnected: true }, _lastObjectRendered: root },
        } } } } } },
      }))
    },
  }
  const runtime = createPoiWebviewRuntime({ getStore: () => ({ ref: {
    getWebContents: () => ({ mainFrame: frame }),
  } }) })
  return { runtime, executions: () => executions }
}
const layer = (visible = true) => ({ visible, renderable: true, worldAlpha: 1 })
const request = { source: 'webview.layers', root: 'pixi.last-rendered', rootPath: [], frameId: '1:2' }

test('one bounded inspection includes hidden layers without serializing display objects', async () => {
  const children = [layer(), layer(false), layer()]
  Object.defineProperty(children[0], 'unrelated', { get() { throw Error('must not read object graph') } })
  const f = fixture(children)
  const query = createPoiDataQuery({ runtime: f.runtime })
  const result = (await query.query(request)).value
  assert.equal(f.executions(), 1)
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { available: true, schemaVersion: 1, frameId: '1:2', count: 3,
    layers: [layer(), layer(false), layer()] })
  assert.ok((await query.query({ source: 'capabilities' })).value.sources.includes('webview.layers'))
})

test('missing/accessor flags, holes, nonfinite alpha and excess siblings fail closed', async () => {
  const accessor = layer(); Object.defineProperty(accessor, 'visible', { get() { throw Error('invoked accessor') } })
  const missing = layer(); delete missing.renderable
  const badAlpha = { ...layer(), worldAlpha: NaN }
  for (const children of [[accessor, layer(), layer()], [missing, layer(), layer()],
    [badAlpha, layer(), layer()], [layer(), , layer()], Array.from({ length: 17 }, () => layer())]) {
    await assert.rejects(fixture(children).runtime.readLayers(request), /layer_/)
  }
})

test('root/path/frame cannot escape bounded own children traversal', async () => {
  for (const invalid of [{ root: 'globalThis' }, { rootPath: ['__proto__'] },
    { rootPath: ['children', 'constructor'] }, { rootPath: ['children', '-1'] },
    { rootPath: Array(34).fill('children') }, { frameId: 'other' }]) {
    const f = fixture([layer(), layer(), layer()])
    await assert.rejects(f.runtime.readLayers({ ...request, ...invalid }))
    assert.equal(f.executions(), 0)
  }
})


test('a changing stack and accessor children fail without returning a partial snapshot', async () => {
  const children = [layer(), layer(), layer()]
  let reads = 0
  const changing = new Proxy(children, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'length' && ++reads === 2) target.push(layer())
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
  })
  await assert.rejects(fixture(changing).runtime.readLayers(request), /layer_stack_changed/)
  const child = layer()
  Object.defineProperty(child, 'children', { get() { throw Error('accessor invoked') } })
  await assert.rejects(fixture([child, layer(), layer()]).runtime.readLayers({
    ...request, rootPath: ['children', '0'],
  }), /layer_missing_or_accessor/)
})
