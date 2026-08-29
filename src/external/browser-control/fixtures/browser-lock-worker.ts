import {appendFile} from "node:fs/promises"
import {withStorybookBrowserLock} from "../target-operation-lock.ts"

const [root, scope, events, label, holdText] = process.argv.slice(2)
if (root === undefined || scope === undefined || events === undefined || label === undefined || holdText === undefined) {
  throw new Error("browser-lock-worker requires root, scope, events, label and holdMs")
}
const holdMs = Number(holdText)
if (!Number.isSafeInteger(holdMs) || holdMs < 0 || holdMs > 30_000) throw new Error("invalid holdMs")

await withStorybookBrowserLock({root, scope}, async () => {
  await appendFile(events, `${label}:acquired\n`)
  if (holdMs > 0) await Bun.sleep(holdMs)
  await appendFile(events, `${label}:released\n`)
})
