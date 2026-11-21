import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 1024 * 1024;
const TIMEOUT_MS = 10000;
const ALLOWED_ROOTS = new Set(["health", "api"]);

type ProxyContext = { params: { path: string[] } };

function proxyError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
  });
}

async function proxy(request: NextRequest, context: ProxyContext): Promise<Response> {
  const segments = context.params.path ?? [];
  if (!segments.length || !ALLOWED_ROOTS.has(segments[0])) {
    return proxyError("Unknown backend route.", 404);
  }

  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    return proxyError("Backend service is not configured.", 503);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return proxyError("Request body is too large.", 413);
  }

  const path = segments.map(encodeURIComponent).join("/");
  const base = new URL(backendUrl.endsWith("/") ? backendUrl : `${backendUrl}/`);
  const target = new URL(path, base);
  target.search = request.nextUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("connection");

  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) {
      return proxyError("Request body is too large.", 413);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(target, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
  } catch {
    return proxyError("Backend request timed out or failed.", 502);
  } finally {
    clearTimeout(timer);
  }

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");
  responseHeaders.set("cache-control", "no-store");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export {
  proxy as DELETE,
  proxy as GET,
  proxy as HEAD,
  proxy as OPTIONS,
  proxy as PATCH,
  proxy as POST,
  proxy as PUT,
};
