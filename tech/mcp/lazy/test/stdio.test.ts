import {expect, test} from "bun:test"
import {Client} from "@modelcontextprotocol/client"
import {getDefaultEnvironment, StdioClientTransport} from "@modelcontextprotocol/client/stdio"
import {join} from "node:path"
import {createLazyFixture} from "./fixture"

test("один реальный stdio connection обновляет schema и handler без нового transport процесса", async () => {
  const fixture = createLazyFixture()
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(import.meta.dir, "fixture/stdio.ts"), JSON.stringify(fixture.options)],
    cwd: fixture.root,
    env: getDefaultEnvironment(),
    stderr: "pipe",
  })
  transport.stderr?.on("data", () => {})
  const client = new Client({name: "native-lazy-stdio-client", version: "1"}, {
    versionNegotiation: {mode: "auto", probe: {timeoutMs: 1000}},
  })
  try {
    await client.connect(transport)
    const pid = transport.pid
    expect(pid).toBeGreaterThan(0)
    const tools = await client.listTools()
    expect(tools.tools.find(tool => tool.name === "echo")!.inputSchema.required).toEqual(["text"])
    expect((await client.callTool({name: "echo", arguments: {text: "stdio"}})).structuredContent)
      .toEqual({version: "v1", value: "stdio"})
    fixture.updateHandler("v2")
    fixture.updateSchema("v2")
    const updated = await client.listTools(undefined, {cacheMode: "refresh"})
    expect(updated.tools.find(tool => tool.name === "echo")!.inputSchema.required).toEqual(["value"])
    expect((await client.callTool({name: "echo", arguments: {value: "same-pipe"}})).structuredContent)
      .toEqual({version: "v2", value: "same-pipe"})
    expect((await client.callTool({name: "echo", arguments: {text: "old-schema"}})).isError).toBeTrue()
    expect(transport.pid, "Native parent stdio процесс остался тем же после source edits").toBe(pid)
  } finally {
    await client.close()
    await transport.close()
    fixture.dispose()
  }
}, 30_000)
