import {afterEach, describe, expect, test} from "bun:test"
import {fileURLToPath} from "node:url"
import {Client, InMemoryTransport} from "@modelcontextprotocol/client"
import {getDefaultEnvironment, StdioClientTransport} from "@modelcontextprotocol/client/stdio"
import type {McpServer} from "@modelcontextprotocol/server"
import type {ExternalStorybookController} from "../src/external/controller-contract.ts"
import {STORYBOOK_TOOL_NAMES} from "./schemas.ts"
import {createStorybookMcpServer} from "./server.ts"

const MCP_ENTRY = fileURLToPath(new URL("./stdio.ts", import.meta.url))
const transports: Array<{close(): Promise<void>}> = []
const servers: McpServer[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
  for (const transport of transports.splice(0)) await transport.close()
})

describe("Storybook MCP stdio", () => {
  test("connects from /tmp without cwd override and advertises exact tools/resources but no prompts", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["run", MCP_ENTRY],
      cwd: "/tmp",
      env: getDefaultEnvironment(),
      stderr: "pipe",
    })
    transports.push(transport)
    const client = createClient()
    await client.connect(transport)

    const tools = await client.listTools()
    expect(tools.tools.map(({name}) => name)).toEqual([...STORYBOOK_TOOL_NAMES])
    for (const tool of tools.tools) {
      expect(tool.inputSchema).toMatchObject({type: "object", additionalProperties: false})
    }
    const resources = await client.listResources()
    expect(resources.resources.map(({uri}) => uri)).toEqual(["storybook://state", "storybook://graph"])
    const templates = await client.listResourceTemplates()
    expect(templates.resourceTemplates.map(({uriTemplate}) => uriTemplate)).toEqual([
      "storybook://packages/{encodedPackageId}",
      "storybook://views/{viewId}",
      "storybook://captures/{captureId}",
    ])
    expect((await client.listPrompts()).prompts).toEqual([])

    await client.close()
    transports.splice(transports.indexOf(transport), 1)
  }, 20_000)

  test("rejects unknown fields and bounded timeout violations before controller dispatch", async () => {
    const controller = mockController()
    const {client} = await inMemoryClient(controller)
    const unknown = await client.callTool({
      name: "storybook_status",
      arguments: {schemaVersion: 1, unexpected: true},
    })
    expect(unknown.isError).toBeTrue()
    const browserActivation = await client.callTool({
      name: "storybook_open",
      arguments: {schemaVersion: 1, packageId: "@fixture/a", activate: true},
    })
    expect(browserActivation.isError).toBeTrue()
    const timeout = await client.callTool({
      name: "storybook_wait",
      arguments: {schemaVersion: 1, packageId: "@fixture/a", condition: "ready", timeoutMs: 120_001},
    })
    expect(timeout.isError).toBeTrue()
    const unconfirmedStop = await client.callTool({
      name: "storybook_stop",
      arguments: {schemaVersion: 1, confirm: false},
    })
    expect(unconfirmedStop.isError).toBeTrue()
    expect(controller.calls).toEqual([])
  })

  test("returns structured controller results and PNG image content without transport identities", async () => {
    const controller = mockController()
    const {client} = await inMemoryClient(controller)
    const status = await client.callTool({
      name: "storybook_status",
      arguments: {schemaVersion: 1, includeViews: true},
    })
    expect(status.structuredContent).toEqual({
      status: "success",
      server: "running",
      origin: "[storybook-origin]",
    })
    const capture = await client.callTool({
      name: "storybook_capture",
      arguments: {schemaVersion: 1, viewId: viewId(), area: "preview"},
    })
    expect(capture.structuredContent).toMatchObject({
      status: "success",
      captureId: "capture_fixture",
      resourceUri: "storybook://captures/capture_fixture",
    })
    expect(capture.content.some((item) => item.type === "image" && item.mimeType === "image/png")).toBeTrue()
    expect(JSON.stringify(capture)).not.toContain("TARGET_SECRET")
  })

  test("keeps inspect, wait and interaction schemas aligned with the bridge", async () => {
    const controller = mockController()
    const {client} = await inMemoryClient(controller)
    const validCursor = await client.callTool({
      name: "storybook_inspect",
      arguments: {schemaVersion: 1, viewId: viewId(), include: ["canvas"], cursor: "offset:80", maxDepth: 12},
    })
    expect(validCursor.isError).not.toBeTrue()
    for (const request of [
      {name: "storybook_interact", arguments: {
        schemaVersion: 1, viewId: viewId(), target: {nodeId: "node:1"}, action: "drag", value: {dx: 1, dy: 1},
      }},
      {name: "storybook_interact", arguments: {
        schemaVersion: 1, viewId: viewId(), target: {nodeId: "node:1"}, action: "wheel", value: {deltaY: 10_000},
      }},
    ]) expect((await client.callTool(request)).isError).not.toBeTrue()
    for (const request of [
      {name: "storybook_inspect", arguments: {schemaVersion: 1, viewId: viewId(), maxDepth: 13}},
      {name: "storybook_inspect", arguments: {schemaVersion: 1, viewId: viewId(), include: ["canvases"]}},
      {name: "storybook_wait", arguments: {
        schemaVersion: 1, viewId: viewId(), condition: "built", timeoutMs: 1_000,
      }},
      {name: "storybook_interact", arguments: {
        schemaVersion: 1, viewId: viewId(), target: {nodeId: "node:1"}, action: "drag",
      }},
      {name: "storybook_interact", arguments: {
        schemaVersion: 1, viewId: viewId(), target: {nodeId: "node:1"}, action: "wheel", value: {deltaX: 1},
      }},
      {name: "storybook_interact", arguments: {
        schemaVersion: 1, viewId: viewId(), target: {nodeId: "node:1"}, action: "wheel", value: {deltaY: 10_001},
      }},
      {name: "storybook_interact", arguments: {
        schemaVersion: 1, viewId: viewId(), target: {nodeId: "node:1"}, action: "click", timeoutMs: 30_001,
      }},
    ]) {
      expect((await client.callTool(request)).isError).toBeTrue()
    }
    expect(controller.calls).toEqual(["inspect", "interact", "interact"])
  })

  test("serves canonical resources through the same injected controller", async () => {
    const controller = mockController()
    const {client} = await inMemoryClient(controller)
    const state = await client.readResource({uri: "storybook://state"})
    expect(state.contents).toEqual([{
      uri: "storybook://state",
      mimeType: "application/json",
      text: JSON.stringify({status: "success", uri: "storybook://state"}),
    }])
    const capture = await client.readResource({uri: "storybook://captures/capture_fixture"})
    expect(capture.contents).toEqual([{
      uri: "storybook://captures/capture_fixture",
      mimeType: "image/png",
      blob: Buffer.from("png").toString("base64"),
    }])
  })

  test("two MCP clients can reuse one controller instance", async () => {
    const controller = mockController()
    const first = await inMemoryClient(controller)
    const second = await inMemoryClient(controller)
    await Promise.all([
      first.client.callTool({name: "storybook_status", arguments: {schemaVersion: 1}}),
      second.client.callTool({name: "storybook_status", arguments: {schemaVersion: 1}}),
    ])
    expect(controller.calls).toEqual(["status", "status"])
    await Promise.all([first.client.close(), second.client.close()])
    expect(controller.calls).not.toContain("stop")
  })

  test("scrubs resources and thrown transport/capability diagnostics", async () => {
    const controller = mockController()
    controller.inspect = async () => {
      throw new Error("No target with id PRIVATE_TARGET; capability token FAKE_MASTER_CAPABILITY; /Users/owner/private.ts")
    }
    const {client} = await inMemoryClient(controller)
    const failed = await client.callTool({
      name: "storybook_inspect",
      arguments: {schemaVersion: 1, viewId: viewId()},
    })
    controller.readResource = async () => {
      throw new Error("No target with id PRIVATE_RESOURCE_TARGET; control token PRIVATE_RESOURCE_TOKEN; /Users/owner/resource.ts")
    }
    const state = await client.readResource({uri: "storybook://state"})
    const serialized = JSON.stringify({failed, state})
    expect(serialized).not.toContain("PRIVATE_TARGET")
    expect(serialized).not.toContain("FAKE_MASTER_CAPABILITY")
    expect(serialized).not.toContain("/Users/owner")
    expect(serialized).not.toContain("PRIVATE_RESOURCE_TARGET")
    expect(serialized).not.toContain("PRIVATE_RESOURCE_TOKEN")
    expect(serialized).toContain("[opaque]")
    expect(serialized).toContain("[redacted]")
    expect(serialized).toContain("[owner-path]")
  })
})

function createClient(): Client {
  return new Client(
    {name: "storybook-mcp-test", version: "1.0.0"},
    {versionNegotiation: {mode: "auto", probe: {timeoutMs: 1_000}}},
  )
}

async function inMemoryClient(controller: ExternalStorybookController & {calls: string[]}) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createStorybookMcpServer({controller})
  servers.push(server)
  const client = createClient()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return {client, server}
}

function mockController(): ExternalStorybookController & {calls: string[]} {
  const calls: string[] = []
  const result = (name: string) => async () => {
    calls.push(name)
    return {status: "success" as const, operation: name}
  }
  return {
    calls,
    ensure: result("ensure"),
    async status() {
      calls.push("status")
      return {
        status: "success",
        server: "running",
        origin: "http://127.0.0.1:43123",
        targetId: "TARGET_SECRET",
        url: "http://127.0.0.1:43123/packages/a/",
        dependencyRealpaths: ["/Users/owner/private/source.ts"],
        entryRelativePath: "entry.js",
        revisions: [{revision: "private"}],
      }
    },
    attach: result("attach"),
    detach: result("detach"),
    search: result("search"),
    open: result("open"),
    wait: result("wait"),
    inspect: result("inspect"),
    interact: result("interact"),
    async capture() {
      calls.push("capture")
      return {
        status: "success",
        captureId: "capture_fixture",
        resourceUri: "storybook://captures/capture_fixture",
        mimeType: "image/png",
        image: {data: Buffer.from("png").toString("base64"), mimeType: "image/png"},
      }
    },
    check: result("check"),
    close: result("close"),
    stop: result("stop"),
    async readResource(uri) {
      calls.push("readResource")
      if (uri.startsWith("storybook://captures/")) {
        return {
          status: "success",
          uri,
          mimeType: "image/png",
          blob: Buffer.from("png").toString("base64"),
        }
      }
      return {
        status: "success",
        uri,
        mimeType: "application/json",
        text: JSON.stringify({
          status: "success",
          uri,
          controlToken: "FAKE_MASTER_CAPABILITY",
          dependencyRealpaths: ["/Users/owner/private/runtime.ts"],
        }),
      }
    },
  }
}

function viewId(): string {
  return `storybook-view-v1_${"a".repeat(43)}`
}
