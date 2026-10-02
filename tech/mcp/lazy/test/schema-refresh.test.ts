import {expect, test} from "bun:test"
import {connectLazyFixture, createLazyFixture} from "./fixture"

test("тот же native MCP connection обновляет schema и transitive handler вместе", async () => {
  const fixture = createLazyFixture()
  const connection = await connectLazyFixture(fixture)
  try {
    const before = await connection.client.listTools()
    const initial = before.tools.find(tool => tool.name === "echo")!
    expect(initial.inputSchema).toMatchObject({type: "object", required: ["text"], additionalProperties: false})
    expect((await connection.client.callTool({name: "echo", arguments: {text: "first"}})).structuredContent)
      .toEqual({version: "v1", value: "first"})
    const serverInfo = connection.client.getServerVersion()

    fixture.updateHandler("v2")
    fixture.updateSchema("v2")
    const after = await connection.client.listTools(undefined, {cacheMode: "refresh"})
    const refreshed = after.tools.find(tool => tool.name === "echo")!
    expect(refreshed.inputSchema).toMatchObject({type: "object", required: ["value"], additionalProperties: false})
    expect(Object.keys(refreshed.inputSchema.properties ?? {})).toEqual(["value"])
    expect((await connection.client.callTool({name: "echo", arguments: {value: "next"}})).structuredContent)
      .toEqual({version: "v2", value: "next"})
    expect((await connection.client.callTool({name: "echo", arguments: {text: "obsolete"}})).isError)
      .toBeTrue()
    expect(connection.client.getServerVersion(), "Factory update не меняет native parent connection identity")
      .toEqual(serverInfo)
  } finally {
    await connection.close()
    fixture.dispose()
  }
}, 30_000)
