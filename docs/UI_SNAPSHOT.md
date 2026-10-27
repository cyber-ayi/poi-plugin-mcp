# Fixed UI snapshot / local pipe prototype

Draft continuation of provider #3 for kc-assist #62. Default off; no input or game
business API is added. This is a task-specific observation bundle, not a global
StateSnapshot or authorization to click.

`POST /ui-snapshot` accepts only `{ "requestId": "<32 lowercase hex chars>" }`.
The existing bearer is required. A private `.poi-mcp/ui-snapshot-prototype.json`
containing `enabled:true` and an `expiresAtMs` within the next hour enables the
experiment; every request checks expiry. On Windows, the same handler also
listens on a user-specific local named pipe. The pipe dispatches only snapshot
and explicitly frozen diagnostic requests. It cannot dispatch `/input`, admin,
query, eval or game calls. The production controller has no new input setting.

Every live request discovers frames afresh and requires exactly one available
render root. One synchronous own-property Pixi traversal feeds seven fixed
projections; scoped bounds are recomputed from captured geometry, including the
shallow error overlay's exact depth limit. Missing scopes remain unavailable;
node/depth budgets cannot silently become a complete result. Layer flags include
hidden siblings. Normal unfiltered stock state reuses #3's full set/order, target
ship/slot, page and visible row identity checks. Other modes remain unavailable.

The envelope binds provider session+sequence, collector module hashes, software
version, request nonce, frame+browser time-origin document epoch, owner digest,
and separate response/event cursors. The cursors and owner are checked before
and after the renderer call. Legacy scoped document/node tokens remain for
projection parity; document lifetime comes from the envelope epoch. First-time
source discovery is not an execution qualification. Clients pin source identity,
check nonce/age/budgets, reject source changes and never retry communication.

`POST /ui-snapshot/frozen` additionally requires the SHA256 `frozenId` of the most
recent encoded live body. It returns exactly those bytes for up to five seconds,
with `X-Snapshot-Frozen:true` and the new request ID in the header. This isolates
client/protocol/transport overhead without recapturing or encoding. A live client
must reject it; it is stale diagnostic data. Both forms remain
`inputCapable:false`, `outputQualified:false`.

Timings nest: renderer capture/serialization are inside renderer RPC; discovery,
RPC and normalization are inside provider total; outer serialization is separate;
client round trip includes provider and transport, with decode/validation separate.
Frozen round trip still includes request parsing/scheduling and client overhead,
so it is not pure kernel transfer time. Microbenchmarks cannot qualify ten-second
home-port round trips.

The live 0.2.29 installation differs from this repository main: notably its bridge
has inlined MCP helpers. Testing must apply only this PR's bridge insertions to the
actual original bridge and record both hashes, rather than copying the whole
repository bridge. A failed experimental reload is not a production deployment.
Back up exact bytes, use the original fixed OutputHost/journal for any separately
qualified UI navigation, and restore files/config/capabilities on every exit.
Do not reset old runs, migrate uncertain state or replace account/cache data.

Synthetic fixtures cover parity, depth-limited bounds, accessors, budgets, source
and owner/cursor drift, nonce, opt-in/expiry, busy capture, frozen-body identity,
HTTP auth/body limits and inability to dispatch input. Live qualification and
aggregate timing evidence are tracked on kc-assist #62 and the paired consumer PR;
raw accounts, ordered instance arrays, screenshots and permits stay private.
