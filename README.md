# ECON Agent Backend

A production-ready backend for an autonomous agent in the ECON ecosystem,
exposing a public HTTPS endpoint suitable for publishing in an agent's
ERC-8004 registration metadata on **Monad Testnet** (`eip155:10143`).

## What this is

This service implements the three endpoints ECON expects from an agent:

- `GET /health` — liveness + basic identity check
- `GET /metadata` — full ERC-8004 `registration-v1` metadata document
- `POST /run` — accepts a task, verifies payment against the on-chain
  `CreditVault`, executes the task, and settles credits

It does **not** trust anything a client says about its own credit balance.
Every `/run` request is checked against the `CreditVault` contract (or a
trusted indexer that mirrors its state) before any work is done, and
credits are settled back on-chain after execution.

## Quick start

```bash
npm install
cp .env.example .env
# fill in .env with real values (see "Environment variables" below)

npm run build
npm start

# or, for local development with auto-reload:
npm run dev
```

Run the test suite:

```bash
npm test              # single run
npm run test:watch    # watch mode
npm run test:coverage # with coverage report
```

Type-check without emitting:

```bash
npm run typecheck
```

## Project structure

```
src/
  server.ts                 Express app factory + production entrypoint
  config.ts                 Loads and validates environment variables
  types.ts                  Shared TypeScript types
  logger.ts                 Structured logging (pino) with secret redaction

  agent/
    AgentRuntime.ts          Task execution — the extension point for this
                             agent's actual capability (see below)
    TaskValidator.ts         Zod-based request validation
    metadata.ts              Builds ERC-8004 registration-v1 metadata

  credits/
    CreditVerifier.ts        Reads CreditVault on-chain state, verifies
                             reservations + settlement transactions
    CreditSettlement.ts      Calls CreditVault to consume/release credits

  store/
    IdempotencyStore.ts      Prevents a reservationId from being processed
                             (and charged) more than once

  middleware/
    cors.ts                  Origin allow-list for the ECON frontend
    rateLimit.ts              Rate limiting
    requestId.ts              Request ID propagation
    timeout.ts                 Global request timeout safety net

  routes/
    health.ts, metadata.ts, run.ts

tests/
  unit/                     TaskValidator, CreditVerifier, CreditSettlement,
                             IdempotencyStore
  integration/              Full HTTP-level tests for /health, /metadata,
                             /run (success, failure, timeout, duplicate
                             request, invalid payment, insufficient credits)
```

## The one thing you must adapt before going live

**`AgentRuntime.execute()`** (`src/agent/AgentRuntime.ts`) contains a stub
implementation. It demonstrates the correct contract (task in, structured
result out) but does not implement any real capability. Replace it with
whatever this agent actually does — call a model, run a data pipeline,
process a document, etc. It never `eval`s or executes the task string as
code; treat task content as opaque data for your own logic to interpret.

**The `CreditVault` ABI** used in `CreditVerifier.ts` and
`CreditSettlement.ts` is a documented, minimal assumption about the
contract's interface (`getReservation`, `settleReservation`,
`releaseReservation`). Reconcile it against the actual deployed ECON
CreditVault ABI before pointing this at mainnet or a real testnet
deployment — function names, argument order, and return tuple shape must
match exactly.

## Environment variables

See `.env.example` for the full list with descriptions. The important ones:

| Variable | Purpose |
|---|---|
| `AGENT_ID` | Must match the ERC-8004 agentId registered on-chain and referenced by clients |
| `AGENT_CONTROLLER` | The agent's registered controller wallet (informational) |
| `MONAD_RPC_URL`, `MONAD_CHAIN_ID` | Monad Testnet RPC endpoint and chain ID (`10143`) |
| `CREDIT_VAULT_ADDRESS` | The CreditVault contract address payments must reference |
| `AGENT_SIGNER_PRIVATE_KEY` | This agent's own operational key, authorized to settle/release reservations. **Not** a user key. Use a secrets manager/KMS in production. |
| `ECON_FRONTEND_ORIGIN` | Comma-separated allow-list of origins for CORS |
| `MAX_TASK_SIZE` | Max bytes for the `task` field |
| `REQUEST_TIMEOUT_MS` | Hard timeout for task execution |
| `PUBLIC_ENDPOINT` | The public HTTPS URL published in ERC-8004 metadata |

The server refuses to start if a required variable is missing — this is
intentional so misconfiguration never reaches production silently.

## Registering this agent

Publish the object returned by `GET /metadata` as this agent's ERC-8004
`registration-v1` service metadata, with `services[0].endpoint` set to your
public HTTPS `/run` URL (e.g. `https://agent.example.com/run`) and
`network` set to `eip155:10143`.

## The `/run` request lifecycle

1. **Validate** the request body: task present and within `MAX_TASK_SIZE`,
   `requester` is a valid EVM address, `network` is `eip155:10143`,
   `agentId` matches this backend, `payment.vault` matches
   `CREDIT_VAULT_ADDRESS`. Failures here return `400` with
   `creditsConsumed: 0, creditsReturned: 0` — no reservation was ever
   confirmed, so nothing is owed either way.

2. **Idempotency check.** If `payment.reservationId` was already fully
   processed, the stored response is replayed with `200` (safe retries).
   If another request currently holds the claim on that reservationId,
   this request is rejected with `409` — it does not wait or retry
   automatically.

3. **Verify payment on-chain** via `CreditVerifier`: the reservation must
   exist, belong to this agent and this requester, not be consumed or
   released, not be expired, and reserve at least this agent's
   `priceCredits`. The settlement transaction hash must be a real,
   successful, on-chain transaction sent to the configured vault. Any
   failure here returns `402` with no credits consumed or returned (the
   reservation was never valid to begin with).

4. **Execute the task** via `AgentRuntime`, bounded by
   `REQUEST_TIMEOUT_MS`.

5. **On success**, `CreditSettlement.settleConsumed` charges exactly this
   agent's price and returns any surplus reservation on-chain. Response:
   `200`, `success: true`.

6. **On execution failure or timeout** (after a valid reservation was
   already confirmed), `CreditSettlement.releaseFull` returns the entire
   reservation to the requester on-chain. Response: `500` (failure) or
   `504` (timeout), `success: false`, `creditsReturned` equal to the full
   reserved amount.

Every outcome (success or failure) is recorded in the idempotency store so
a retried request with the same `reservationId` gets the same answer
instead of being charged twice.

## Security

- **HTTPS**: terminate TLS in front of this service (e.g. a reverse proxy
  or platform load balancer) — the app itself speaks plain HTTP.
- **CORS**: restricted to the explicit allow-list in
  `ECON_FRONTEND_ORIGIN`; requests with no `Origin` header (server-to-server
  calls, health checks) are allowed through since CORS only governs browser
  behavior.
- **Validation**: all `/run` bodies are validated with Zod
  (`TaskValidator.ts`) before anything else runs.
- **Rate limiting**: `POST /run` is limited more strictly than read-only
  routes (`middleware/rateLimit.ts`); tune the limits for your expected
  traffic.
- **Timeouts**: a global request timeout (`middleware/timeout.ts`) plus an
  explicit execution timeout inside `/run` so a slow task can't hold a
  reservation (or a connection) open indefinitely.
- **Max task size**: enforced both at the JSON body-parser level and by the
  Zod schema.
- **Idempotency**: keyed on `reservationId`, so retries and duplicate
  submissions cannot consume credits twice.
- **No private key exposure**: this service never accepts, stores, or logs
  a user's wallet private key. `AGENT_SIGNER_PRIVATE_KEY` is this agent's
  own operational key, used only to call `CreditVault` methods it is
  authorized to call, and is excluded from logs via `logger.ts`'s
  redaction config.
- **No arbitrary code execution**: task content is treated as opaque data,
  never `eval`'d or executed as a script.
- **Logging**: `logRunOutcome` logs exactly requestId, wallet, agentId,
  status, and credit usage — never the task content, payment payload, or
  any secret.

## Known limitations / production hardening notes

- **`IdempotencyStore`** is in-memory, so it only guarantees idempotency
  within a single running process. For a horizontally scaled deployment,
  back it with Redis (`SETNX` on `reservationId`) or a database unique
  constraint on `reservationId`.
- **`CreditVault` ABI** is a documented assumption — see above.
- **Rate limiting** here is per-process and keyed by IP by default; for
  multi-instance deployments, use a shared store (e.g.
  `rate-limit-redis`) or key by wallet address if that fits your abuse
  model better.
- **No dummy data**: this implementation performs real on-chain reads via
  `ethers.js` for reservation verification and real on-chain writes for
  settlement — there are no fake balances, simulated payment successes, or
  hardcoded transaction hashes anywhere in the request path. The unit
  tests substitute fakes for these on-chain calls (so they don't require a
  live RPC connection); the integration tests substitute the same
  `CreditVerifier`/`CreditSettlement` interfaces with controllable fakes
  for the same reason. Production wiring in `server.ts` uses the real
  `ethers.js`-backed implementations.
#   E C O N - B a c k e n d  
 