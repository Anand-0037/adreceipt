import type { NextRequest } from "next/server";

const apiOrigin =
  process.env.ADRECEIPT_API_ORIGIN?.replace(/\/$/, "") ??
  (process.env.ADRECEIPT_API_HOSTPORT
    ? `http://${process.env.ADRECEIPT_API_HOSTPORT}`
    : "http://localhost:8787");

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

async function proxy(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  const target = new URL(path.map(encodeURIComponent).join("/"), `${apiOrigin}/`);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  for (const name of ["accept", "content-type", "authorization"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const forwardedFor = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip");
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);

  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(path.at(-1) === "settle" ? 150_000 : 30_000),
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      },
    });
  } catch {
    return Response.json(
      {
        error: "backend-unavailable",
        message: "The AdReceipt API could not be reached.",
      },
      { status: 502 },
    );
  }
}

export const dynamic = "force-dynamic";

export const GET = proxy;
export const POST = proxy;
export const OPTIONS = proxy;
