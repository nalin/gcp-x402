// GET /guide — the rich HTML user guide, served from the deployment.
// Reads public/guide.html (copied into the container image).

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

export async function GET() {
  try {
    const html = await readFile(join(process.cwd(), "public", "guide.html"), "utf8");
    return new NextResponse(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "guide not bundled in this deployment" }, { status: 404 });
  }
}
