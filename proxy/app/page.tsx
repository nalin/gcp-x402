export default function Home() {
  return (
    <main
      style={{
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        maxWidth: 720,
        margin: "0 auto",
        padding: "4rem 1.5rem",
        lineHeight: 1.6,
        color: "#1a1a1a",
      }}
    >
      <h1 style={{ fontSize: "1.8rem", marginBottom: 0 }}>gcp-x402</h1>
      <p style={{ color: "#555", marginTop: ".25rem" }}>
        An <strong>x402</strong> proxy for BigQuery public datasets. Query them
        from an agent with no Google Cloud account — pay per query in USDC.
      </p>

      <h2 style={{ fontSize: "1rem", marginTop: "2rem" }}>How it works</h2>
      <ol style={{ color: "#333", paddingLeft: "1.2rem" }}>
        <li>
          <code>POST /api/query</code> with <code>{`{ "sql": "SELECT ..." }`}</code>.
        </li>
        <li>
          First call returns <code>402 Payment Required</code> with a price
          computed from a BigQuery dry run.
        </li>
        <li>
          Your x402 client pays in USDC and retries; you get rows back. You are
          only charged if the query succeeds.
        </li>
      </ol>

      <h2 style={{ fontSize: "1rem", marginTop: "2rem" }}>Endpoints</h2>
      <ul style={{ color: "#333", paddingLeft: "1.2rem" }}>
        <li>
          <code>POST /api/query</code> — run a read-only query (x402-gated).
        </li>
        <li>
          <code>GET /api/datasets</code> — free list of popular public datasets
          and current pricing.
        </li>
      </ul>

      <p style={{ color: "#888", marginTop: "2.5rem", fontSize: ".85rem" }}>
        Read-only · public datasets only · priced per byte scanned. Not
        affiliated with Google.
      </p>
    </main>
  );
}
