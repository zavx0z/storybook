import {appendFile} from "node:fs/promises"
import {acquireExternalStorybookStartLease} from "../server-state.ts"

const [statePath, events, label, holdText] = process.argv.slice(2)
if (statePath === undefined || events === undefined || label === undefined || holdText === undefined) {
  throw new Error("start-lease-worker requires statePath, events, label and holdMs")
}
const holdMs = Number(holdText)
if (!Number.isSafeInteger(holdMs) || holdMs < 0 || holdMs > 30_000) throw new Error("invalid holdMs")

let lease: ReturnType<typeof acquireExternalStorybookStartLease> | null = null
while (lease === null) {
  try {
    lease = acquireExternalStorybookStartLease(statePath)
  } catch (error) {
    if (!String(error).includes("start is already in progress")) throw error
    await Bun.sleep(10)
  }
}
await appendFile(events, `${label}:acquired\n`)
if (holdMs > 0) await Bun.sleep(holdMs)
await appendFile(events, `${label}:released\n`)
lease.release()
