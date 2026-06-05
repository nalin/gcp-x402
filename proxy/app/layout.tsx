export const metadata = {
  title: "gcp-x402 — x402 proxy for BigQuery public datasets",
  description:
    "Query BigQuery public datasets from an agent with no Google Cloud account. Pay per query in USDC via x402.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
