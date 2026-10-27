const assert = require('node:assert/strict')
const { test } = require('node:test')
const { observeEquipmentStock } = require('../lib/poi-equipment-observation')
const { createPoiDataQuery } = require('../lib/poi-data-query')
function fixture(page=1,count=23) {
 const layer=()=>({visible:true,renderable:true,worldAlpha:1})
 const items=Array.from({length:count},(_,i)=>({_o:{api_id:i+1}}))
 const list={...layer(),ITEM_COUNT:10,_slotItemFilterView:{_show_list:false},_pagerView:{focusIndex:page-1,pageCount:Math.ceil(count/10)},_listItems:items.slice((page-1)*10,page*10).map(x=>({...layer(),unset:true,memSlotItemId:x._o.api_id}))}
 const task={_slotitemlist:list,_initialized:true,_isEditExtraSlot:false,_mem_ship_id:101,_slot_index:0,_memory:{mode:0,filter:0,filter_detail:0,slotItemPage:page-1},_unsetList:items,_sourceSlotItems:items.map(item=>({item,isUnset:true,isSortie:false,isExpedition:false,attached:null}))}
 const parent={children:[layer(),{...layer(),visible:false},layer(),layer(),list],_taskChoiceSlotItem:task}
 let root=parent;for(const i of [0,4,1,0]){const children=[];children[i]=root;root={children}}
 return {root,task,list,items,parent}
}
test('complete observed order, full current page and short tail are tied together',()=>{
 for(const page of [1,2,3]){
  const f=fixture(page);const value=observeEquipmentStock(f.root)
  assert.equal(value.page,page);assert.equal(value.count,23);assert.equal(value.complete,true)
  assert.deepEqual(value.rowIds,Array.from({length:page===3?3:10},(_,i)=>(page-1)*10+i+1))
 }
})
for(const [name,change]of [
 ['duplicate',f=>f.items[1]._o.api_id=1],['hole',f=>delete f.task._sourceSlotItems[2]],
 ['wrong member',f=>f.task._sourceSlotItems[0].item={_o:{api_id:999}}],
 ['partial page',f=>f.list._listItems.pop()],['swapped rows',f=>f.list._listItems.reverse()],
 ['stale task',f=>f.task._slotitemlist={}],['extra slot',f=>f.task._isEditExtraSlot=true],
 ['filter',f=>f.task._memory.filter=1],['menu',f=>f.list._slotItemFilterView._show_list=true],
 ['bad count',f=>f.list._pagerView.pageCount=9],['old page',f=>f.task._memory.slotItemPage=1],
 ['not stock',f=>f.task._sourceSlotItems[0].attached={ship:1}],['overlay',f=>f.parent.children.push({visible:true,renderable:true,worldAlpha:1})],
 ['accessor',f=>Object.defineProperty(f.items[0],'_o',{get(){throw Error('accessor invoked')}})],
 ['oversize',f=>f.task._unsetList=Array(10001)],
])test('rejects '+name,()=>{
 const f=fixture();change(f);assert.throws(()=>observeEquipmentStock(f.root),/equipment_stock_/)
})
test('source boundary rejects an unrelated response during inspection',async()=>{
 let gen=1
 const query=createPoiDataQuery({getApiResponses:()=>({available:true,sessionId:'s',latestGeneration:gen}),runtime:{readEquipmentStock:async()=>{gen++;return observeEquipmentStock(fixture().root)}}})
 await assert.rejects(query.query({source:'webview.equipment-stock',frameId:'game'}),/cursor changed/)
})
test('source boundary preserves independent raw cursor',async()=>{
 const query=createPoiDataQuery({getApiResponses:()=>({available:true,sessionId:'raw',latestGeneration:9}),runtime:{readEquipmentStock:async()=>observeEquipmentStock(fixture().root)}})
 const value=(await query.query({source:'webview.equipment-stock',frameId:'game'})).value
 assert.deepEqual(value.responseCursor,{sessionId:'raw',generation:9})
})
module.exports={fixture}
test('real runtime expression resolves the current Pixi tree and projects stock',async()=>{
 const vm=require('node:vm'),{createPoiWebviewRuntime}=require('../lib/poi-webview-runtime')
 const f=fixture(),renderer={view:{isConnected:true},_lastObjectRendered:f.root}
 const context={PIXI:{ticker:{shared:{_head:{next:{context:{renderer}}}}}}}
 const frame={processId:1,routingId:2,url:'https://test.kancolle-server.com/game',executeJavaScript:s=>Promise.resolve(vm.runInNewContext(s,context))}
 const runtime=createPoiWebviewRuntime({getStore:()=>({ref:{getWebContents:()=>({mainFrame:frame})}})})
 assert.equal((await runtime.readEquipmentStock({source:'webview.equipment-stock',frameId:'1:2'})).count,23)
 f.task._memory.mode=1
 const failure=await runtime.readEquipmentStock({source:'webview.equipment-stock',frameId:'1:2'})
 assert.equal(failure.available,false);assert.match(failure.reason,/mode_unsupported/)
})
