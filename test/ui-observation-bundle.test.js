const {test}=require('node:test')
const assert=require('node:assert/strict')
const {createUiSnapshotProvider}=require('../lib/ui-snapshot-provider')
const nonce={requestId:'a'.repeat(32)}
function fixture(change=()=>{}) {
  const store={info:{basic:{api_member_id:1}}}
  const account={basic:{api_member_id:1},ships:{},equipment:{}}
  const events={available:true,sessionId:'events',latestGeneration:1,events:[]}
  const raw={available:true,sessionId:'raw',latestGeneration:1}
  const provider=createUiSnapshotProvider({getStore:()=>store,getAccount:()=>account,
    getApiResponses:()=>raw,getActionEvents:()=>events,isEnabled:()=>true,
    runtime:{readUiSnapshot:async()=>{change({store,account,events,raw});return{frameId:'f',timeOrigin:1,scopes:[],state:{}}}}})
  return {provider,account,events}
}
test('bundle contains a cloned account, full event payload and one bound UI capture',async()=>{
  const {provider,account,events}=fixture()
  const result=await provider.captureObservation(nonce),value=JSON.parse(result.body)
  assert.equal(value.kind,'poi.ui-observation-bundle.prototype')
  assert.equal(value.inputCapable,false);assert.equal(value.outputQualified,false)
  assert.deepEqual(value.account,account);assert.deepEqual(value.events,events)
  assert.deepEqual(value.snapshot.eventCursor,{sessionId:'events',generation:1})
  account.basic.api_member_id=2
  assert.equal(value.account.basic.api_member_id,1)
  const id=require('node:crypto').createHash('sha256').update(result.body).digest('hex')
  assert.equal(provider.readFrozenObservation({...nonce,frozenId:id}).body,result.body)
  assert.throws(()=>provider.readFrozen({...nonce,frozenId:id}),/frozen_rejected/)
})
test('bundle rejects account and event changes even when cursors do not advance',async()=>{
  for(const change of [({account})=>{account.equipment['2']={api_id:2}},
    ({events})=>{events.events.push({generation:1,path:'unexpected'})}]) {
    await assert.rejects(fixture(change).provider.captureObservation(nonce),/account_or_events_changed/)
  }
})
test('bundle rejects owner, response and event cursor changes during capture',async()=>{
  for(const change of [({store})=>{store.info.basic.api_member_id=2},
    ({raw})=>{raw.latestGeneration++},({events})=>{events.latestGeneration++}]) {
    await assert.rejects(fixture(change).provider.captureObservation(nonce),/source_changed/)
  }
})
test('bundle shares the busy gate and fixed request schema with snapshots',async()=>{
  let release
  const {provider}=fixture()
  await assert.rejects(provider.captureObservation({...nonce,action:'click'}),/request_invalid/)
  const pending=createUiSnapshotProvider({getStore:()=>({info:{basic:{api_member_id:1}}}),
    getAccount:()=>({}),getApiResponses:()=>({available:true,sessionId:'r',latestGeneration:0}),
    getActionEvents:()=>({available:true,sessionId:'e',latestGeneration:0}),isEnabled:()=>true,
    runtime:{readUiSnapshot:()=>new Promise(resolve=>{release=resolve})}})
  const first=pending.captureObservation(nonce)
  await assert.rejects(pending.capture(nonce),/busy/)
  release({frameId:'f',timeOrigin:1,scopes:[],state:{}});await first
})
