import {readFileSync, writeFileSync} from "node:fs"
import {buildSharedBrowserAssets} from "./shared-browser-build.ts"
import {STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL} from "./build-phase.ts"
import type {SharedBrowserBuildInput} from "./types/shared-browser.ts"
import {readSharedBrowserReceipt, saveSharedBrowserReceipt} from "./shared-browser-receipt.ts"
import type {StorybookBuildPhaseEvent} from "./build-phase.ts"

const [jobPath, resultPath, workerId] = process.argv.slice(2)
if (!jobPath || !resultPath || !workerId) throw new Error("Shared browser worker requires an exact job and nonce")
console.log(JSON.stringify({protocol: STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL, kind: "ready", workerId, pid: process.pid}))
try {
  const input = JSON.parse(readFileSync(jobPath, "utf8")) as SharedBrowserBuildInput
  const phase = (event: StorybookBuildPhaseEvent): void => {
    console.log(JSON.stringify({protocol: STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL, kind: "phase", event}))
  }
  phase({phase: "cache", state: "started", at: new Date().toISOString()})
  const restored = readSharedBrowserReceipt(input)
  phase({
    phase: "cache",
    state: "completed",
    at: new Date().toISOString(),
    cache: {status: restored === null ? "miss" : "hit", layer: "shared"},
  })
  const result = restored ?? {...await buildSharedBrowserAssets(input, phase), cacheHit: false}
  if (restored === null) saveSharedBrowserReceipt(result)
  writeFileSync(resultPath, JSON.stringify(result), {mode: 0o600})
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
