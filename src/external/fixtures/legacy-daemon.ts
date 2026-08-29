import {chmodSync, mkdirSync, unlinkSync, writeFileSync} from "node:fs"
import {dirname} from "node:path"
import {EXTERNAL_STORYBOOK_SERVER_PROTOCOL, readProcessStart} from "../server-state.ts"

const [statePath, toolRoot, declarationPath, portText] = process.argv.slice(2)
if (statePath === undefined || toolRoot === undefined || declarationPath === undefined || portText === undefined) {
  throw new Error("legacy-daemon requires statePath, toolRoot, declarationPath and port")
}
const port = Number(portText)
if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error("invalid legacy daemon port")

const removeState = (): void => {
  try {
    unlinkSync(statePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
}
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/api/health" && request.method === "GET") return Response.json({ok: true})
    if (url.pathname === "/api/stop" && request.method === "POST") {
      setTimeout(() => {
        removeState()
        server.stop(true)
        process.exit(0)
      }, 25)
      return Response.json({ok: true})
    }
    return new Response("not found", {status: 404})
  },
})
const processStart = readProcessStart(process.pid)
if (processStart === null) throw new Error("legacy daemon process identity unavailable")
mkdirSync(dirname(statePath), {recursive: true, mode: 0o700})
chmodSync(dirname(statePath), 0o700)
writeFileSync(statePath, JSON.stringify({
  protocol: EXTERNAL_STORYBOOK_SERVER_PROTOCOL,
  toolRoot,
  pid: process.pid,
  processStart,
  origin: server.url.origin,
  healthPath: "/api/health",
  websocketPath: "/api/events",
  attachedDeclarations: [declarationPath],
  startedAt: new Date().toISOString(),
}, null, 2) + "\n", {mode: 0o600})

const stop = (): void => {
  removeState()
  server.stop(true)
  process.exit(0)
}
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
