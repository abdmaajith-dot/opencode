import { beforeAll, describe, expect, mock, test } from "bun:test"

let shouldListRoot: typeof import("./file-tree").shouldListRoot
let dirsToExpand: typeof import("./file-tree").dirsToExpand

beforeAll(async () => {
  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => ({}),
    useLocation: () => ({}),
    useSearchParams: () => [{}, () => undefined],
  }))
  mock.module("@/context/file", () => ({
    useFile: () => ({
      tree: {
        state: () => undefined,
        list: () => Promise.resolve(),
        children: () => [],
        expand: () => {},
        collapse: () => {},
      },
    }),
  }))
  mock.module("@opencode-ai/ui/collapsible", () => ({
    Collapsible: {
      Trigger: (props: { children?: unknown }) => props.children,
      Content: (props: { children?: unknown }) => props.children,
    },
  }))
  mock.module("@opencode-ai/ui/file-icon", () => ({ FileIcon: () => null }))
  mock.module("@opencode-ai/ui/icon", () => ({ Icon: () => null }))
  mock.module("@opencode-ai/ui/tooltip", () => ({ Tooltip: (props: { children?: unknown }) => props.children }))
  const mod = await import("./file-tree")
  shouldListRoot = mod.shouldListRoot
  dirsToExpand = mod.dirsToExpand
})

describe("file tree fetch discipline", () => {
  test("root lists on mount unless already loaded or loading", () => {
    expect(shouldListRoot({ level: 0 })).toBe(true)
    expect(shouldListRoot({ level: 0, dir: { loaded: true } })).toBe(false)
    expect(shouldListRoot({ level: 0, dir: { loading: true } })).toBe(false)
    expect(shouldListRoot({ level: 1 })).toBe(false)
  })

  test("allowed auto-expand picks only collapsed dirs", () => {
    const expanded = new Set<string>()
    const filter = { dirs: new Set(["src", "src/components"]) }

    const first = dirsToExpand({
      level: 0,
      filter,
      expanded: (dir) => expanded.has(dir),
    })

    expect(first).toEqual(["src", "src/components"])

    for (const dir of first) expanded.add(dir)

    const second = dirsToExpand({
      level: 0,
      filter,
      expanded: (dir) => expanded.has(dir),
    })

    expect(second).toEqual([])
    expect(dirsToExpand({ level: 1, filter, expanded: () => false })).toEqual([])
  })
})
