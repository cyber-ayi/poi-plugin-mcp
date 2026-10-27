// Serialized into a synchronous read-only inspection. Never invoke game methods.
function observeEquipmentStock(root) {
  const need = (yes, reason) => { if (!yes) throw new Error('equipment_stock_' + reason) }
  const own = (object, key) => {
    need(object !== null && typeof object === 'object', 'parent_invalid')
    const d = Object.getOwnPropertyDescriptor(object, key)
    need(d && Object.prototype.hasOwnProperty.call(d, 'value'), 'missing_or_accessor')
    return d.value
  }
  const integer = (n, min = 0) => Number.isSafeInteger(n) && n >= min
  const array = (value, max) => {
    need(Array.isArray(value) && integer(own(value, 'length')) && value.length <= max, 'array_invalid')
    return Array.from({ length: value.length }, (_, i) => own(value, String(i)))
  }
  let parent = root
  for (const i of [0, 1, 4, 0]) parent = own(own(parent, 'children'), String(i))
  const children = array(own(parent, 'children'), 16)
  const active = children.flatMap((node, i) => {
    const v = own(node, 'visible'), r = own(node, 'renderable'), a = own(node, 'worldAlpha')
    need(typeof v === 'boolean' && typeof r === 'boolean' && typeof a === 'number' && Number.isFinite(a) && a >= 0 && a <= 1, 'layer_flags')
    return v && r && a > 0 ? [i] : []
  })
  need(JSON.stringify(active) === '[0,2,3,4]', 'wrong_layers')
  const task = own(parent, '_taskChoiceSlotItem'), list = children[4]
  need(own(task, '_slotitemlist') === list && own(task, '_initialized') === true, 'task_not_current')
  need(own(task, '_isEditExtraSlot') === false, 'extra_slot')
  const ship = own(task, '_mem_ship_id'), slot = own(task, '_slot_index')
  need(integer(ship, 1) && integer(slot) && slot <= 4, 'target_invalid')
  const memory = own(task, '_memory')
  need(own(memory, 'mode') === 0 && own(memory, 'filter') === 0 && own(memory, 'filter_detail') === 0, 'mode_unsupported')
  const pager = own(list, '_pagerView'), pageIndex = own(pager, 'focusIndex')
  need(own(list, 'ITEM_COUNT') === 10 && integer(pageIndex) && own(memory, 'slotItemPage') === pageIndex, 'page_invalid')
  need(own(own(list, '_slotItemFilterView'), '_show_list') === false, 'filter_open')
  const id = item => {
    const n = own(own(item, '_o'), 'api_id')
    need(integer(n, 1), 'id_invalid'); return n
  }
  const candidates = array(own(task, '_unsetList'), 10000).map(id)
  const source = array(own(task, '_sourceSlotItems'), 10000)
  const orderedIds = source.map(entry => {
    need(own(entry, 'isSortie') === false && own(entry, 'isExpedition') === false && own(entry, 'attached') === null, 'not_stock')
    return id(own(entry, 'item'))
  })
  need(orderedIds.length > 0 && new Set(orderedIds).size === orderedIds.length && new Set(candidates).size === candidates.length, 'duplicate_or_empty')
  const members = new Set(candidates)
  need(candidates.length === orderedIds.length && orderedIds.every(n => members.has(n)), 'membership_mismatch')
  const pageCount = Math.ceil(orderedIds.length / 10)
  need(own(pager, 'pageCount') === pageCount && pageIndex < pageCount, 'page_count_mismatch')
  const rows = array(own(list, '_listItems'), 10)
  const rowIds = rows.flatMap(row => {
    const v = own(row, 'visible'), r = own(row, 'renderable'), a = own(row, 'worldAlpha')
    need(typeof v === 'boolean' && typeof r === 'boolean' && typeof a === 'number' && Number.isFinite(a) && a >= 0 && a <= 1, 'row_flags')
    if (!v || !r || a === 0) return []
    const n = own(row, 'memSlotItemId'); need(integer(n, 1), 'row_id_invalid'); return [n]
  })
  need(JSON.stringify(rowIds) === JSON.stringify(orderedIds.slice(pageIndex * 10, (pageIndex + 1) * 10)), 'page_order_mismatch')
  need(own(parent, '_taskChoiceSlotItem') === task && own(task, '_slotitemlist') === list, 'task_changed')
  return { available: true, complete: true, schemaVersion: 1, source: 'current_ui_stock_order',
    shipInstanceId: ship, slotIndex: slot, mode: 'stock', category: 0, detail: 0,
    pageSize: 10, page: pageIndex + 1, pageCount, count: orderedIds.length, orderedIds, rowIds }
}
module.exports = { observeEquipmentStock }
