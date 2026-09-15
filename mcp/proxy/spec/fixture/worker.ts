import {mkdtempSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import {requestStorybook, type StorybookProxyInput} from "../../index"
import {createExternalStorybookServerRecord, writeExternalStorybookServerRecord} from "../../../../server/server-state.ts"
import {externalStorybookControlAuthorization} from "../../../../server/security.ts"
import type {ProxyStep} from "./index"

const {steps, request} = await Bun.stdin.json() as {steps: ProxyStep[], request: StorybookProxyInput}
const stateRoot = mkdtempSync(join(tmpdir(), "storybook-proxy-"))
Bun.env.STORYBOOK_STATE_ROOT = stateRoot
const servers: ReturnType<typeof Bun.serve>[] = []
const requests: unknown[] = []
const replies: unknown[] = []
const errors: unknown[] = []
let current: ProxyStep = {}

function startEndpoint() {
  const number = servers.length
  let authorization = ""
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(incoming) {
      requests.push({input: await incoming.json(), path: new URL(incoming.url).pathname, authorized: incoming.headers.get("authorization") === authorization, server: number})
      return current.body === undefined
        ? Response.json(current.reply ?? {}, {status: current.httpStatus ?? 200})
        : new Response(current.body, {status: current.httpStatus ?? 200, headers: {"content-type": "application/json"}})
    },
  })
  servers.push(server)
  const record = createExternalStorybookServerRecord({toolRoot: resolve(import.meta.dir, "../../../.."), origin: server.url.origin, implementationDigest: "a".repeat(64)})
  authorization = externalStorybookControlAuthorization(record.controlToken)
  writeExternalStorybookServerRecord(join(stateRoot, "server.json"), record)
}

try {
  startEndpoint()
  for (const step of steps) {
    current = step
    if (step.switchServer) startEndpoint()
    const controller = new AbortController()
    if (step.abort) controller.abort()
    try {
      replies.push(await requestStorybook(request, controller.signal))
    } catch (error) {
      errors.push({name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error)})
    }
  }
  process.stdout.write(JSON.stringify({replies, errors, requests}))
} finally {
  for (const server of servers) await server.stop(true)
  rmSync(stateRoot, {recursive: true, force: true})
}
