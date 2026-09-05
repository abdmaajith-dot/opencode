import { describe, expect, test } from "bun:test"
import { EOL } from "node:os"
import { Cause, Effect, Exit, Layer, Option } from "effect"
import { Daemon } from "../../services/daemon"
import apiHandler, { rawRequest, resolveOperation } from "./api"

describe("api request resolution", () => {
  test("resolves an operation ID with path and query parameters", () => {
    expect(
      resolveOperation(
        {
          paths: {
            "/api/session/{sessionID}": {
              get: { operationId: "v2.session.get" },
            },
          },
        },
        "v2.session.get",
        { sessionID: "ses/a", workspace: "work" },
      ),
    ).toEqual({ method: "GET", path: "/api/session/ses%2Fa?workspace=work" })
  })

  test("rejects a missing path parameter", () => {
    expect(() =>
      resolveOperation(
        { paths: { "/api/session/{sessionID}": { get: { operationId: "v2.session.get" } } } },
        "v2.session.get",
        {},
      ),
    ).toThrow("Missing path parameter: sessionID")
  })

  test("resolves curl-like method and path input", () => {
    expect(rawRequest(["post", "/api/foo"])).toEqual({ method: "POST", path: "/api/foo" })
    expect(rawRequest(["v2.session.list"])).toBeUndefined()
  })
})

type Input = Parameters<typeof apiHandler>[0]

function apiInput(request: readonly string[], param?: Record<string, string>): Input {
  return {
    request,
    data: Option.none<string>(),
    header: [],
    param: param ? Option.some(param) : Option.none<Record<string, string>>(),
  }
}

interface StubServer {
  readonly url: string
  readonly requests: ReadonlyArray<{ readonly method: string; readonly pathname: string }>
  stop: () => void
}

function stubServer(serve: (req: Request) => Response | Promise<Response>): StubServer {
  const requests: { method: string; pathname: string }[] = []
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      requests.push({ method: req.method, pathname: new URL(req.url).pathname })
      return serve(req)
    },
  })
  return { url: server.url.origin, requests, stop: () => server.stop(true) }
}

function daemonLayer(url: string) {
  return Layer.mock(Daemon.Service, { transport: () => Effect.succeed({ url, headers: {} }) })
}

async function runWithStdout<A, E>(effect: Effect.Effect<A, E>): Promise<{ output: string; exit: Exit.Exit<A, E> }> {
  const chunks: string[] = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: Uint8Array | string) => {
    chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk))
    return true
  }) as typeof process.stdout.write
  try {
    const exit = await Effect.runPromiseExit(effect)
    return { output: chunks.join(""), exit }
  } finally {
    process.stdout.write = original
  }
}

function run(input: Input, url: string) {
  return runWithStdout(apiHandler(input).pipe(Effect.provide(daemonLayer(url))))
}

function failureMessage(exit: Exit.Exit<unknown, unknown>): string | undefined {
  if (Exit.isSuccess(exit)) return undefined
  const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause))
  return error instanceof Error ? error.message : undefined
}

describe("api request execution", () => {
  test("succeeds and prints the body on a 2xx response", async () => {
    const server = stubServer(() => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    try {
      const { output, exit } = await run(apiInput(["GET", "/api/foo"]), server.url)
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(output).toBe(JSON.stringify({ ok: true }) + EOL)
      expect(server.requests).toEqual([{ method: "GET", pathname: "/api/foo" }])
    } finally {
      server.stop()
    }
  })

  test("fails with a non-zero exit on a 4xx response while still printing the body", async () => {
    const server = stubServer(
      () =>
        new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    )
    try {
      const { output, exit } = await run(apiInput(["GET", "/api/missing"]), server.url)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(failureMessage(exit)).toBe("HTTP 404 Not Found")
      expect(output).toBe(JSON.stringify({ error: "not found" }) + EOL)
    } finally {
      server.stop()
    }
  })

  test("fails with a non-zero exit on a 5xx response while still printing the body", async () => {
    const server = stubServer(
      () =>
        new Response(JSON.stringify({ error: "internal server failure" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    )
    try {
      const { output, exit } = await run(apiInput(["GET", "/api/foo"]), server.url)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(failureMessage(exit)).toBe("HTTP 500 Internal Server Error")
      expect(output).toBe(JSON.stringify({ error: "internal server failure" }) + EOL)
    } finally {
      server.stop()
    }
  })

  test("fails on a non-2xx response with an empty body and writes nothing", async () => {
    const server = stubServer(() => new Response(null, { status: 404 }))
    try {
      const { output, exit } = await run(apiInput(["GET", "/api/missing"]), server.url)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(failureMessage(exit)).toBe("HTTP 404 Not Found")
      expect(output).toBe("")
    } finally {
      server.stop()
    }
  })

  test("fails on a transport-level (connection) failure", async () => {
    const { exit } = await run(apiInput(["GET", "/api/foo"]), "http://127.0.0.1:9")
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

const openapi = {
  openapi: "3.0.0",
  paths: {
    "/api/session/{sessionID}": {
      get: { operationId: "v2.session.get" },
    },
  },
}

describe("api operation id resolution", () => {
  test("resolves an operation id, then succeeds and prints the body on a 2xx response", async () => {
    const server = stubServer((req) => {
      if (new URL(req.url).pathname === "/openapi.json") {
        return new Response(JSON.stringify(openapi), { status: 200, headers: { "content-type": "application/json" } })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    try {
      const { output, exit } = await run(apiInput(["v2.session.get"], { sessionID: "ses/a" }), server.url)
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(output).toBe(JSON.stringify({ ok: true }) + EOL)
      expect(server.requests).toContainEqual({ method: "GET", pathname: "/api/session/ses%2Fa" })
    } finally {
      server.stop()
    }
  })

  test("fails with a non-zero exit when the resolved request returns a non-2xx response", async () => {
    const server = stubServer((req) => {
      if (new URL(req.url).pathname === "/openapi.json") {
        return new Response(JSON.stringify(openapi), { status: 200, headers: { "content-type": "application/json" } })
      }
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })
    })
    try {
      const { output, exit } = await run(apiInput(["v2.session.get"], { sessionID: "ses/a" }), server.url)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(failureMessage(exit)).toBe("HTTP 404 Not Found")
      expect(output).toBe(JSON.stringify({ error: "not found" }) + EOL)
    } finally {
      server.stop()
    }
  })

  test("fails when the bootstrap OpenAPI document fetch returns a non-2xx response", async () => {
    const server = stubServer(() => new Response("unavailable", { status: 500 }))
    try {
      const { exit } = await run(apiInput(["v2.session.get"], { sessionID: "ses/a" }), server.url)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(server.requests).toEqual([{ method: "GET", pathname: "/openapi.json" }])
    } finally {
      server.stop()
    }
  })
})
