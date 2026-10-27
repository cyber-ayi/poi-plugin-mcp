// Fixed, bounded observation prototype; no input surface, no game methods/getters.
const parent = ['children','0','children','1','children','4','children','0']
const inventory = [...parent, 'children','4']
const keys = ['index','memId','memSlotItemId','_text','_show_list']
const snapshotScopes = [
  { name: 'identity', rootPath: [], maxDepth: 12, maxMatches: 256,
    anyRequiredKeys: ['memShipId','memSlotItemId','_text'], selectKeys: ['index','memShipId','memSlotItemId','_text'] },
  { name: 'overlay', rootPath: [], maxDepth: 2, maxMatches: 256, selectKeys: [] },
  ...[['panel',[...parent,'children','2']], ['inventory',inventory],
    ['pages',[...inventory,'children','21']], ['category',[...inventory,'children','25']],
    ['detail',[...inventory,'children','24']]].map(([name,rootPath]) => ({
      name, rootPath, maxDepth: 12, maxMatches: 256, selectKeys: keys,
      ...(name === 'inventory' ? { anyRequiredKeys: ['memSlotItemId','_text'] } : {}),
    })),
  { name:'all', rootPath:[], maxDepth:24, maxMatches:2048, selectKeys:[
    'index','memId','memShipId','memSlotItemId','_text','_show_list','_state','focusIndex',
    'sortKey','_isFilter','_type','status','_filter_status','pageCount'] },
]
// Serialized verbatim. Reads only own data descriptors in game objects.
function snapshotState(root, observeStock) {
  const own = (o,k) => {
    const d = o && typeof o === 'object' && Object.getOwnPropertyDescriptor(o,k)
    if (!d || !Object.prototype.hasOwnProperty.call(d,'value')) throw Error('ui_snapshot_missing_or_accessor')
    return d.value
  }
  let layers
  try {
    let p=root
    for (const i of [0,1,4,0]) p=own(own(p,'children'),String(i))
    const c=own(p,'children'), n=own(c,'length')
    if (!Array.isArray(c) || !Number.isSafeInteger(n) || n<3 || n>16) throw Error('ui_snapshot_layers_invalid')
    const flags=Array.from({length:n},(_,i)=>{
      const o=own(c,String(i)),visible=own(o,'visible'),renderable=own(o,'renderable'),worldAlpha=own(o,'worldAlpha')
      if (typeof visible!=='boolean'||typeof renderable!=='boolean'||typeof worldAlpha!=='number'||!Number.isFinite(worldAlpha)||worldAlpha<0||worldAlpha>1) throw Error('ui_snapshot_layer_flags')
      return {visible,renderable,worldAlpha}
    })
    layers={available:true,schemaVersion:1,count:n,layers:flags}
  } catch (_) { layers={available:false,reason:'ui_snapshot_layers_unavailable'} }
  let stock
  try { stock=observeStock(root) }
  catch (e) { stock={available:false,reason:/^equipment_stock_[a-z_]+$/.test(e.message)?e.message:'equipment_stock_inspection_failed'} }
  return { layers, stock }
}
module.exports={snapshotScopes,snapshotState}
