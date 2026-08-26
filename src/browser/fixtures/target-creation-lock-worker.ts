import {appendFile, readFile, writeFile} from "node:fs/promises"
import {withTargetCreationLock} from "../target-operation-lock.ts"

const [stateRoot, creationScope, targetState, eventPath, label, holdInput] = Bun.argv.slice(2)
if (
  stateRoot === undefined
  || creationScope === undefined
  || targetState === undefined
  || eventPath === undefined
  || label === undefined
  || holdInput === undefined
) {
  throw new Error("usage: target-creation-lock-worker <state-root> <creation-scope> <target-state> <events> <label> <hold-ms>")
}

const holdMs = Number(holdInput)
if (!Number.isFinite(holdMs) || holdMs < 0) throw new Error("hold-ms must be a non-negative number")

await appendFile(eventPath, `${label}:attempt\n`, "utf8")
await withTargetCreationLock({
  stateRoot,
  creationScope,
  cdpPort: 19_222,
  timeoutMs: 5_000,
}, async () => {
  await appendFile(eventPath, `${label}:acquired\n`, "utf8")
  let target = ""
  try {
    target = await readFile(targetState, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  if (target.length === 0) {
    await appendFile(eventPath, `${label}:creating\n`, "utf8")
    await Bun.sleep(holdMs)
    await writeFile(targetState, "TARGET-1\n", "utf8")
    await appendFile(eventPath, `${label}:created\n`, "utf8")
  } else {
    await appendFile(eventPath, `${label}:reused\n`, "utf8")
  }
})
await appendFile(eventPath, `${label}:released\n`, "utf8")
