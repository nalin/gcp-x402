# gcp.sh — an x402 proxy for BigQuery public datasets

> Query BigQuery public datasets from an agent that has **no Google Cloud account** —
> by paying per query in USDC over the [x402](https://x402.org) standard.

## Problem

To touch any BigQuery data today you need a Google Cloud project **with a billing
account attached**, even for the ~200 free public datasets. The data is free to
store, but BigQuery bills *query compute* (~$6.25 / TiB scanned, US on-demand) to
whichever project runs the job. An autonomous agent has no GCP project, no billing
account, and no way to get one without a human + a credit card.

`gcp.sh` removes that prerequisite. It is a **metered reseller of BigQuery compute**:
the proxy owns the GCP billing account, runs the agent's query, and charges the agent
in USDC for exactly what the query cost (plus margin), settled onchain via x402.

## Why this isn't a stock x402 paywall

Every x402 tutorial uses a *fixed* per-route price (`price: "$0.01"`). BigQuery's cost
is **unknowable until you analyze the specific query**. So the proxy is not a flat
paywall — it is **dynamic, per-query pricing driven by a BigQuery dry run**. That dry
run is the keystone of the whole design:

- A `dryRun` job returns `totalBytesProcessed` — the *exact* bytes the real query will
  be billed for — **for free, in well under a second**, without running anything.
- It also returns `referencedTables`, which we use as an allowlist oracle (cleaner and
  safer than parsing SQL ourselves).

So the dry run is simultaneously our **pricing oracle** and our **safety oracle**.

## Architecture

```
┌─────────────────────────┐         x402 (HTTP 402 + USDC on Base)        ┌──────────────────────────┐
│  Agent                  │ ───────────────────────────────────────────► │  gcp.sh proxy (Vercel)   │
│  ┌───────────────────┐  │   POST /api/query  { sql }                    │                          │
│  │ gcp.sh MCP client │  │ ◄─── 402 + signed quote (bytes, price, exp) ─ │  1. dry-run  → bytes      │
│  │  • viem wallet    │  │                                               │  2. allowlist tables      │
│  │  • x402-fetch     │  │   POST /api/query  + X-PAYMENT (EIP-3009)      │  3. price  = f(bytes)     │
│  └───────────────────┘  │ ───────────────────────────────────────────► │  4. verify payment        │
│                         │                                               │  5. run w/ byte cap       │
│                         │ ◄────────── 200 + rows + X-PAYMENT-RESPONSE ── │  6. settle actual cost    │
└─────────────────────────┘                                               └──────────┬───────────────┘
                                                                                     │ service account
                                                                                     │ (bigquery.jobUser)
                                                                          ┌──────────▼───────────────┐
                                                                          │ BigQuery                 │
                                                                          │ bigquery-public-data     │
                                                                          └──────────────────────────┘
```

Two packages, both in this repo:

| Package  | Role             | Runs where                    | Holds                                   |
| -------- | ---------------- | ----------------------------- | --------------------------------------- |
| `proxy/` | x402 **server**  | Vercel (Next.js, Node runtime)| GCP service-account creds, receiving wallet address, quote secret |
| `mcp/`   | x402 **client**  | Alongside the agent (stdio MCP)| The agent's funded USDC wallet (private key) |

The agent installs the MCP server. Everything else — pricing, payment, BigQuery — is
behind the proxy boundary.

## The request flow (the part no off-the-shelf middleware gives you)

A single endpoint, `POST /api/query`, drives the standard x402 two-call handshake. The
non-standard part is that **the price is computed per request from a dry run**.

### Call 1 — no payment yet → `402`

```
POST /api/query   { "sql": "SELECT ... FROM `bigquery-public-data.usa_names...`" }
```

1. **Dry-run** the SQL → `totalBytesProcessed` (bytes), `referencedTables`.
2. **Allowlist**: every referenced table's `projectId` must be `bigquery-public-data`.
   Reject DML/DDL/scripting (read-only only). Otherwise → `403`.
3. **Price**: `price = max(bytes, 10MB·tables) · USD_PER_BYTE · MARKUP`, floored at
   `$PRICE_FLOOR` (so tiny queries still clear settlement overhead). See *Economics*.
4. **Quote**: HMAC-sign `{ qhash = sha256(sql), bytes, price, exp = now+60s }` and
   return a `402` whose `accepts[0]` is an x402 `exact`-scheme PaymentRequirement with
   `maxAmountRequired = price` (in USDC base units). The signed quote rides in
   `accepts[0].extra.quote` so the client can **display the cost before paying**.

### Call 2 — same body + `X-PAYMENT` → `200`

The x402 client (`x402-fetch`) reads the `402`, signs an **EIP-3009
`transferWithAuthorization`** for `maxAmountRequired` USDC to the proxy's `payTo`, and
**retries the identical request** with the `X-PAYMENT` header.

5. **Re-dry-run** the body (free) and recompute the price. This is the authoritative
   anti-tamper check — see *Security* below.
6. **Verify** the payment against the freshly-computed requirements (via the
   facilitator's `/verify`). On failure → `402` again (re-quote).
7. **Execute** the real job with `maximumBytesBilled = max(bytes, 10MB·tables)` as a
   hard backstop. A job that would exceed the cap **fails without incurring a charge**.
8. **Settle** onchain (facilitator `/settle`) — *only after the query succeeds*, so a
   failed query never charges the agent. Return rows + `X-PAYMENT-RESPONSE`.

> Ordering is deliberate: **verify → execute → settle**. Verify is cheap and confirms
> the payment is good before we spend BigQuery compute; settle (the actual fund
> movement) happens last, gated on a successful query. This mirrors auth/capture.

## Security — why an agent can't cheat the quote

The attack the whole design must prevent: *get a cheap quote on a 1 MB query, then swap
in a petabyte `SELECT *` on the paid retry.*

Three independent layers stop it:

1. **Re-dry-run on the paid call (authoritative).** The proxy never trusts call 1. It
   re-prices the *actual* body it's about to run. With the `exact` scheme the payment
   authorizes exactly `maxAmountRequired`; if the body grew, the recomputed price no
   longer matches the authorized amount and the facilitator's `verify` rejects it.
   Because this is stateless (no server-side quote store), it scales trivially on
   Vercel.
2. **Signed quote (`qhash`).** The HMAC quote binds a price to `sha256(sql)` with a
   60s expiry. It's tamper-evident and lets the client confirm it's paying for the
   query it asked about. (Server enforcement is the re-dry-run; the token is the
   client's receipt.)
3. **`maximumBytesBilled` backstop.** Belt-and-suspenders: even if layers 1–2 had a
   hole, the job is hard-capped at the quoted byte count and fails *free* if exceeded.

**Sandboxing:** read-only only (reject DML/DDL/scripting), enforce the
`bigquery-public-data` allowlist from the dry run's `referencedTables`, set a statement
timeout, and give the service account nothing beyond `bigquery.jobUser` on the billing
project + read on the public project. No `bigquery.dataEditor`, no other datasets.

## Economics

- **Cost to us:** `~$6.25 / TiB` scanned (US on-demand). 1 GB ≈ $0.006, 100 GB ≈ $0.61.
- **Free tier is margin, not price.** The first 1 TiB/month is free *per billing
  account* — a busy proxy burns that in days. Price at the marginal rate; treat the
  free terabyte as upside.
- **Floor clears overhead.** The Coinbase facilitator is free for 1k tx/month then
  `$0.001`/tx; USDC-on-Base settlement is cheap. A `$0.002–$0.01` floor keeps a 1 MB
  query from running at a loss.
- **Defaults:** `MARKUP = 2.0`, `PRICE_FLOOR = $0.002`, `USD_PER_BYTE = 6.25 / 2^40`,
  10 MB/table minimum (matches BigQuery's own per-table billing minimum).

## `exact` today, `upto` tomorrow

x402 V2 added an **`upto` scheme**: the client authorizes a *maximum*, the server does
the work, then settles the **actual** amount. That is the theoretically perfect fit for
metered compute — on a BigQuery **cache hit** the real query bills 0 bytes, and `upto`
would let us charge ~0 instead of the quoted estimate.

We ship **`exact`** as the baseline because it's supported by every facilitator
(incl. Coinbase) and is *correct* for immutable public datasets, where the dry-run byte
count equals the billed byte count. The pricing/settlement code is factored behind
`lib/x402.ts` and `lib/pricing.ts` so swapping in `upto` (verify at the quoted max,
read `job.totalBytesBilled` after execution, settle the real cost) is a localized
change. Tracked as a follow-up.

## Known sharp edges (documented, not hand-waved)

- **Dry-run vs actual divergence.** For static public datasets they match. Cache hits
  or a table that mutates between quote and execute can shift bytes; the byte cap
  absorbs the cost and a cap-fail just re-quotes.
- **Result delivery.** You can't stuff a 2 GB result set into one HTTP response. The
  proxy caps inline rows (`MAX_INLINE_ROWS`, default 10k) and returns a `truncated`
  flag. Large-result GCS export + signed URL (egress folded into price) is a
  documented follow-up.
- **Terms of service.** Reselling BigQuery compute may bump Google Cloud terms on
  sublicensing/reselling, and individual public datasets carry their own licenses.
  Worth a legal read before pointing real money at it. (Google itself is a Premier
  member of the x402 Foundation, so ecosystem alignment is at least pointed the right
  way.) **Default config runs on `base-sepolia` testnet** so nothing here moves real
  funds until you explicitly flip to mainnet.

## Settlement defaults

- **Network:** Base (USDC). Default `base-sepolia` (testnet) until you set mainnet.
- **Asset:** USDC (6 decimals). EIP-712 domain `{ name: "USDC", version: "2" }`.
- **Facilitator:** configurable REST endpoint (Coinbase / x402.org public facilitator);
  the proxy calls `/verify` and `/settle` directly so it isn't pinned to one SDK.
