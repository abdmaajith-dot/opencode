import { test, expect, describe } from "bun:test"
import { summarizeFallbackTitle, type GithubEventPayload } from "../../src/cli/cmd/github"
import type { IssueCommentEvent } from "@octokit/webhooks-types"

// The handler coerces context.payload into the GithubEventPayload union at
// runtime (github.handler.ts:412) and derives issueEvent via isIssueCommentEvent
// ("issue" in event && "comment" in event). The octokit payload types carry many
// fields the fallback never reads, so we construct minimal shapes and cast
// through unknown.
function asPayload(p: unknown): GithubEventPayload {
  return p as unknown as GithubEventPayload
}

function issueEventFor(p: Record<string, unknown>): IssueCommentEvent | undefined {
  return "issue" in p && "comment" in p ? (p as unknown as IssueCommentEvent) : undefined
}

describe("summarizeFallbackTitle", () => {
  // Core footgun guard: the summarize() catch fallback must never throw for
  // any supported event. The old code cast every payload to
  // PullRequestReviewCommentEvent and read .pull_request.title, which threw
  // TypeError for issues / schedule / workflow_dispatch (no pull_request).
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["issue_comment", { action: "created", issue: { title: "Bug X" }, comment: { id: 1 } }, "Bug X"],
    ["pull_request_review_comment", { action: "created", pull_request: { title: "PR Y" }, comment: { id: 1 } }, "PR Y"],
    ["pull_request", { action: "opened", pull_request: { title: "PR Z" } }, "PR Z"],
    ["issues", { action: "opened", issue: { title: "Issue W" } }, "Issue W"],
    ["workflow_dispatch", { inputs: {}, ref: "main", workflow: "opencode.yml" }, "opencode run"],
    ["schedule", { schedule: "0 0 * * *" }, "opencode run"],
    ["workflow_run", { action: "completed", workflow_run: { id: 1 } }, "opencode run"],
  ]

  for (const [name, payload, expected] of cases) {
    test(`${name} does not throw and returns a non-empty title`, () => {
      const p = asPayload(payload)
      const issueEvent = issueEventFor(payload)
      expect(() => summarizeFallbackTitle(p, issueEvent)).not.toThrow()
      const title = summarizeFallbackTitle(p, issueEvent)
      expect(title).toBe(expected)
      expect(`Fix issue: ${title}`).toMatch(/^Fix issue: .+/)
    })
  }

  test("issueEvent takes precedence over a co-located pull_request", () => {
    const p = asPayload({ issue: { title: "Issue" }, comment: { id: 1 }, pull_request: { title: "PR" } })
    expect(summarizeFallbackTitle(p, p as unknown as IssueCommentEvent)).toBe("Issue")
  })

  test("pull_request takes precedence over issue when issueEvent is absent", () => {
    const p = asPayload({ pull_request: { title: "PR" }, issue: { title: "Issue" } })
    expect(summarizeFallbackTitle(p, undefined)).toBe("PR")
  })
})
