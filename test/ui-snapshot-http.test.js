const {test}=require('node:test')
const assert=require('node:assert/strict')
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {createPoiDataBridge}=require('../lib/poi-http-bridge')
test('prototype route gates expiry/auth/body and cannot dispatch input',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'poi-ui-snapshot-test-'));let enabled=false,captures=0,inputs=0
 const bridge=createPoiDataBridge({port:0,portFile:path.join(tmp,'port'),inputToken:'fixture-only',
  inputEnabled:false,isUiSnapshotEnabled:()=>enabled,logger:{log(){},error(){}},
  getStore:()=>({info:{basic:{api_member_id:1}}}),
  getApiResponses:()=>({available:true,sessionId:'raw',latestGeneration:1}),
  getActionEvents:()=>({available:true,sessionId:'events',latestGeneration:1}),
  performInput:()=>{inputs++;throw Error('must not run')},
  dataQuery:{runtime:{readUiSnapshot:async()=>{captures++;return{frameId:'f',timeOrigin:1000,scopes:[],state:{}}}}}})
 function request(url,body,token='fixture-only'){
  return new Promise((resolve,reject)=>{
   const r=http.request({host:'127.0.0.1',port:bridge.getPort(),path:url,method:'POST',
     headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}},res=>{
    const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,raw:Buffer.concat(chunks)}))
   });r.on('error',reject);r.end(JSON.stringify(body))
  })
 }
 try{
  await bridge.start()
  const nonce={requestId:'a'.repeat(32)}
  assert.equal((await request('/ui-snapshot',nonce)).status,404)
  enabled=true
  assert.equal((await request('/ui-snapshot',nonce,'wrong')).status,401)
  assert.equal((await request('/ui-snapshot',{...nonce,input:'click'})).status,400)
  assert.equal((await request('/ui-snapshot',{...nonce,padding:'x'.repeat(300)})).status,413)
  const live=await request('/ui-snapshot',nonce);assert.equal(live.status,200)
  assert.equal(live.headers['x-snapshot-frozen'],'false')
  const frozenId=require('node:crypto').createHash('sha256').update(live.raw).digest('hex')
  const frozen=await request('/ui-snapshot/frozen',{...nonce,frozenId})
  assert.equal(frozen.status,200);assert.deepEqual(frozen.raw,live.raw)
  assert.equal(frozen.headers['x-snapshot-frozen'],'true')
  enabled=false;assert.equal((await request('/ui-snapshot',nonce)).status,404)
  assert.equal(captures,1);assert.equal(inputs,0)
 }finally{await bridge.stop();fs.rmSync(tmp,{recursive:true,force:true})}
})
