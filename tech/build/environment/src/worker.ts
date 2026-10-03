import {readFileSync, writeFileSync} from "node:fs"
import Scheduler from "@package-build/scheduler"
import {buildPlatform} from "./build"
import type {PlatformBuildInput} from "../contract/build"

const [jobPath, resultPath, workerId] = process.argv.slice(2)
if (!jobPath || !resultPath || !workerId) throw new Error("Platform worker requires an exact job and nonce")
const protocol = Scheduler.STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL
console.log(JSON.stringify({protocol, kind: "ready", workerId, pid: process.pid}))
try {
  const input = JSON.parse(readFileSync(jobPath, "utf8")) as PlatformBuildInput
  const result = await buildPlatform(input, event => console.log(JSON.stringify({protocol, kind: "phase", event})))
  writeFileSync(resultPath, JSON.stringify(result), {mode: 0o600})
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  writeFileSync(resultPath, JSON.stringify({error: message}), {mode: 0o600})
  console.error(message)
  process.exitCode = 1
}
