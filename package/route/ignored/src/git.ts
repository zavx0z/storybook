import {isAbsolute, relative, sep} from "node:path"

/** Выполняет bounded Git metadata query. */
export async function runGit(cwd: string, args: readonly string[], input?: string): Promise<{
  readonly code: number
  readonly output: string
  readonly error: string
}> {
  const process = Bun.spawn(["git", "-C", cwd, ...args], {
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(10_000),
  })
  const [code, output, error] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  return {code, output, error}
}

/** Определяет принадлежность пути указанному owner root. */
export function isContained(rootPath: string, path: string): boolean {
  const difference = relative(rootPath, path)
  return difference === "" || (!difference.startsWith(`..${sep}`) && difference !== ".." && !isAbsolute(difference))
}
