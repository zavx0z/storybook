import {afterEach, describe, expect, test} from "bun:test"
import {fileURLToPath} from "node:url"
import {Client} from "@modelcontextprotocol/client"
import {getDefaultEnvironment, StdioClientTransport} from "@modelcontextprotocol/client/stdio"

const MCP_ROOT = fileURLToPath(new URL("./", import.meta.url))
const MCP_ENTRY = fileURLToPath(new URL("./stdio.ts", import.meta.url))
let transport: StdioClientTransport | undefined

afterEach(async () => {
  await transport?.close()
  transport = undefined
})

describe("empty Storybook MCP", () => {
  test("connects over stdio and exposes no tools", async () => {
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [`--cwd=${MCP_ROOT}`, "run", MCP_ENTRY],
      cwd: "/tmp",
      env: getDefaultEnvironment(),
      stderr: "pipe",
    })
    const client = new Client(
      {name: "storybook-mcp-test", version: "0.0.0"},
      {versionNegotiation: {mode: "auto", probe: {timeoutMs: 1_000}}},
    )
    await client.connect(transport)

    const tools = await client.listTools()
    expect(tools.tools).toEqual([])

    await client.close()
    transport = undefined
  }, 15_000)
})
