import {appendFile} from "node:fs/promises"
import {acquireTargetOperationLock} from "../target-operation-lock.ts"

const [stateRoot, targetId, eventPath, label, holdInput] = Bun.argv.slice(2)
if (stateRoot === undefined || targetId === undefined || eventPath === undefined || label === undefined || holdInput === undefined) {
  throw new Error("usage: storybook-target-lock-worker <state-root> <target-id> <event-path> <label> <hold-ms>")
}

const holdMs = Number(holdInput)
if (!Number.isFinite(holdMs) || holdMs < 0) throw new Error("hold-ms must be a non-negative number")

const lock = await acquireTargetOperationLock({
  stateRoot,
  targetId,
  cdpPort: 19_222,
  timeoutMs: 5_000,
})
await appendFile(eventPath, `${label}:acquired\n`, "utf8")
try {
  await Bun.sleep(holdMs)
} finally {
  await lock.release()
  await appendFile(eventPath, `${label}:released\n`, "utf8")
}
