const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const configFile = () => path.join(os.homedir(), '.poi-mcp', 'ui-snapshot-prototype.json')
const pipeName = () => '\\\\.\\pipe\\poi-ui-observation-' + crypto.createHash('sha256').update(os.homedir()).digest('hex').slice(0,16)
function prototypeEnabled(now = Date.now()) {
  try {
    const raw = fs.readFileSync(configFile(), 'utf8')
    if (raw.length > 1024) return false
    const config = JSON.parse(raw)
    return config.enabled === true && Number.isSafeInteger(config.expiresAtMs) &&
      config.expiresAtMs > now && config.expiresAtMs <= now + 3600000
  } catch (_) { return false }
}
function createUiSnapshotProvider({ runtime, getStore, getApiResponses, getActionEvents, getAccount, isEnabled = prototypeEnabled }) {
  const sessionId = crypto.randomUUID()
  let sequence = 0
  const hash = value => crypto.createHash('sha256').update(value).digest('hex')
  const collectorVersion = hash(['poi-webview-runtime.js','poi-equipment-observation.js','ui-snapshot.js',
    'ui-snapshot-provider.js','poi-http-bridge.js','poi-data-query.js'].map(name => fs.readFileSync(path.join(__dirname,name))).join('\n'))
  const own = (o,k) => {
    const d = o && typeof o==='object' && Object.getOwnPropertyDescriptor(o,k)
    if (!d || !Object.prototype.hasOwnProperty.call(d,'value')) throw Error('ui_snapshot_owner_unavailable')
    return d.value
  }
  const boundary = () => {
    const raw = getApiResponses({limit:1}), events = getActionEvents({limit:1})
    const owner = own(own(own(getStore(),'info'),'basic'),'api_member_id')
    if (!['string','number'].includes(typeof owner) || !String(owner) ||
        raw.available !== true || typeof raw.sessionId!=='string' || !raw.sessionId ||
        !Number.isSafeInteger(raw.latestGeneration) || raw.latestGeneration<0 ||
        events.available!==true || typeof events.sessionId!=='string' || !events.sessionId ||
        !Number.isSafeInteger(events.latestGeneration) || events.latestGeneration<0) throw Error('ui_snapshot_source_unavailable')
    return { ownerToken: hash(String(owner)), responseCursor:{sessionId:raw.sessionId,generation:raw.latestGeneration},
      eventCursor:{sessionId:events.sessionId,generation:events.latestGeneration} }
  }
  let pending = false
  let frozen = null
  let frozenObservation = null
  async function capture(request, bundled = false) {
    if (!isEnabled()) throw Error('ui_snapshot_prototype_disabled')
    if (!request || Array.isArray(request) || Object.keys(request).length!==1 ||
        typeof request.requestId!=='string' || !/^[a-f0-9]{32}$/.test(request.requestId)) throw Error('ui_snapshot_request_invalid')
    if (pending) throw Error('ui_snapshot_busy')
    pending = true
    try {
      const started = performance.now(), capturedAtMs = Date.now(), before = boundary()
      if (bundled && typeof getAccount !== 'function') throw Error('ui_observation_account_unavailable')
      const cloneStart = performance.now()
      // Clone synchronously before awaiting the renderer. A live store reference
      // cannot prove that the account stayed unchanged across capture.
      const accountJson = bundled ? JSON.stringify(getAccount()) : null
      const eventsJson = bundled ? JSON.stringify(getActionEvents({limit:256})) : null
      const beforeCloneMs = performance.now() - cloneStart
      const value = await runtime.readUiSnapshot({})
      if (JSON.stringify(before)!==JSON.stringify(boundary())) throw Error('ui_snapshot_source_changed')
      const checkStart = performance.now()
      if (bundled && (accountJson !== JSON.stringify(getAccount()) ||
          eventsJson !== JSON.stringify(getActionEvents({limit:256})))) throw Error('ui_observation_account_or_events_changed')
      const afterCompareMs = performance.now() - checkStart
      const { discoveryMs, rendererRpcMs, captureMs, rendererSerializeMs, ...observation } = value
      const snapshot = {schemaVersion:2,kind:'poi.ui-observation.prototype',inputCapable:false,outputQualified:false,
        requestId:request.requestId,sessionId,sequence:++sequence,collectorVersion,capturedAtMs,
        ...before, ...observation, software:{packageVersion:require('../package.json').version},
        documentEpoch:hash(JSON.stringify([sessionId,value.frameId,value.timeOrigin])),
        timings:{discoveryMs,rendererRpcMs,captureMs,rendererSerializeMs,providerTotalMs:performance.now()-started}}
      const payload = bundled ? {schemaVersion:1,kind:'poi.ui-observation-bundle.prototype',
        inputCapable:false,outputQualified:false,requestId:request.requestId,
        snapshot,account:JSON.parse(accountJson),events:JSON.parse(eventsJson),
        timings:{beforeCloneMs,afterCompareMs,providerTotalMs:performance.now()-started}} : snapshot
      const encodedAt=performance.now(), body=JSON.stringify(payload)
      const providerSerializeMs=performance.now()-encodedAt
      const encoded = {body,id:hash(body),at:Date.now()}
      if (bundled) frozenObservation=encoded
      else frozen=encoded
      return {body, providerSerializeMs}
    } finally { pending = false }
  }
  function readFrozen(request, bundled = false) {
    const saved = bundled ? frozenObservation : frozen
    if (!isEnabled() || !saved || Date.now()-saved.at>5000 || !request ||
        Object.keys(request).sort().join(',')!=='frozenId,requestId' ||
        !/^[a-f0-9]{32}$/.test(request.requestId) || request.frozenId!==saved.id)
      throw Error('ui_snapshot_frozen_rejected')
    // Exact already-encoded bytes, explicitly stale diagnostic data. Never usable for input.
    return {body:saved.body,providerSerializeMs:0}
  }
  return { capture: request => capture(request), readFrozen: request => readFrozen(request),
    captureObservation: request => capture(request,true), readFrozenObservation: request => readFrozen(request,true) }
}
module.exports={createUiSnapshotProvider,prototypeEnabled,pipeName,configFile}
