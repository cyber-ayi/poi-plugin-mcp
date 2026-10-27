# Captured equipment sources (schema 1)

Tracked in [kc-assist#57](https://github.com/homelab-s5oyt03iv9/kc-assist/issues/57).
`GET /equipment-selection` and `GET /unsetslot` only report responses already
observed from ordinary game UI activity. They never fetch game APIs. This schema
is a development candidate, not evidence of live UI candidate/sort semantics.

## Available snapshot

Existing successful fields remain: `available`, endpoint-local `generation`,
`capturedAt`, `path`, `equipmentIds`, `count`, and selection `postBody` or unset
`bySlotType`. Schema 1 adds:

- `schemaVersion: 1`, `complete: true`, `apiResult: 1`.
- `source.path`, `source.actionEvent: {sessionId, generation}` and
  `source.apiResponse: {sessionId, generation}`. These are two independent
  streams. The refs bind the same capture; their IDs and counters are NOT equal.
- `order: "response_order_not_ui_order"`. No UI ordering is asserted.

`complete` means all IDs in this one captured response were parsed without
silently discarding entries, not that it is the complete UI list, not proof of
ship/slot equipability, and not that all inventory/search pages were fetched.
The action-event layer's established success convention also accepts successful
unwrapped poi bodies. Explicit unsuccessful responses are rejected.

Selection requires a valid target ship/slot and at most 10,000 unique safe positive
integer IDs. `unsetslot` preserves declared groups, including empty groups, but
rejects malformed groups, invalid IDs and duplicates (including overlap across
groups). Overlapping-group semantics have NOT been qualified for prediction; do
not flatten them into an apparently complete union. Empty selection lists are
valid captured data, though they cannot locate a target. No token is copied from
request parameters. Returned snapshots are copies.

## Invalidation and migration

Every subsequent `/kcsapi/` response invalidates both retained snapshots, including
failed and unrecognized paths. The matching endpoint is then replaced only if
that new capture is successful and valid. This deliberately conservative policy
avoids an incomplete allowlist of inventory-changing events. A new selection also
invalidates the old unset snapshot, and vice versa; consumers must NOT require both
to be concurrently available. Bridge GETs do not invoke capture or invalidate data.

Unavailable snapshots have `available:false`, `complete:false`, endpoint-local
`generation`, and `reason` (`not_observed`, `subsequent_game_response`, or
`invalid_or_unsuccessful_response`). Invalidation includes `invalidatedBy` refs;
old candidate IDs and old targets are removed. Counters are not freshness proofs.
Consumers that previously used retained historical snapshots must now tolerate
unavailability. Do not retry a game request to repopulate an endpoint.

Read action-event AND API-response cursors before and after collecting data.
Require unchanged cursors and source refs equal to the current endpoints' latest
cursors. Record the action cursor BEFORE this run opens a slot normally; the
selection event must be newer, in the same session and for the same ship/slot.
A later GET cannot retroactively establish that opening boundary. Fingerprint the
full inventory/ownership, master/rules versions, current UI context and source
refs; every new observation rebuilds the hypothesis. No timestamps, TTL, solver
candidate pool, or endpoint-local counter substitute for these checks.

## Validation and activation boundary

`node --test --test-isolation=none test/*.test.js` runs offline provider tests
(including temporary loopback HTTP servers). A matching source snapshot does not
qualify automatic UI output. Live validation must separately establish the
selection response's candidate scope and the actual UI filtering/order. Keep raw
account/response fixtures private and publish only synthetic tests or safe summaries.

Temporary loading, production deployment and any UI output are separate decisions.
Restore the exact previous plugin files/runtime after a temporary trial, preserve
host journals, and never clear uncertain tasks to obtain a fresh candidate.
