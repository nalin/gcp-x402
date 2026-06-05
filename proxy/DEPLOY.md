# Deploying the gcp-x402 proxy to Cloud Run

The proxy is a Next.js app that builds to a standalone server (`output: "standalone"`)
and ships as a container (`Dockerfile`). On Cloud Run it authenticates to BigQuery via
its **attached service account** — so there is **no `GCP_SERVICE_ACCOUNT_JSON` key** to
manage (the big win of running on GCP).

Project: **`gcp-x402`** · Region used below: **`us-central1`** (close to the
`bigquery-public-data` US multi-region).

## One-time setup

```bash
# 0) Authenticate (interactive) and select the project
gcloud auth login
gcloud config set project gcp-x402

# 1) Enable the APIs the deploy needs
gcloud services enable \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  bigquery.googleapis.com secretmanager.googleapis.com

# 2) Least-privilege runtime service account: can run BigQuery jobs, nothing else.
gcloud iam service-accounts create gcp-x402-run \
  --display-name="gcp-x402 Cloud Run runtime"
gcloud projects add-iam-policy-binding gcp-x402 \
  --member="serviceAccount:gcp-x402-run@gcp-x402.iam.gserviceaccount.com" \
  --role="roles/bigquery.jobUser"

# 3) Quote-signing secret in Secret Manager (instead of a plaintext env var)
printf '%s' "$(openssl rand -base64 48)" | \
  gcloud secrets create gcp-x402-quote-secret --data-file=-
gcloud secrets add-iam-policy-binding gcp-x402-quote-secret \
  --member="serviceAccount:gcp-x402-run@gcp-x402.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## Deploy (and redeploy)

```bash
# Sync the skill into the image so GET /skill serves the current version.
./scripts/sync-skill.sh

cd proxy
gcloud run deploy gcp-x402 \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --service-account gcp-x402-run@gcp-x402.iam.gserviceaccount.com \
  --cpu 1 --memory 512Mi --timeout 120 \
  --set-secrets QUOTE_SECRET=gcp-x402-quote-secret:latest \
  --set-env-vars '^|^X402_NETWORK=base-sepolia|PAY_TO_ADDRESS=0x90e4071A1b7b1fc9A5d0b7EA6bEB1174F847F079|FACILITATOR_URL=https://x402.org/facilitator|GCP_PROJECT_ID=gcp-x402|MAX_BYTES_PER_QUERY=1073741824'
```

> The `^|^` prefix tells gcloud to split env vars on `|` instead of `,`, so values
> containing commas are safe. `--source .` builds the `Dockerfile` via Cloud Build —
> no local Docker needed. The first run may prompt to create an Artifact Registry repo;
> accept it.

Get the URL:

```bash
gcloud run services describe gcp-x402 --region us-central1 --format='value(status.url)'
```

## After it's live

1. **Smoke test** (no payment — should be `402` with a price, proving BigQuery auth works
   via the attached SA):
   ```bash
   URL=$(gcloud run services describe gcp-x402 --region us-central1 --format='value(status.url)')
   curl -i -X POST "$URL/api/query" -H 'content-type: application/json' \
     -d '{"sql":"SELECT name FROM `bigquery-public-data.usa_names.usa_1910_2013` WHERE state=\"CA\" LIMIT 5"}'
   ```
2. **Point the client at it** — set the default `PROXY_URL` (in `src/config.ts`) and the
   docs/skill references to this URL, or map a custom domain:
   ```bash
   gcloud run domain-mappings create --service gcp-x402 --domain <your.domain> --region us-central1
   ```
3. **Decommission Vercel** once the Cloud Run URL is verified and clients are switched.

## Notes

- **Billing:** queries now bill to project `gcp-x402` (set as `GCP_PROJECT_ID`). Make sure
  that project has a billing account.
- **Mainnet:** flip `X402_NETWORK=base` and point `FACILITATOR_URL` at a mainnet
  facilitator when ready — just change the env vars and redeploy.
- **Scales to zero:** Cloud Run idles at $0 when there's no traffic.
