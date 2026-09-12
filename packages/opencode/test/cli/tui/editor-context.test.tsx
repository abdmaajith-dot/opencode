import { mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, spyOn, test } from "bun:test"
import { createRoot } from "solid-js"
import { EditorContextProvider, useEditorContext, type EditorIntegration } from "@opencode-ai/tui/context/editor"
import { tmpdir } from "../../fixture/fixture"
import { FakeWebSocket } from "../../lib/websocket"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { discoverEditorConnection } from "@opencode-ai/tui/editor"

const originalClaudePort = process.env.CLAUDE_CODE_SSE_PORT
const originalOpencodePort = process.env.OPENCODE_EDITOR_SSE_PORT
const originalZedTerm = process.env.ZED_TERM
const originalTermProgram = process.env.TERM_PROGRAM

afterEach(() => {
  process.env.CLAUDE_CODE_SSE_PORT = originalClaudePort
  process.env.OPENCODE_EDITOR_SSE_PORT = originalOpencodePort
  if (originalZedTerm === undefined) delete process.env.ZED_TERM
  else process.env.ZED_TERM = originalZedTerm
  if (originalTermProgram === undefined) delete process.env.TERM_PROGRAM
  else process.env.TERM_PROGRAM = originalTermProgram
})

function nextTick() {
  return new Promise<void>((resolve) => queueMicrotask(resolve))
}

function flush() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function mountEditorContext(
  WebSocketImpl?: typeof WebSocket,
  integration: EditorIntegration = editorService,
  cwd = process.cwd(),
) {
  let editor!: ReturnType<typeof useEditorContext>
  let dispose!: () => void

  createRoot((nextDispose) => {
    dispose = nextDispose

    const Consumer = () => {
      editor = useEditorContext()
      return null
    }

    const value = process.env.CLAUDE_CODE_SSE_PORT || process.env.OPENCODE_EDITOR_SSE_PORT
    return (
      <TestTuiContexts cwd={cwd} paths={{ home: os.homedir() }}>
        <EditorContextProvider integration={integration} WebSocketImpl={WebSocketImpl}>
          <Consumer />
        </EditorContextProvider>
      </TestTuiContexts>
    )
  })

  return {
    editor,
    dispose,
  }
}

const editorService: EditorIntegration = {
  connection: discoverEditorConnection,
}

function createWebSocketImpl(...sockets: FakeWebSocket[]) {
  let index = 0

  return class {
    constructor(url: string, options?: { headers?: Record<string, string> }) {
      const socket = sockets[index]
      index += 1
      expect(socket).toBeDefined()
      expect(url).toBe(socket!.url)
      expect(options).toEqual(socket!.options)
      return socket as unknown as object
    }
  } as unknown as typeof WebSocket
}

function sendSelection(socket: FakeWebSocket, filePath: string, text = "foo") {
  socket.message(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "selection_changed",
      params: {
        text,
        filePath,
        selection: {
          start: { line: 1, character: 1 },
          end: { line: 1, character: 4 },
        },
      },
    }),
  )
}

function expectedSelection(filePath: string, text = "foo") {
  return {
    filePath,
    source: "websocket" as const,
    ranges: [
      {
        text,
        selection: {
          start: { line: 1, character: 1 },
          end: { line: 1, character: 4 },
        },
      },
    ],
  }
}

test("useEditorContext reconnect switches editor server by session directory", async () => {
  await using tmp = await tmpdir()
  const startupDirectory = path.join(tmp.path, "startup")
  const sessionDirectory = path.join(tmp.path, "session")
  const ideDirectory = path.join(tmp.path, ".claude", "ide")
  await mkdir(startupDirectory, { recursive: true })
  await mkdir(sessionDirectory, { recursive: true })
  await mkdir(ideDirectory, { recursive: true })
  await writeFile(
    path.join(ideDirectory, "3001.lock"),
    JSON.stringify({
      transport: "ws",
      workspaceFolders: [startupDirectory],
    }),
  )
  await writeFile(
    path.join(ideDirectory, "3002.lock"),
    JSON.stringify({
      transport: "ws",
      workspaceFolders: [sessionDirectory],
    }),
  )

  process.env.CLAUDE_CODE_SSE_PORT = undefined
  process.env.OPENCODE_EDITOR_SSE_PORT = undefined
  spyOn(process, "cwd").mockImplementation(() => startupDirectory)
  spyOn(os, "homedir").mockImplementation(() => tmp.path)
  const firstSocket = new FakeWebSocket("ws://127.0.0.1:3001")
  const secondSocket = new FakeWebSocket("ws://127.0.0.1:3002")

  const mounted = mountEditorContext(createWebSocketImpl(firstSocket, secondSocket))
  await nextTick()

  expect(firstSocket.closed).toBeFalse()
  sendSelection(firstSocket, path.join(startupDirectory, "file.ts"))

  expect(mounted.editor.selection()).toEqual(expectedSelection(path.join(startupDirectory, "file.ts")))
  expect(mounted.editor.labelState()).toBe("pending")

  mounted.editor.reconnect(sessionDirectory)
  await nextTick()

  expect(firstSocket.closed).toBeTrue()
  expect(secondSocket.closed).toBeFalse()
  expect(mounted.editor.selection()).toBeUndefined()
  expect(mounted.editor.labelState()).toBe("none")

  mounted.dispose()
})

test("useEditorContext favors configured port over lock files", async () => {
  await using tmp = await tmpdir()
  const startupDirectory = path.join(tmp.path, "startup")
  const ideDirectory = path.join(tmp.path, ".claude", "ide")
  await mkdir(startupDirectory, { recursive: true })
  await mkdir(ideDirectory, { recursive: true })
  await writeFile(
    path.join(ideDirectory, "3001.lock"),
    JSON.stringify({
      transport: "ws",
      workspaceFolders: [startupDirectory],
    }),
  )

  process.env.CLAUDE_CODE_SSE_PORT = "4010"
  process.env.OPENCODE_EDITOR_SSE_PORT = undefined
  spyOn(process, "cwd").mockImplementation(() => startupDirectory)
  spyOn(os, "homedir").mockImplementation(() => tmp.path)
  const socket = new FakeWebSocket("ws://127.0.0.1:4010")

  const mounted = mountEditorContext(createWebSocketImpl(socket))
  await nextTick()

  expect(socket.closed).toBeFalse()

  mounted.dispose()
})

test("useEditorContext clears selection when reconnecting", async () => {
  await using tmp = await tmpdir()
  const startupDirectory = path.join(tmp.path, "startup")
  const ideDirectory = path.join(tmp.path, ".claude", "ide")
  await mkdir(startupDirectory, { recursive: true })
  await mkdir(ideDirectory, { recursive: true })
  await writeFile(
    path.join(ideDirectory, "3001.lock"),
    JSON.stringify({
      transport: "ws",
      workspaceFolders: [startupDirectory],
    }),
  )

  process.env.CLAUDE_CODE_SSE_PORT = undefined
  process.env.OPENCODE_EDITOR_SSE_PORT = undefined
  spyOn(process, "cwd").mockImplementation(() => startupDirectory)
  spyOn(os, "homedir").mockImplementation(() => tmp.path)
  const socket = new FakeWebSocket("ws://127.0.0.1:3001")

  const mounted = mountEditorContext(createWebSocketImpl(socket))
  await nextTick()

  expect(socket.closed).toBeFalse()
  expect(mounted.editor.selection()).toBeUndefined()
  expect(mounted.editor.connected()).toBeFalse()

  socket.open()
  socket.message(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-11-25",
        serverInfo: { name: "test", version: "0.0.0" },
      },
    }),
  )
  sendSelection(socket, path.join(startupDirectory, "file.ts"))

  expect(mounted.editor.connected()).toBeTrue()
  expect(mounted.editor.server()).toEqual({
    protocolVersion: "2025-11-25",
    serverInfo: { name: "test", version: "0.0.0" },
  })
  expect(mounted.editor.selection()).toEqual(expectedSelection(path.join(startupDirectory, "file.ts")))
  expect(mounted.editor.labelState()).toBe("pending")
  mounted.editor.markSelectionSent()
  expect(mounted.editor.labelState()).toBe("sent")

  mounted.editor.reconnect(startupDirectory)

  expect(socket.closed).toBeFalse()
  expect(mounted.editor.connected()).toBeTrue()
  expect(mounted.editor.selection()).toBeUndefined()
  expect(mounted.editor.labelState()).toBe("none")

  mounted.dispose()
})

test("useEditorContext preserves selection for the next reconnect when requested", async () => {
  await using tmp = await tmpdir()
  const startupDirectory = path.join(tmp.path, "startup")
  const ideDirectory = path.join(tmp.path, ".claude", "ide")
  await mkdir(startupDirectory, { recursive: true })
  await mkdir(ideDirectory, { recursive: true })
  await writeFile(
    path.join(ideDirectory, "3001.lock"),
    JSON.stringify({
      transport: "ws",
      workspaceFolders: [startupDirectory],
    }),
  )

  process.env.CLAUDE_CODE_SSE_PORT = undefined
  process.env.OPENCODE_EDITOR_SSE_PORT = undefined
  spyOn(process, "cwd").mockImplementation(() => startupDirectory)
  spyOn(os, "homedir").mockImplementation(() => tmp.path)
  const socket = new FakeWebSocket("ws://127.0.0.1:3001")

  const mounted = mountEditorContext(createWebSocketImpl(socket))
  await nextTick()

  sendSelection(socket, path.join(startupDirectory, "file.ts"))
  expect(mounted.editor.selection()).toEqual(expectedSelection(path.join(startupDirectory, "file.ts")))

  mounted.editor.markSelectionSent()
  mounted.editor.preserveSelectionFromNewSession()
  mounted.editor.reconnect(startupDirectory)

  expect(socket.closed).toBeFalse()
  expect(mounted.editor.selection()).toEqual(expectedSelection(path.join(startupDirectory, "file.ts")))
  expect(mounted.editor.labelState()).toBe("sent")

  mounted.editor.reconnect(startupDirectory)

  expect(mounted.editor.selection()).toBeUndefined()
  expect(mounted.editor.labelState()).toBe("none")

  mounted.dispose()
})

test("useEditorContext connects with OPENCODE_EDITOR_SSE_PORT", async () => {
  await using tmp = await tmpdir()
  process.env.CLAUDE_CODE_SSE_PORT = undefined
  process.env.OPENCODE_EDITOR_SSE_PORT = "4020"
  spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const socket = new FakeWebSocket("ws://127.0.0.1:4020")

  const mounted = mountEditorContext(createWebSocketImpl(socket))
  await nextTick()

  expect(socket.closed).toBeFalse()

  mounted.dispose()
})

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolveFn) => {
    resolve = resolveFn
  })
  return { promise, resolve }
}

function zedSelectionResult(filePath: string, text = "old") {
  return {
    type: "selection" as const,
    selection: {
      filePath,
      source: "zed" as const,
      ranges: [
        {
          text,
          selection: {
            start: { line: 1, character: 1 },
            end: { line: 1, character: 4 },
          },
        },
      ],
    },
  }
}

function expectedZedSelection(filePath: string, text = "old") {
  return {
    filePath,
    source: "zed" as const,
    ranges: [
      {
        text,
        selection: {
          start: { line: 1, character: 1 },
          end: { line: 1, character: 4 },
        },
      },
    ],
  }
}

function createZedIntegration(selection: (directory: string) => Promise<unknown>): EditorIntegration {
  return {
    connection: () => undefined,
    selection,
  }
}

function zedEnv() {
  process.env.ZED_TERM = "true"
  process.env.CLAUDE_CODE_SSE_PORT = undefined
  process.env.OPENCODE_EDITOR_SSE_PORT = undefined
}

test("useEditorContext applies Zed selection from poll in Zed terminal mode", async () => {
  await using tmp = await tmpdir()
  const directory = path.join(tmp.path, "project")
  await mkdir(directory, { recursive: true })
  zedEnv()

  const filePath = path.join(directory, "file.ts")
  const integration = createZedIntegration(() => Promise.resolve(zedSelectionResult(filePath)))

  const mounted = mountEditorContext(undefined, integration, directory)
  await flush()

  expect(mounted.editor.enabled()).toBeTrue()
  expect(mounted.editor.selection()).toEqual(expectedZedSelection(filePath))
  expect(mounted.editor.labelState()).toBe("pending")

  mounted.dispose()
})

test("useEditorContext ignores stale Zed poll from previous directory after reconnect", async () => {
  await using tmp = await tmpdir()
  const directoryA = path.join(tmp.path, "A")
  const directoryB = path.join(tmp.path, "B")
  await mkdir(directoryA, { recursive: true })
  await mkdir(directoryB, { recursive: true })
  zedEnv()

  const pollA = createDeferred<unknown>()
  const pollB = createDeferred<unknown>()
  const integration = createZedIntegration((directory) => (directory === directoryA ? pollA.promise : pollB.promise))

  const mounted = mountEditorContext(undefined, integration, directoryA)
  await flush()

  mounted.editor.reconnect(directoryB)
  await flush()

  pollA.resolve(zedSelectionResult(path.join(directoryA, "file.ts"), "stale"))
  await flush()

  expect(mounted.editor.selection()).toBeUndefined()
  expect(mounted.editor.labelState()).toBe("none")
  expect(mounted.editor.connected()).toBeFalse()

  mounted.dispose()
})

test("useEditorContext applies new-directory Zed poll after ignoring stale poll", async () => {
  await using tmp = await tmpdir()
  const directoryA = path.join(tmp.path, "A")
  const directoryB = path.join(tmp.path, "B")
  await mkdir(directoryA, { recursive: true })
  await mkdir(directoryB, { recursive: true })
  zedEnv()

  const pollA = createDeferred<unknown>()
  const pollB = createDeferred<unknown>()
  const integration = createZedIntegration((directory) => (directory === directoryA ? pollA.promise : pollB.promise))

  const mounted = mountEditorContext(undefined, integration, directoryA)
  await flush()

  mounted.editor.reconnect(directoryB)
  await flush()

  pollA.resolve(zedSelectionResult(path.join(directoryA, "file.ts"), "stale"))
  await flush()

  pollB.resolve(zedSelectionResult(path.join(directoryB, "file.ts"), "fresh"))
  await flush()

  expect(mounted.editor.selection()).toEqual(expectedZedSelection(path.join(directoryB, "file.ts"), "fresh"))
  expect(mounted.editor.labelState()).toBe("pending")
  expect(mounted.editor.connected()).toBeTrue()

  mounted.dispose()
})
