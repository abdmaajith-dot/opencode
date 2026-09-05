import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type {
  IssueCommentEvent,
  IssuesEvent,
  PullRequestReviewCommentEvent,
  WorkflowDispatchEvent,
  WorkflowRunEvent,
  PullRequestEvent,
} from "@octokit/webhooks-types"

export { parseGitHubRemote } from "@/util/repository"

/**
 * Event payload union handled by the GitHub Actions handler.
 */
export type GithubEventPayload =
  | IssueCommentEvent
  | IssuesEvent
  | PullRequestReviewCommentEvent
  | WorkflowDispatchEvent
  | WorkflowRunEvent
  | PullRequestEvent

/**
 * Extracts displayable text from assistant response parts.
 * Returns null for non-text responses (signals summary needed).
 * Throws only for truly empty responses.
 */
export function extractResponseText(parts: SessionV1.Part[]): string | null {
  const textPart = parts.findLast((p) => p.type === "text")
  if (textPart) return textPart.text

  // Non-text parts (tools, reasoning, step-start/step-finish, etc.) - signal summary needed
  if (parts.length > 0) return null

  throw new Error("Failed to parse response: no parts returned")
}

/**
 * Formats a PROMPT_TOO_LARGE error message with details about files in the prompt.
 * Content is base64 encoded, so we calculate original size by multiplying by 0.75.
 */
export function formatPromptTooLargeError(files: { filename: string; content: string }[]): string {
  const fileDetails =
    files.length > 0
      ? `\n\nFiles in prompt:\n${files.map((f) => `  - ${f.filename} (${((f.content.length * 0.75) / 1024).toFixed(0)} KB)`).join("\n")}`
      : ""
  return `PROMPT_TOO_LARGE: The prompt exceeds the model's context limit.${fileDetails}`
}

/**
 * Fallback commit/PR title used when summarization fails.
 *
 * Handles events that lack a `pull_request` field (`issues`, `schedule`,
 * `workflow_dispatch`) explicitly instead of unsafely casting the payload to
 * `PullRequestReviewCommentEvent`, which would throw
 * `TypeError: Cannot read properties of undefined (reading 'title')` and mask
 * the real summarization failure (provider error, rate limit, network error).
 */
export function summarizeFallbackTitle(payload: GithubEventPayload, issueEvent?: IssueCommentEvent): string {
  if (issueEvent) return issueEvent.issue.title
  if ("pull_request" in payload) return payload.pull_request.title
  if ("issue" in payload) return payload.issue.title
  return "opencode run"
}
