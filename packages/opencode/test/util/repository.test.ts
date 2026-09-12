import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { Global } from "@opencode-ai/core/global"
import {
  InvalidRepositoryBranchError,
  InvalidRepositoryReferenceError,
  UnsupportedLocalRepositoryError,
  isFileRepositoryReference,
  isRemoteRepositoryReference,
  parseRemoteRepositoryReference,
  parseRepositoryReference,
  repositoryCacheIdentity,
  repositoryCachePath,
  sameRepositoryReference,
  validateRepositoryBranch,
} from "../../src/util/repository"

describe("util.repository", () => {
  test("parses github shorthand and preserves cache path", () => {
    const reference = parseRemoteRepositoryReference("owner/repo")

    expect(reference).toMatchObject({
      host: "github.com",
      path: "owner/repo",
      segments: ["owner", "repo"],
      owner: "owner",
      repo: "repo",
      label: "owner/repo",
    })
    expect(repositoryCachePath(reference)).toBe(path.join(Global.Path.repos, "github.com", "owner", "repo"))
    expect(repositoryCacheIdentity(reference)).toBe("github.com/owner/repo")
  })

  test("parses host path and scp remote references", () => {
    const hostPath = parseRemoteRepositoryReference("gitlab.com/group/repo")
    const scp = parseRemoteRepositoryReference("git@github.com:owner/repo.git")

    expect(hostPath).toMatchObject({
      host: "gitlab.com",
      path: "group/repo",
      remote: "https://gitlab.com/group/repo.git",
      label: "gitlab.com/group/repo",
    })
    expect(scp).toMatchObject({
      host: "github.com",
      path: "owner/repo",
      remote: "git@github.com:owner/repo.git",
      label: "owner/repo",
    })
  })

  test("keeps local file repositories distinct from remote repositories", () => {
    const localPath = path.resolve("repo.git")
    const reference = parseRepositoryReference(pathToFileURL(localPath).href)

    expect(reference).toMatchObject({
      host: "file",
      protocol: "file:",
      label: localPath,
    })
    expect(reference && isFileRepositoryReference(reference)).toBe(true)
    expect(reference && isRemoteRepositoryReference(reference)).toBe(false)
    expect(() => parseRemoteRepositoryReference(pathToFileURL(localPath).href)).toThrow(
      "Local file repositories are not supported",
    )
    expect(() => parseRemoteRepositoryReference(pathToFileURL(localPath).href)).toThrow(UnsupportedLocalRepositoryError)
  })

  test("rejects invalid remote repository references with typed errors", () => {
    expect(() => parseRemoteRepositoryReference("not-a-repo")).toThrow(InvalidRepositoryReferenceError)
    expect(() => parseRemoteRepositoryReference("git@github.com:../../../etc/passwd")).toThrow(
      InvalidRepositoryReferenceError,
    )
  })

  test("rejects a bare .. or . host segment so repositoryCachePath cannot escape the repos root", () => {
    expect(parseRepositoryReference("../log")).toBeNull()
    expect(parseRepositoryReference("../owner/repo")).toBeNull()
    expect(parseRepositoryReference("./log")).toBeNull()
    expect(parseRepositoryReference("..:owner/repo")).toBeNull()
    expect(parseRepositoryReference(".:owner/repo")).toBeNull()
    expect(() => parseRemoteRepositoryReference("../log")).toThrow(InvalidRepositoryReferenceError)
    expect(() => parseRemoteRepositoryReference("../owner/repo")).toThrow(InvalidRepositoryReferenceError)
    expect(() => parseRemoteRepositoryReference("./log")).toThrow(InvalidRepositoryReferenceError)
    expect(() => parseRemoteRepositoryReference("..:owner/repo")).toThrow(InvalidRepositoryReferenceError)
    expect(() => parseRemoteRepositoryReference(".:owner/repo")).toThrow(InvalidRepositoryReferenceError)
    expect(() => parseRemoteRepositoryReference("git@..:owner/repo")).toThrow(InvalidRepositoryReferenceError)
  })

  test("keeps repository cache paths inside the repos root for every accepted reference", () => {
    const root = Global.Path.repos
    const samples = [
      "owner/repo",
      "github:owner/repo",
      "github.com/owner/repo",
      "gitlab.com/group/repo",
      "git@github.com:owner/repo.git",
      "https://github.com/owner/repo.git",
    ]
    for (const input of samples) {
      const reference = parseRemoteRepositoryReference(input)
      const cached = repositoryCachePath(reference)
      const rel = path.relative(root, cached)
      expect(rel === "" || (!path.isAbsolute(rel) && !rel.startsWith(".."))).toBe(true)
    }
  })

  test("compares cache identity independent of input spelling", () => {
    const shorthand = parseRemoteRepositoryReference("owner/repo")
    const url = parseRemoteRepositoryReference("https://github.com/owner/repo.git")
    const hostPath = parseRemoteRepositoryReference("github.com/owner/repo")

    expect(sameRepositoryReference(shorthand, url)).toBe(true)
    expect(sameRepositoryReference(shorthand, hostPath)).toBe(true)
  })

  test("validates repository branch names", () => {
    expect(() => validateRepositoryBranch("feature/docs.v1")).not.toThrow()
    expect(() => validateRepositoryBranch("-bad")).toThrow("Branch must contain only alphanumeric characters")
    expect(() => validateRepositoryBranch("bad..branch")).toThrow("Branch must contain only alphanumeric characters")
    expect(() => validateRepositoryBranch("bad branch")).toThrow("Branch must contain only alphanumeric characters")
    expect(() => validateRepositoryBranch("bad branch")).toThrow(InvalidRepositoryBranchError)
  })
})
