// Captured responses only. No game requests, UI ordering or equipability claims.
const SELECTION = '/kcsapi/api_req_kaisou/slot_select'
const UNSET = '/kcsapi/api_get_member/unsetslot'
const MAX_IDS = 10000

function integer(value, minimum = 1) {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^\d+$/.test(value)) return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= minimum ? number : null
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function responseData(body) {
  if (!object(body)) return null
  if (Object.hasOwn(body, 'api_data')) return object(body.api_data) ? body.api_data : null
  return body
}

function selection(detail) {
  const data = responseData(detail.body)
  const post = detail.postBody
  if (!data || !Array.isArray(data.api_slotitem) || !object(post)) return null
  const ship = integer(post.api_id)
  const slot = integer(post.api_slot_idx, 0)
  if (ship === null || slot === null || slot > 5 || data.api_slotitem.length > MAX_IDS) return null
  const equipmentIds = Array.from(data.api_slotitem, item => object(item) ? integer(item.api_id) : null)
  if (equipmentIds.includes(null) || new Set(equipmentIds).size !== equipmentIds.length) return null
  return { postBody: { api_id: ship, api_slot_idx: slot }, equipmentIds, count: equipmentIds.length }
}

function unset(detail) {
  const data = responseData(detail.body)
  if (!data) return null
  const bySlotType = {}
  const equipmentIds = []
  for (const [slotType, groups] of Object.entries(data)) {
    // Metadata is not a candidate group. A malformed declared group is fatal.
    if (!slotType.startsWith('api_slottype')) continue
    if (!/^api_slottype\d+$/.test(slotType) || !object(groups)) return null
    const normalized = {}
    for (const [group, ids] of Object.entries(groups)) {
      if (!/^\d+$/.test(group) || !Array.isArray(ids)) return null
      if (ids.length > MAX_IDS - equipmentIds.length) return null
      const values = Array.from(ids, id => integer(id))
      if (values.includes(null)) return null
      equipmentIds.push(...values)
      normalized[group] = values
    }
    bySlotType[slotType] = normalized
  }
  if (!Object.keys(bySlotType).length || new Set(equipmentIds).size !== equipmentIds.length) return null
  return { bySlotType, equipmentIds, count: equipmentIds.length }
}

function createEquipmentSources({ actionSessionId, responseSessionId }) {
  let selected = { available: false, complete: false, schemaVersion: 1, generation: 0, reason: 'not_observed' }
  let unassigned = { ...selected }

  function reference(detail, event, response) {
    return {
      path: detail.path,
      actionEvent: event ? { sessionId: actionSessionId, generation: event.generation } : null,
      apiResponse: response ? { sessionId: responseSessionId, generation: response.generation } : null,
    }
  }

  function invalidate(previous, source, reason) {
    return { schemaVersion: 1, available: false, complete: false,
      generation: previous.generation + 1, reason, invalidatedBy: source }
  }

  function capture(detail, event, response) {
    if (!detail.path.startsWith('/kcsapi/')) return
    const source = reference(detail, event, response)
    // Conservative boundary: every subsequent game response invalidates both
    // snapshots, even failed/unknown paths. Read-only bridge GETs do not do so.
    // This avoids maintaining an incomplete list of account-changing paths.
    if (selected.available || detail.path === SELECTION) {
      selected = invalidate(selected, source, 'subsequent_game_response')
    }
    if (unassigned.available || detail.path === UNSET) {
      unassigned = invalidate(unassigned, source, 'subsequent_game_response')
    }
    if (detail.path !== SELECTION && detail.path !== UNSET) return
    const previous = detail.path === SELECTION ? selected : unassigned
    const payload = event?.apiResult === 1 && response && !response.truncated
      ? (detail.path === SELECTION ? selection(detail) : unset(detail)) : null
    const result = payload ? {
      schemaVersion: 1, available: true, complete: true, generation: previous.generation,
      capturedAt: event.capturedAt, path: detail.path, apiResult: 1, source,
      order: 'response_order_not_ui_order', ...payload,
    } : { ...previous, reason: 'invalid_or_unsuccessful_response' }
    if (detail.path === SELECTION) selected = result
    else unassigned = result
  }

  return {
    capture,
    getEquipmentSelection: () => structuredClone(selected),
    getUnsetSlot: () => structuredClone(unassigned),
  }
}

module.exports = { createEquipmentSources }
