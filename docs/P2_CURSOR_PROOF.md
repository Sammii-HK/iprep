# P2 change feed: proof that the transaction-horizon cursor is correct

Status: proven by `__tests__/db/sync-cursor.integration.test.ts` (9 tests, run three times in a row, plus the full
suite). The design was accepted provisionally on the condition that it proved correct and maintainable; it did.

## The problem

A device pulls "everything since my cursor". A naive cursor (`id > last`, or a timestamp) is wrong whenever
transactions commit in a different order from the order they began: transaction A inserts row 10 and stays open,
transaction B inserts row 11 and commits, the device pulls and advances its cursor to 11, A commits row 10, and the
device never sees it. For a learning ledger that is silent loss. The negative-control test reproduces exactly this
with the naive query and shows the row is lost.

## The design (lib/sync/pull.ts, SyncChange)

- Every change row stores `txid`, the id of the transaction that wrote it (`pg_current_xact_id()`, a 64-bit `xid8`,
  stored as a `bigint`), and a `bigserial id`. The row is written in the same transaction as the domain change.
- A pull runs ONE statement:
  `WITH horizon AS (SELECT pg_snapshot_xmin(pg_current_snapshot())::text::bigint AS h) SELECT ... WHERE learnerId = $1
  AND txid < h AND (txid, id) > (cursor.txid, cursor.id) ORDER BY txid, id LIMIT n`.
- Why it is safe: `pg_snapshot_xmin` is the lowest transaction id that was still in flight when the statement's
  snapshot was taken. Every transaction with a smaller id has finished (committed or rolled back) and every row it
  committed is visible to that same snapshot. So all rows with `txid < h` are final: nothing can later appear behind
  them. A transaction still in flight has `txid >= h`, so its rows are not served until it finishes, and the cursor
  can never move past them. Rolled-back transactions leave gaps in ids, which is harmless because a cursor is a
  position, not a count.
- The cursor is the opaque pair `(txid, id)` plus the epoch. Reading the horizon and the rows in one statement means
  they share one snapshot, which the argument needs.

## Experiments (what the tests do, against real Postgres)

| Experiment | Result |
| --- | --- |
| A starts and holds, B starts later, inserts and commits; pull while A is in flight | nothing served (B is held back by A); after A commits one pull serves A then B |
| the same, with an earlier pull already holding a cursor | resuming from that cursor serves the late row; none missed |
| negative control: the naive id cursor in the same scenario | the late row is lost for ever (proves the experiment can detect the failure) |
| rollbacks mixed with commits | the rolled-back rows never appear; ids have gaps; the next pull continues correctly |
| 8 concurrent writers across two learners with random hold times and some rollbacks, racing two pullers | every committed change served exactly once, none missed, none repeated, strictly increasing order, learners isolated (about 130 changes per run) |
| pagination at limit 1, 3, 1000 | identical sequences: a page boundary cannot lose a change |
| interrupt after 4 rows, persist the cursor (encode/decode), resume | the concatenation equals the uninterrupted pull |
| idle-in-transaction holder | freshness is delayed, correctness is not; the held row and the later one arrive together, in order, once it ends |
| epoch bump | an old cursor is refused with `EPOCH_CHANGED` (409) and a pull from the start is complete and identical in content |
| SQL types and functions | `pg_current_xact_id()` is `xid8`, `::text::bigint` is stable within a transaction and round-trips as a bigint |

The experiments ran on Postgres 15.12 locally. `pg_current_xact_id`, `pg_snapshot_xmin` and `pg_current_snapshot`
exist since Postgres 13 with identical semantics; Preview and Production run 17. The same SQL types were checked on
Preview during the rehearsal (see the PR report).

## Representation and lifetime

`xid8` is a 64-bit counter that never wraps (the epoch is part of it). It fits a signed `bigint` until 2^63 - 1, which
at an absurdly pessimistic 10,000 write transactions per second is about 29 million years. `bigint` ordering equals
`xid8` ordering. The cursor encodes both numbers as decimal strings, so no JSON number precision is lost.

## Operational properties (read these before changing anything)

1. **The horizon is cluster-wide, not per learner.** Any long-running WRITING transaction anywhere in the same
   Postgres instance holds the horizon back and delays every learner's feed until it ends. Read-only queries do not
   (they have no transaction id). We found this while testing: two test databases in one cluster delayed each other,
   so `pnpm test:db` runs the files sequentially. In production the application database is the only writer; keep
   write transactions short and never leave one idle.
2. **Order is by transaction id, not by commit time.** That is fine because the horizon guarantees completeness. Do not
   "improve" it to `ORDER BY id`, `ORDER BY createdAt` or a timestamp cursor: each reintroduces the lost-write race.
3. **Every writer must insert its SyncChange in the same transaction as the change** (`announceAttempt`,
   `processEvent`). A change announced outside the transaction can be announced before it is visible, or never.
4. **Do not compute the horizon in a separate statement** from the page read.
5. **Contiguous numbers are not a goal.** Never add a gap check.

## Restores and epochs

After a Neon point-in-time restore (or branch restore) the transaction-id counter can be behind the cursors devices
hold, so a device could wait for ids that never arrive. The operator bumps the epoch
(`scripts/sync-epoch.ts bump --target <t> --env-file <owner env> --execute --confirm <endpoint>`). Every client with an
old-epoch cursor gets `409 EPOCH_CHANGED` and pulls again from the start; pulls are idempotent and attempts are deduped
by event id on the device, so this is safe and deterministic. This is the only way a cursor is ever invalidated.

## When to abandon this design

If a future change needs per-learner write ordering, multi-statement reads, or reading the feed from a replica with a
different snapshot, stop and use a per-learner counter row (simple, contiguous, serialises one learner's writes) or
an outbox with a dedicated publisher. The horizon design is correct only under the rules above.
