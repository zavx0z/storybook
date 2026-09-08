import {existsSync, lstatSync, readdirSync, readFileSync, rmSync} from "node:fs"
import {join} from "node:path"

/** Collect interrupted candidates while preserving applied revisions for session validation. */
export function collectUnpublishedStorybookArtifacts(root: string): void {
  if (!existsSync(root)) return
  for (const entry of readdirSync(root, {withFileTypes: true})) {
    const directory = join(root, entry.name)
    if (entry.name === "shared" && entry.isDirectory()) continue
    const receipt = join(directory, "applied.json")
    if (!entry.isDirectory() || !existsSync(receipt)) {
      rmSync(directory, {recursive: true, force: true})
      continue
    }
    try {
      if (!lstatSync(receipt).isFile() || lstatSync(receipt).isSymbolicLink()) continue
      const {version, revision} = JSON.parse(readFileSync(receipt, "utf8"))
      if (version !== 1 || typeof revision !== "string" || !/^[A-Za-z0-9_-]{1,256}$/u.test(revision)) continue
      for (const name of readdirSync(directory)) {
        if (name !== "applied.json" && name !== revision) rmSync(join(directory, name), {recursive: true, force: true})
      }
    } catch {
      // Keep corrupt publication evidence for the owning session's diagnostic.
    }
  }
}
