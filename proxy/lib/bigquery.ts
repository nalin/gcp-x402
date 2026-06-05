// BigQuery access: the dry-run pricing/safety oracle + the real, capped execute.

import { BigQuery } from "@google-cloud/bigquery";
import { config } from "./config";

let _client: BigQuery | null = null;

function client(): BigQuery {
  if (_client) return _client;
  const opts: ConstructorParameters<typeof BigQuery>[0] = {
    projectId: config.gcpProjectId,
    location: config.bqLocation,
  };
  if (config.gcpCredentialsJson) {
    opts.credentials = JSON.parse(config.gcpCredentialsJson);
  }
  _client = new BigQuery(opts);
  return _client;
}

export interface TableRef {
  projectId: string;
  datasetId: string;
  tableId: string;
}

export interface DryRunResult {
  bytes: number;
  referencedTables: TableRef[];
  statementType: string | undefined;
}

/** Reasons a query is rejected before any pricing/payment. */
export class QueryRejected extends Error {
  constructor(
    message: string,
    readonly status: number = 403,
  ) {
    super(message);
    this.name = "QueryRejected";
  }
}

/**
 * Price + safety oracle. Returns the exact bytes the real query would bill and
 * the tables it touches — without running anything. Throws QueryRejected for
 * anything that isn't a read-only query over allowlisted public data.
 */
export async function dryRun(sql: string): Promise<DryRunResult> {
  let job;
  try {
    [job] = await client().createQueryJob({
      query: sql,
      dryRun: true,
      useLegacySql: false,
    });
  } catch (e) {
    // A dry run that fails is almost always a syntax/permission error in the
    // user's SQL — surface it as a 400, not a 500.
    throw new QueryRejected(`Query did not validate: ${(e as Error).message}`, 400);
  }

  const stats = job.metadata?.statistics ?? {};
  const quergyStats = stats.query ?? {};

  const statementType: string | undefined = quergyStats.statementType;
  // Read-only only: SELECT is the statement type for plain reads.
  if (statementType && statementType !== "SELECT") {
    throw new QueryRejected(
      `Only read-only SELECT queries are allowed (got ${statementType}). DML/DDL/scripting are rejected.`,
    );
  }

  const referencedTables: TableRef[] = (quergyStats.referencedTables ?? []).map(
    (t: { projectId: string; datasetId: string; tableId: string }) => ({
      projectId: t.projectId,
      datasetId: t.datasetId,
      tableId: t.tableId,
    }),
  );

  if (referencedTables.length === 0) {
    throw new QueryRejected(
      "Query references no tables. Only queries over allowlisted public datasets are supported.",
    );
  }

  // Allowlist: every referenced table must live in an allowed project.
  for (const t of referencedTables) {
    if (!config.allowedProjects.includes(t.projectId)) {
      throw new QueryRejected(
        `Table ${t.projectId}.${t.datasetId}.${t.tableId} is not in an allowed project ` +
          `(${config.allowedProjects.join(", ")}). Only public datasets are queryable.`,
      );
    }
  }

  const bytes = Number(stats.totalBytesProcessed ?? 0);
  if (bytes > config.maxBytesPerQuery) {
    throw new QueryRejected(
      `Query would scan ${bytes} bytes, over the ${config.maxBytesPerQuery}-byte limit.`,
      413,
    );
  }

  return { bytes, referencedTables, statementType };
}

export interface ExecuteResult {
  rows: Record<string, unknown>[];
  truncated: boolean;
  totalRows: number;
  bytesBilled: number;
  cacheHit: boolean;
}

/**
 * Run the real query with a hard byte cap. The cap makes a runaway query fail
 * *free* rather than bill us. Returns up to `maxInlineRows` rows.
 */
export async function execute(sql: string, maxBytesBilled: number): Promise<ExecuteResult> {
  // Add headroom so a benign dry-run/actual rounding delta doesn't trip the cap,
  // while keeping at least a 10 MB cushion for very small queries.
  const cap = Math.ceil(
    Math.max(maxBytesBilled * config.byteCapBuffer, maxBytesBilled + config.minBytesPerTable),
  );
  const [job] = await client().createQueryJob({
    query: sql,
    useLegacySql: false,
    maximumBytesBilled: String(cap),
    jobTimeoutMs: config.queryTimeoutMs,
  });

  const [rows] = await job.getQueryResults({ maxResults: config.maxInlineRows });

  const stats = job.metadata?.statistics ?? {};
  const bytesBilled = Number(stats.query?.totalBytesBilled ?? stats.totalBytesProcessed ?? 0);
  const cacheHit = Boolean(stats.query?.cacheHit);
  const totalRows = Number(job.metadata?.statistics?.query?.numDmlAffectedRows ?? rows.length);

  return {
    rows: rows as Record<string, unknown>[],
    truncated: rows.length >= config.maxInlineRows,
    totalRows: Math.max(totalRows, rows.length),
    bytesBilled,
    cacheHit,
  };
}
