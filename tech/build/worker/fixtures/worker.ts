import {readFileSync, statSync, writeFileSync} from "node:fs"
import {dirname} from "node:path"
import type {WorkerFixtureJob} from "./prepare"

const [jobPath, resultPath, workerId] = process.argv.slice(2)
if (!jobPath || !resultPath || !workerId) throw new Error("Fixture argv is incomplete")
const job = JSON.parse(readFileSync(jobPath, "utf8")) as WorkerFixtureJob
if (job.ignoreTerm) process.on("SIGTERM", () => {})
if (job.termCleanupDelayMs !== undefined) {
  let closing = false
  process.on("SIGTERM", () => {
    if (closing) return
    closing = true
    setTimeout(() => {
      if (job.termCleanupPath !== undefined) writeFileSync(job.termCleanupPath, "completed")
      process.exit(0)
    }, job.termCleanupDelayMs)
  })
}
if (job.descendantPath) {
  const descendant = Bun.spawn([
    process.execPath,
    "-e",
    ['process.on("SIGTERM", () => {})', 'setInterval(() => {}, 1000)'].join("\n"),
  ], {stdin: "ignore", stdout: "ignore", stderr: "ignore"})
  writeFileSync(job.descendantPath, String(descendant.pid))
}
for (const record of job.records ?? ["ready", "phase"]) {
  const value = record === "ready" ? {kind: "ready", workerId, pid: process.pid}
    : record === "wrong-nonce" ? {kind: "ready", workerId: "foreign-nonce", pid: process.pid}
    : record === "wrong-pid" ? {kind: "ready", workerId, pid: process.pid + 1}
    : record === "phase" ? {kind: "phase", event: "compile"}
    : record === "unknown" ? {kind: "foreign"}
    : null
  const line = record === "malformed" ? "{bad-json"
    : record === "empty" ? "   " : JSON.stringify(value)
  process.stdout.write(line + (job.tail ? "" : "\n"))
}
if (job.floodBytes) process.stdout.write("x".repeat(job.floodBytes))
if (job.stderr) process.stderr.write(job.stderr)
if (job.resultMode !== "missing") {
  const result = job.resultMode === "metadata" ? {
    workerId,
    pid: process.pid,
    cwd: process.cwd(),
    jobMode: statSync(jobPath).mode & 0o777,
    directoryMode: statSync(dirname(jobPath)).mode & 0o777,
    directory: dirname(jobPath),
  } : job.result ?? null
  writeFileSync(resultPath, job.resultMode === "invalid" ? "{invalid"
    : JSON.stringify(job.resultMode === "large" ? "x".repeat(2048) : result))
}
if (job.hold) await new Promise(() => setInterval(() => {}, 1_000))
process.exitCode = job.exitCode ?? 0
