import { query } from "@solidjs/router"
import { config } from "~/config"

export const github = query(async () => {
  "use server"
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  }
  const apiBaseUrl = config.github.repoUrl.replace("https://github.com/", "https://api.github.com/repos/")
  try {
    const [meta, releases] = await Promise.all([
      fetch(apiBaseUrl, { headers }).then((res) => res.json()),
      fetch(`${apiBaseUrl}/releases`, { headers }).then((res) => res.json()),
    ])
    if (!Array.isArray(releases) || releases.length === 0) {
      return undefined
    }
    return {
      stars: meta.stargazers_count,
    }
  } catch (e) {
    console.error(e)
  }
  return undefined
}, "github")
