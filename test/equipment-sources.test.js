const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createPoiTelemetry } = require('../lib/poi-telemetry')
const SELECT = '/kcsapi/api_req_kaisou/slot_select'
const UNSET = '/kcsapi/api_get_member/unsetslot'
const make = () => createPoiTelemetry({ now: () => new Date('2026-10-26T12:00:00Z') })
const selection = (ids = [11, 12], extra = {}) => ({ path: SELECT, apiResult: 1,
  postBody: { api_id: '101', api_slot_idx: '0', api_token: 'secret' },
  body: { api_slotitem: ids.map(api_id => ({ api_id })) }, ...extra })
const emit = (t, detail) => t.handleGameResponse({ detail })

test('candidate refs correlate distinct streams with different generations and protect stored data', () => {
  const t = make(); emit(t, { path: '/kcsapi/unknown', apiResult: 0, body: {} }); emit(t, selection())
  const s = t.getEquipmentSelection(), a = t.getActionEvents({}), r = t.getApiResponses({})
  assert.equal(s.complete, true)
  assert.deepEqual(s.source.actionEvent, { sessionId: a.sessionId, generation: 1 })
  assert.deepEqual(s.source.apiResponse, { sessionId: r.sessionId, generation: 2 })
  assert.notEqual(a.sessionId, r.sessionId)
  assert.deepEqual(s.postBody, { api_id: 101, api_slot_idx: 0 })
  assert.equal(s.order, 'response_order_not_ui_order')
  assert.equal(JSON.stringify(s).includes('secret'), false)
  s.equipmentIds.push(999); s.source.actionEvent.generation = 100
  assert.deepEqual(t.getEquipmentSelection().equipmentIds, [11, 12])
  assert.equal(t.getEquipmentSelection().source.actionEvent.generation, 1)
})
for (const [name, extra] of [
  ['duplicate IDs', { body: { api_slotitem: [{ api_id: 11 }, { api_id: 11 }] } }],
  ['bad ID', { body: { api_slotitem: [{ api_id: 'bad' }] } }],
  ['boolean ID', { body: { api_slotitem: [{ api_id: true }] } }],
  ['unsafe integer', { body: { api_slotitem: [{ api_id: Number.MAX_SAFE_INTEGER + 1 }] } }],
  ['missing list', { body: {} }],
  ['sparse list', { body: { api_slotitem: Array(1) } }],
  ['invalid wrapper', { body: { api_data: [], api_slotitem: [{ api_id: 99 }] } }],
  ['bad target', { postBody: { api_id: 102, api_slot_idx: 6 } }],
  ['failed response', { apiResult: 0 }],
  ['oversize response', { body: { api_slotitem: Array.from({ length: 10001 }, (_, i) => ({ api_id: i + 1 })) } }],
]) test(`selection ${name} invalidates previous target`, () => {
  const t = make(); emit(t, selection()); emit(t, selection([13], extra))
  const s = t.getEquipmentSelection()
  assert.equal(s.available, false); assert.equal(s.complete, false); assert.equal(s.generation, 2)
  assert.equal(s.equipmentIds, undefined); assert.equal(s.postBody, undefined)
  assert.equal(s.reason, 'invalid_or_unsuccessful_response')
})
test('empty successful selection is complete and new target replaces it', () => {
  const t = make(); emit(t, selection([])); assert.equal(t.getEquipmentSelection().count, 0)
  assert.equal(t.getEquipmentSelection().complete, true)
  emit(t, selection([14], { postBody: { api_id: 102, api_slot_idx: 1 } }))
  assert.deepEqual(t.getEquipmentSelection().equipmentIds, [14])
  assert.equal(t.getEquipmentSelection().postBody.api_id, 102)
})
test('unwrapped success follows action-event convention', () => {
  const t = make(), d = selection(); delete d.apiResult; emit(t, d)
  assert.equal(t.getEquipmentSelection().available, true)
})
for (const path of ['/kcsapi/api_req_kaisou/slotset', '/kcsapi/api_port/port',
  '/kcsapi/api_start2/getData', '/kcsapi/unrecognized']) {
  test(`subsequent response invalidates selection: ${path}`, () => {
    const t = make(); emit(t, selection()); const before = t.getEquipmentSelection()
    assert.deepEqual(t.getEquipmentSelection(), before)
    emit(t, { path, apiResult: 0, body: {} })
    assert.equal(t.getEquipmentSelection().available, false)
    assert.equal(t.getEquipmentSelection().invalidatedBy.path, path)
  })
}
for (const data of [
  { api_slottype1: { 1: Array(1) } },
  { api_slottype1: { 1: [21, 'bad', 22] } }, { api_slottype1: { 1: [21], 2: [21] } },
  { api_slottype1: { 1: [21] }, api_slottype2: [] }, { api_slottype1: { bad: [21] } },
]) test('unsetslot rejects entire malformed or duplicate response', () => {
  const t = make(); emit(t, { path: UNSET, apiResult: 1, body: data })
  assert.equal(t.getUnsetSlot().available, false); assert.equal(t.getUnsetSlot().equipmentIds, undefined)
})
test('unsetslot preserves groups and invalidates on next selection', () => {
  const t = make(), body = { api_slottype1: { 1: [21, 22], 2: [] } }
  emit(t, { path: UNSET, apiResult: 1, body }); const s = t.getUnsetSlot()
  assert.deepEqual(s.bySlotType, body); assert.equal(s.count, 2); assert.equal(s.complete, true)
  emit(t, selection()); assert.equal(t.getUnsetSlot().available, false)
})
test('new lifetime never reuses candidates or event sessions', () => {
  const t = make(); emit(t, selection()); const next = make()
  assert.equal(next.getEquipmentSelection().available, false)
  assert.notEqual(t.getActionEvents({}).sessionId, next.getActionEvents({}).sessionId)
})

test('failed and oversize unset responses invalidate without leaking old candidates', () => {
  const t = make(), valid = { path: UNSET, apiResult: 1, body: { api_slottype1: { 1: [21] } } }
  for (const invalid of [
    { ...valid, apiResult: 0 },
    { ...valid, body: { api_slottype1: { 1: Array.from({ length: 10001 }, (_, i) => i + 1) } } },
  ]) {
    emit(t, valid); emit(t, invalid)
    assert.equal(t.getUnsetSlot().available, false)
    assert.equal(t.getUnsetSlot().equipmentIds, undefined)
  }
})

test('HTTP endpoints preserve refs and repeated bridge reads do not invalidate snapshots', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
  const { createPoiDataBridge } = require('../lib/poi-http-bridge')
  const t = make(); emit(t, selection())
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'equipment-source-test-'))
  const bridge = createPoiDataBridge({
    getStore: () => ({ info: {}, sortie: {} }),
    getEquipmentSelection: () => t.getEquipmentSelection(), getUnsetSlot: () => t.getUnsetSlot(),
    port: 0, portFile: path.join(directory, 'port'), logger: { log() {}, error() {} },
  })
  try {
    await bridge.start()
    const url = `http://127.0.0.1:${bridge.getPort()}`
    const get = async endpoint => (await fetch(url + endpoint)).json()
    assert.deepEqual(await get('/equipment-selection'), t.getEquipmentSelection())
    assert.deepEqual(await get('/equipment-selection'), t.getEquipmentSelection())
    emit(t, { path: UNSET, apiResult: 1, body: { api_slottype1: { 1: [21] } } })
    assert.equal((await get('/equipment-selection')).available, false)
    assert.deepEqual(await get('/unsetslot'), t.getUnsetSlot())
  } finally {
    await bridge.stop()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
