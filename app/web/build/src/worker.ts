import {readFileSync, writeFileSync} from "node:fs"
import {buildSharedBrowserAssets} from "./browser-build"
import Scheduler from "@package-build/scheduler"
import type {SharedBrowserBuildInput} from "../contract/build"
import {readSharedBrowserEpoch, saveSharedBrowserCandidate} from "./receipt"

const STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL = Scheduler.STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL
type StorybookBuildPhaseEvent = Extract<NonNullable<ReturnType<typeof Scheduler.parseStorybookBuildWorkerTransportEvent>>, {kind: "phase"}>["event"]

const [jobPath, resultPath, workerId] = process.argv.slice(2)
if (!jobPath || !resultPath || !workerId) throw new Error("Shared browser worker requires an exact job and nonce")
console.log(JSON.stringify({protocol: STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL, kind: "ready", workerId, pid: process.pid}))
try {
  const input = JSON.parse(readFileSync(jobPath, "utf8")) as SharedBrowserBuildInput
  if (input.sharedKernel !== undefined) {
    const retained = readSharedBrowserEpoch(input.root, input.sharedKernel.epoch)
    if (!retained?.browserIdentity || JSON.stringify(retained.browserIdentity.modules) !== JSON.stringify(input.sharedKernel.modules)) throw new Error("Retained kernel does not match its saved artifact receipt")
  }
  const phase = (event: StorybookBuildPhaseEvent): void => {
    console.log(JSON.stringify({protocol: STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL, kind: "phase", event}))
  }
  const result = await buildSharedBrowserAssets(input, phase)
  saveSharedBrowserCandidate(result)
  writeFileSync(resultPath, JSON.stringify(result), {mode: 0o600})
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  writeFileSync(resultPath, JSON.stringify({error: message}), {mode: 0o600})
  console.error(message)
  process.exitCode = 1
}
