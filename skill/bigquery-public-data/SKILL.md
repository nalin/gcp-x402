---
name: bigquery-public-data
description: >-
  Query Google BigQuery public datasets (bigquery-public-data) — USA names,
  census, Hacker News, GitHub, Stack Overflow, crypto, weather, COVID, Google
  Trends, and ~200 more — WITHOUT a Google Cloud account or billing setup. Pays
  per query in USDC via the x402 protocol through a hosted proxy. Use this
  whenever the user wants to analyze, explore, or pull data from a public
  dataset, mentions BigQuery, asks a data question that a large public dataset
  could answer (e.g. "most common baby names", "top Hacker News stories",
  "Ethereum transaction volume", "US census income by county"), or wants to run
  SQL against open data — even if they don't say "BigQuery" explicitly.
---

# Querying BigQuery public datasets (pay-per-query via x402)

This skill lets you run read-only SQL against Google's `bigquery-public-data`
datasets without any Google Cloud account. A hosted proxy runs each query and
charges a tiny per-query fee in USDC (on Base) over the x402 standard. You hold a
small crypto wallet; the tool pays automatically.

## The tool

Everything runs through one command (no install, no clone — `npx` fetches and
caches it; the very first call builds for ~60s, then it's fast):

```
npx -y github:nalin/gcp-x402 <command>
```

The first build prints npm deprecation warnings to stderr — harmless. To keep
output clean, prefix commands with `npm_config_loglevel=error`. The data you want
is always on stdout; the warnings never mix into it.

| Command | What it does |
| --- | --- |
| `wallet` | Show this project's wallet address, USDC balance, and how to fund it. |
| `estimate "<sql>"` | Dry-run a query → exact price + bytes scanned, **without paying or running**. |
| `query "<sql>"` | Run a read-only query, auto-pay the USDC price, print the result rows. |
| `datasets` | List popular public datasets + current pricing. |

> Public package — `npx` needs no auth. Node 18+ required.

## First use: fund the wallet

The wallet is generated automatically and is **per project** (`./.gcp-x402/wallet.json`).
A new wallet starts at **$0**, so before the first query:

1. Run `wallet` to get the address and balance.
2. If the balance is 0 (or too low), **show the user the address and ask them to
   fund it** with USDC on Base. For the testnet proxy, point them to the free
   faucet printed by the `wallet` command (https://faucet.circle.com → Base
   Sepolia). Don't try to fund it yourself — only the user can.
3. Re-run `wallet` to confirm funds arrived, then proceed.

If a `query` ever fails with an insufficient-funds / payment error, run `wallet`
and ask the user to top up — don't keep retrying against an empty wallet.

## Writing queries that are correct AND cheap

Cost is driven by **bytes scanned**, priced from a BigQuery dry run (~$6.25/TiB,
floored at a fraction of a cent). Two rules matter enormously:

- **Select only the columns you need.** BigQuery is columnar — `SELECT *` scans
  every column and can cost 100× more than `SELECT one_column`. Never `SELECT *`
  on a wide or large table.
- **`LIMIT` does NOT reduce cost.** It caps rows returned, not bytes scanned —
  the full column is still read. To scan less, filter on a **partition column**
  (often a date) or select fewer columns, not by adding `LIMIT`.

Other requirements (enforced by the proxy):

- **Read-only only.** `SELECT` queries against `bigquery-public-data` tables.
  DML/DDL (INSERT/UPDATE/CREATE/…) and non-public tables are rejected.
- **Fully qualify tables** as `` `bigquery-public-data.<dataset>.<table>` `` with
  backticks. Use **Standard SQL** (not Legacy).

**Strict Anti-Hallucination Rules:**
- **NEVER guess or hallucinate column names.** Before querying a table for the first time, you MUST run an `estimate` or `query` against the `INFORMATION_SCHEMA` to get the exact column names:
  `SELECT column_name, data_type FROM \`bigquery-public-data.<dataset>.INFORMATION_SCHEMA.COLUMNS\` WHERE table_name = "<table>"`
- **NEVER guess exact string values for filters** (e.g., event signatures, topics, names). If filtering by a specific text value, first run an exploratory query using `LIKE` with wildcards to find the exact format before aggregating. Example:
  `SELECT DISTINCT event_signature FROM \`bigquery-public-data.<dataset>.<table>\` WHERE LOWER(event_signature) LIKE '%transfer%' LIMIT 10`

**Always `estimate` first** for anything that might be large (any query over
`github_repos`, `crypto_*`, `wikipedia`, or `SELECT *`). Show the user the price,
and if it's more than a cent or two, confirm before running `query`.

## Typical workflow

1. Identify and Verify: Identify the dataset/table. You MUST query the `INFORMATION_SCHEMA.COLUMNS` to verify exact column names. If filtering by a specific text value (like a crypto event), run a small exploratory query with `LIKE` to find the exact string format.
2. Draft a minimal-column, filtered query.
3. `estimate` it → sanity-check the price.
4. `query` it → returns rows as JSON. Summarize the answer for the user; mention
   what it cost (printed on the summary line).

## Examples

**Example — most common baby names in California:**
```
npx -y github:nalin/gcp-x402 query \
  'SELECT name, SUM(number) AS total
   FROM `bigquery-public-data.usa_names.usa_1910_2013`
   WHERE state = "CA" GROUP BY name ORDER BY total DESC LIMIT 10'
```

**Example — price-check before a potentially big query:**
```
npx -y github:nalin/gcp-x402 estimate \
  'SELECT `by`, score FROM `bigquery-public-data.hacker_news.full` WHERE type = "story"'
```

**Example — check the wallet before starting:**
```
npx -y github:nalin/gcp-x402 wallet
```

## Notes

- Override the proxy with `PROXY_URL=...` if pointing at a self-hosted deployment;
  cap auto-pay per query with `MAX_PAYMENT_USD=...` (default $1.00).
- This same package is also an MCP server (run with no args) for MCP-native
  clients — see the repo README. The CLI above is the simplest path.
