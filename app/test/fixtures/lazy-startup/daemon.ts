/**
Минимальный принадлежащий тесту daemon. Использует штатные ServerState identity,
startup candidate и authority; не копирует private server protocol или запись.
Сборка, discovery, Browser и canonical daemon в этом fixture не запускаются.
*/
import ServerState from "@zavx0z/storybook-app-server-state"
import {appendFileSync, existsSync, rmSync, writeFileSync} from "node:fs"
import {join} from "node:path"

const stateRoot = Bun.env.STORYBOOK_STATE_ROOT
const leasePath = Bun.env.STORYBOOK_START_LEASE_PATH
const leaseToken = Bun.env.STORYBOOK_START_LEASE_TOKEN
if (Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE !== "isolated" || !stateRoot || !leasePath || !leaseToken) {
  throw new Error("lazy-startup daemon requires isolated state and an App-owned startup lease")
}
const statePath = ServerState.externalStorybookServerStatePath()
const toolRoot = process.cwd()
let record: ReturnType<typeof ServerState.createExternalStorybookServerRecord>
let closing = false

const stop = () => {
  if (closing) return
  closing = true
  if (existsSync(statePath) && ServerState.readExternalStorybookServerRecord(statePath).instanceId === record.instanceId) {
    rmSync(statePath)
  }
  writeFileSync(join(stateRoot, "daemon.stopped"), String(process.pid))
  server.stop(true)
  process.exit(0)
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(Bun.env.STORYBOOK_SERVER_PORT ?? 0),
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === "/api/health" && request.method === "GET") return Response.json({ok: true})
    if (path === "/api/client" && request.method === "GET") return Response.json({
      graphDigest: "fixture-graph", rootIds: [], nodes: [], packages: [],
    })
    ServerState.assertExternalStorybookControlRequest(request, record)
    if (path === "/api/control/status" && request.method === "GET") return Response.json({
      ok: true, instanceId: record.instanceId, origin: record.origin,
      registryRevision: "fixture-registry", graphDigest: "fixture-graph", entries: [], packages: [], declarationErrors: [],
    })
    if (path === "/api/control/refresh" && request.method === "POST") return Response.json({ok: true})
    if (path === "/api/control/stop" && request.method === "POST") {
      const input = await request.json() as {confirm?: unknown}
      if (input.confirm !== true) return Response.json({error: "confirm required"}, {status: 400})
      setTimeout(stop, 25)
      return Response.json({ok: true})
    }
    return Response.json({error: "Fixture endpoint not found"}, {status: 404})
  },
})
record = ServerState.createExternalStorybookServerRecord({
  toolRoot,
  origin: server.url.origin,

  attachedDeclarations: [],
})
process.once("SIGTERM", stop)
process.once("SIGINT", stop)
appendFileSync(join(stateRoot, "daemon-starts.jsonl"), JSON.stringify({pid: process.pid, instanceId: record.instanceId}) + "\n")
ServerState.writeExternalStorybookStartCandidate({path: leasePath, token: leaseToken}, record)
