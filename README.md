# gcp-x402

**Query BigQuery public datasets from an agent that has no Google Cloud account —
pay per query in USDC over [x402](https://x402.org).**

BigQuery hosts ~200 free public datasets, but to touch any of them you need a GCP
project *with a billing account*, because BigQuery bills query compute
(~$6.25/TiB scanned) to whoever runs the job. An autonomous agent has neither.

`gcp-x402` is a **metered reseller of BigQuery compute**. The proxy owns the GCP billing
account, runs your query, and charges you in USDC for exactly what it cost (plus a
margin), settled onchain via x402. The price for each query is computed from a BigQuery
**dry run** before you pay — so it's a *dynamic* paywall, not a flat one.

See [DESIGN.md](./DESIGN.md) for the full architecture and threat model.

```
agent ──POST /api/query──▶ proxy ──dry-run──▶ price ──402──▶ agent pays USDC ──▶ proxy runs query (byte-capped) ──▶ rows
```

## Repo layout

| Path      | What it is                                                                 |
| --------- | ------------------------------------------------------------------------- |
| `src/`    | The agent-side MCP server (repo root package). Holds the agent's USDC wallet, auto-pays. |
| `proxy/`  | The x402 server (Next.js, deploy to Vercel). Holds GCP creds + receiving wallet. |

The MCP client lives at the repo root so it installs in one line with
`npx -y github:nalin/gcp-x402` — no clone, no build step.

---

## Part 1 — Deploy the proxy

### Prerequisites

1. **A GCP project with a billing account.** This pays Google for query compute.
2. **A service account** in that project with **only** `roles/bigquery.jobUser`
   (no data roles — the public datasets are world-readable). Download its JSON key.
3. **A receiving wallet** address (where query revenue lands).
4. **A quote secret:** `openssl rand -base64 48`.

### Run locally

```bash
cd proxy
cp .env.example .env.local      # fill in the values
npm install
npm run dev                     # http://localhost:3000
```

Smoke-test the pricing path (no payment needed — you should get a `402` with a price):

```bash
curl -i -X POST http://localhost:3000/api/query \
  -H 'content-type: application/json' \
  -d '{"sql":"SELECT name, number FROM `bigquery-public-data.usa_names.usa_1910_2013` WHERE state=\"CA\" ORDER BY number DESC LIMIT 10"}'
```

### Deploy to Google Cloud Run

The proxy ships as a container (`proxy/Dockerfile`, Next.js `output: "standalone"`) and
runs on **Cloud Run**, where it authenticates to BigQuery via its **attached service
account** — no `GCP_SERVICE_ACCOUNT_JSON` key to manage. Full runbook:
[`proxy/DEPLOY.md`](proxy/DEPLOY.md). The short version:

```bash
cd proxy
gcloud run deploy gcp-x402 --source . --region us-central1 --allow-unauthenticated \
  --service-account gcp-x402-run@gcp-x402.iam.gserviceaccount.com \
  --set-secrets QUOTE_SECRET=gcp-x402-quote-secret:latest \
  --set-env-vars '^|^X402_NETWORK=base-sepolia|PAY_TO_ADDRESS=0x...|GCP_PROJECT_ID=gcp-x402|FACILITATOR_URL=https://x402.org/facilitator|MAX_BYTES_PER_QUERY=1073741824'
```

> **Money safety:** the default `X402_NETWORK=base-sepolia` settles on testnet. Nothing
> moves real funds until you switch it to `base` and point `FACILITATOR_URL` at a
> mainnet facilitator (e.g. Coinbase CDP).

---

## Part 2 — Give an agent access

Two ways, same backend. The **skill** is the simplest and teaches the agent how to use
it well; the **MCP server** exposes structured tools for MCP-native clients.

### Option A — as a skill (simplest, Claude Code)

Drop the skill into the **project's** skills directory — that's the whole install. Run
this from the root of the project you want to enable (installs per-project, not
machine-wide):

```bash
mkdir -p .claude/skills/bigquery-public-data && \
curl -fsSL https://raw.githubusercontent.com/nalin/gcp-x402/master/skill/bigquery-public-data/SKILL.md \
  -o .claude/skills/bigquery-public-data/SKILL.md
```

(Use `~/.claude/skills` instead of `.claude/skills` only if you deliberately want it
available to every project on the machine.)

The skill triggers whenever the user asks a data question a public dataset could answer.
Under the hood it runs the same package as a CLI via `npx` — no separate install:

```bash
npx -y github:nalin/gcp-x402 wallet            # show address + balance
npx -y github:nalin/gcp-x402 estimate "<sql>"  # price, no charge
npx -y github:nalin/gcp-x402 query "<sql>"     # run + pay, returns rows
```

The agent handles funding prompts, cost-checking, and SQL rules from the skill's context.

### Option B — as an MCP server

No clone, no build — `npx` pulls the server straight from the public GitHub repo and runs it.

**Claude Code** (one line):

```bash
claude mcp add gcp-x402 \
  --env PROXY_URL=https://gcp-x402.vercel.app \
  --env MAX_PAYMENT_USD=1.00 \
  -- npx -y github:nalin/gcp-x402
```

**Claude Desktop / Cursor / any MCP client** — add to the `mcpServers` config block:

```json
{
  "mcpServers": {
    "gcp-x402": {
      "command": "npx",
      "args": ["-y", "github:nalin/gcp-x402"],
      "env": {
        "PROXY_URL": "https://gcp-x402.vercel.app",
        "MAX_PAYMENT_USD": "1.00"
      }
    }
  }
}
```

The client **generates its own wallet on first run, per project** (saved to
`./.gcp-x402/wallet.json` in the project, `chmod 600`, auto-`.gitignore`d) — no key to
paste. On startup it prints the new address; the user just sends Base USDC to it. The
agent can show the address + balance anytime via the `wallet_info` tool. Each project
gets its own wallet, so a fresh project = a fresh first-run/funding flow.

To share one wallet across projects, set `WALLET_FILE` to an absolute path (e.g.
`~/.gcp-x402/wallet.json`). To bring your own key, set `WALLET_PRIVATE_KEY`.

### Tools the agent gets

| Tool                    | What it does                                                            |
| ----------------------- | ---------------------------------------------------------------------- |
| `wallet_info`           | Show the agent's wallet address, live USDC balance, and how to fund it.|
| `bigquery_estimate`     | Dry-run a query → exact price + bytes, **without paying or running**.   |
| `bigquery_query`        | Run a query, auto-pay the per-query USDC price, return rows.            |
| `list_public_datasets`  | Curated list of popular public datasets + current pricing (free).      |

### First-run UX

1. User adds the MCP server in a project → a project-local wallet is generated, address printed.
2. User (or agent via `wallet_info`) shows the address → user sends Base USDC.
3. Agent calls `bigquery_query` → it auto-pays per query from that wallet.

Each project has its own wallet (`./.gcp-x402/wallet.json`). The client refuses to
auto-pay more than `MAX_PAYMENT_USD` for any single query.

---

## How a query is priced and secured

1. **Dry run** returns the exact bytes the query will bill and the tables it touches.
2. **Allowlist**: every table must be in `bigquery-public-data`; reads only (no DML/DDL).
3. **Price** = `max(bytes, 10MB·tables) · $6.25/TiB · markup`, floored at `$0.002`.
4. The paid retry is **re-priced from the actual body**, so an agent can't quote a tiny
   query and then run a huge one — the payment authorizes only the quoted amount.
5. The real job runs with `maximum_bytes_billed` set to the quote, so a runaway query
   **fails free** instead of billing the proxy.
6. Settlement happens **only after the query succeeds** — a failed query never charges.

## Status & follow-ups

- ✅ Dynamic per-query pricing, allowlist, byte cap, verify→execute→settle flow, MCP client.
- ⏳ `upto` scheme (charge *actual* billed bytes incl. cache hits — see DESIGN.md).
- ⏳ Large-result delivery via GCS export + signed URL.
- ⚠️ Reselling BigQuery compute may implicate Google Cloud ToS / dataset licenses —
  review before pointing real money at it.
