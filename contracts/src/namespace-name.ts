import {realpath} from "node:fs/promises"
import {basename, relative, sep} from "node:path"
import {inside, type Context} from "./context"

/** Выводит имя из физической цепочки от Git Repo до исходного владельца; npm-имя не используется. */
export function expectedNamespaceName(owner: string, context: Context): Promise<string | null> {
  const previous = context.namespaceNames.get(owner)
  if (previous) return previous
  const pending = (async () => {
    const git = Bun.spawn(["git", "-C", owner, "rev-parse", "--show-toplevel"], {
      stdout: "pipe",
      stderr: "ignore",
    })
    const [output, code] = await Promise.all([new Response(git.stdout).text(), git.exited])
    if (code !== 0) return null
    const repo = await realpath(output.trim())
    if (!inside(repo, owner)) return null
    return [basename(repo), ...relative(repo, owner).split(sep)]
      .flatMap(part => part.split(/[^a-zA-Z0-9]+/u))
      .filter(Boolean)
      .map(part => part[0]!.toUpperCase() + part.slice(1))
      .join("")
  })()
  context.namespaceNames.set(owner, pending)
  return pending
}
