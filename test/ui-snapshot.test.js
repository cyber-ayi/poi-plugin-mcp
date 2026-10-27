const assert=require('node:assert/strict')
const {test}=require('node:test')
const vm=require('node:vm')
const {performance}=require('node:perf_hooks')
const {createPoiWebviewRuntime}=require('../lib/poi-webview-runtime')
const {snapshotScopes}=require('../lib/ui-snapshot')
const flags={visible:true,renderable:true,worldAlpha:1,interactive:true}
function fixture() {
 const leaf=(text,x=0)=>({...flags,_text:text,hitArea:{x:0,y:0,width:10,height:10},
   transform:{worldTransform:{a:1,b:0,c:0,d:1,tx:x,ty:0}}})
 const root={...flags,children:[{...flags,children:[leaf('one'),{...flags,children:[leaf('deep',100)]}]}]}
 let executions=0
 const context={PIXI:{ticker:{shared:{_head:{next:{context:{renderer:{view:{isConnected:true},_lastObjectRendered:root}}}}}}},performance,URL}
 const frame={processId:1,routingId:2,url:'https://test.kancolle-server.com/game',executeJavaScript:s=>{
  executions++;return Promise.resolve(vm.runInNewContext(s,context))
 }}
 const runtime=createPoiWebviewRuntime({getStore:()=>({ref:{getWebContents:()=>({mainFrame:frame})}})})
 return {root,context,runtime,count:()=>executions}
}
const plain=o=>JSON.parse(JSON.stringify(o))
test('one capture produces fixed projections matching independent queries including depth-limited geometry',async()=>{
 const f=fixture(),value=await f.runtime.readUiSnapshot({})
 assert.equal(f.count(),1)
 for(const [i,scope] of snapshotScopes.entries()) {
  if(scope.name==='all')continue
  const {name,...query}=scope
  const legacy=await f.runtime.findObjects({...query,frameId:'1:2',root:'pixi.last-rendered',projection:'pixi.interactive',maxNodes:50000})
  const actual=value.scopes[i].scene
  assert.deepEqual(plain(actual.matches),plain(legacy.matches),name)
  assert.equal(actual.available,legacy.available,name)
  assert.equal(actual.truncatedBy,legacy.truncatedBy,name)
 }
 assert.equal(value.state.stock.available,false)
 assert.equal(value.state.layers.available,false)
})
test('does not execute game accessors or methods or serialize attached private graphs',async()=>{
 const f=fixture();let calls=0
 Object.defineProperty(f.root.children[0],'_text',{get(){calls++;throw Error('getter')}})
 f.root.secret={password:'not allowed'}
 f.root.method=()=>{calls++;throw Error('method')}
 const value=await f.runtime.readUiSnapshot({})
 assert.equal(calls,0);assert.ok(!JSON.stringify(value).includes('not allowed'))
})
test('ambiguous frames, budget truncation and arbitrary request fields reject',async()=>{
 const f=fixture();await assert.rejects(f.runtime.readUiSnapshot({source:'anything'}),/request_invalid/)
 let n=f.root;for(let i=0;i<26;i++){n.children=[{...flags}];n=n.children[0]}
 await assert.rejects(f.runtime.readUiSnapshot({}),/incomplete/)
})
test('fresh capture follows current root, geometry and document lifetime',async()=>{
 const f=fixture(),before=await f.runtime.readUiSnapshot({})
 f.root.children[0].children[0]._text='changed'
 const after=await f.runtime.readUiSnapshot({})
 assert.notEqual(before.scopes[0].scene.pageToken,after.scopes[0].scene.pageToken)
 assert.ok(after.timeOrigin>0)
})
const {createUiSnapshotProvider}=require('../lib/ui-snapshot-provider')
function providerFixture() {
 let gen=1,owner=7,event=1
 const options={runtime:{readUiSnapshot:async()=>({frameId:'1:2',timeOrigin:1000,scopes:[],state:{},
   discoveryMs:1,rendererRpcMs:2,captureMs:1,rendererSerializeMs:.1})},
   getStore:()=>({info:{basic:{api_member_id:owner}}}),
   getApiResponses:()=>({available:true,sessionId:'raw',latestGeneration:gen}),
   getActionEvents:()=>({available:true,sessionId:'events',latestGeneration:event}),isEnabled:()=>true}
 return {options,change:()=>{gen++},owner:()=>{owner++},event:()=>{event++}}
}
test('source, event, account and response cursor are checked on both sides of renderer capture',async()=>{
 for(const mutate of ['change','owner','event']){
  const f=providerFixture();f.options.runtime.readUiSnapshot=async()=>{f[mutate]();return{}}
  await assert.rejects(createUiSnapshotProvider(f.options).capture({requestId:'a'.repeat(32)}),/source_changed/)
 }
})
test('bounded nonce, opt-in, serial capture and session sequence are enforced',async()=>{
 const f=providerFixture(),p=createUiSnapshotProvider(f.options)
 await assert.rejects(p.capture({requestId:'old'}),/request_invalid/)
 await assert.rejects(p.capture({requestId:'a'.repeat(32),path:[]}),/request_invalid/)
 const one=JSON.parse((await p.capture({requestId:'a'.repeat(32)})).body)
 const two=JSON.parse((await p.capture({requestId:'b'.repeat(32)})).body)
 assert.equal(one.sessionId,two.sessionId);assert.equal(two.sequence,one.sequence+1)
 assert.equal(one.inputCapable,false);assert.equal(one.outputQualified,false)
 assert.match(one.collectorVersion,/^[a-f0-9]{64}$/)
 assert.ok(!JSON.stringify(one).includes('api_member_id'))
 f.options.isEnabled=()=>false
 await assert.rejects(createUiSnapshotProvider(f.options).capture({requestId:'a'.repeat(32)}),/disabled/)
 let finish;f.options.isEnabled=()=>true
 f.options.runtime.readUiSnapshot=()=>new Promise(resolve=>{finish=resolve})
 const q=createUiSnapshotProvider(f.options),pending=q.capture({requestId:'a'.repeat(32)})
 await assert.rejects(q.capture({requestId:'a'.repeat(32)}),/busy/)
 finish({});await pending
})
test('frozen diagnostic returns the exact encoded bytes and rejects mismatched identifiers',async()=>{
 const f=providerFixture(),p=createUiSnapshotProvider(f.options),request={requestId:'c'.repeat(32)}
 const live=await p.capture(request),hash=require('node:crypto').createHash('sha256').update(live.body).digest('hex')
 const frozen=p.readFrozen({...request,frozenId:hash})
 assert.equal(frozen.body,live.body);assert.equal(frozen.providerSerializeMs,0)
 assert.throws(()=>p.readFrozen({...request,frozenId:'d'.repeat(64)}),/rejected/)
})
test('complete primitive graph carries own geometry for independently scoped consumer unions',async()=>{
 const f=fixture(),value=await f.runtime.readUiSnapshot({}),all=value.scopes.at(-1)
 assert.equal(all.name,'all');assert.equal(all.scene.exhausted,true)
 assert.ok(all.scene.matches.length>=4)
 assert.ok(all.scene.matches.every(node=>Object.hasOwn(node,'ownWorldBounds')))
 assert.equal(all.scene.matches.find(node=>node.path.length===0).ownWorldBounds,null)
})
test('present data descriptor with nonscalar value stays distinct from absence and accessor',async()=>{
 const f=fixture();f.root.children[0]._text={private:'never serialized'}
 Object.defineProperty(f.root,'_text',{get(){throw Error('must not execute')}})
 const value=await f.runtime.readUiSnapshot({}),all=value.scopes.at(-1).scene
 assert.ok(all.matches.find(n=>n.path.length===2).presentKeys.includes('_text'))
 assert.ok(!all.matches.find(n=>n.path.length===0).presentKeys.includes('_text'))
 assert.ok(!JSON.stringify(value).includes('never serialized'))
 assert.ok(value.scopes[0].scene.matches.some(n=>n.path.length===2))
})
