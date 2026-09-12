import { expect, test } from "bun:test"
import { createOpencodeClient } from "../src/v2/client"

const HTML =
  "<!doctype html><html><head><title>opencode</title></head><body><div id=root></div></body></html>"

const FRIENDLY =
  "Request is not supported by this version of OpenCode Server (Server responded with text/html)"

function mockFetch(status: number, contentType: string, body = HTML) {
  return ((req: any) => {
    req.timeout = false
    return Promise.resolve(new Response(body, { status, headers: { "content-type": contentType } }))
  }) as any
}

test("text/html with charset is caught by the version-mismatch guard", async () => {
  const client = createOpencodeClient({
    baseUrl: "http://localhost",
    fetch: mockFetch(200, "text/html; charset=UTF-8"),
  })
  await expect(client.v2.health.get()).rejects.toThrow(FRIENDLY)
})

test("text/html with charset throws the friendly error, not the raw HTML page", async () => {
  const client = createOpencodeClient({
    baseUrl: "http://localhost",
    fetch: mockFetch(404, "text/html; charset=UTF-8"),
  })
  await expect(client.v2.health.get({ throwOnError: true })).rejects.toThrow(FRIENDLY)
})

test("text/plain is not treated as HTML", async () => {
  const client = createOpencodeClient({
    baseUrl: "http://localhost",
    fetch: mockFetch(200, "text/plain", "hello world"),
  })
  const result = (await client.v2.health.get()) as { data?: unknown; error?: unknown }
  expect(result.error).toBeUndefined()
  expect(result.data).toBe("hello world")
})
