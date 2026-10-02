import {expect, test} from "bun:test"
import {existsSync} from "node:fs"
import {join} from "node:path"
import {captureResult, captureUri, connectLazyFixture, createLazyFixture, png, waitFor} from "./fixture"

test("native ресурсы, templates и весь capture ответ переживают exit transient handler", async () => {
  const fixture = createLazyFixture()
  const connection = await connectLazyFixture(fixture)
  try {
    const resources = await connection.client.listResources()
    expect(resources.resources.map(resource => resource.uri).sort())
      .toEqual([captureUri, "fixture://items/example", "fixture://state"].sort())
    const templates = await connection.client.listResourceTemplates()
    expect(templates.resourceTemplates).toEqual([{
      name: "item", uriTemplate: "fixture://items/{id}", description: "Элемент по адресу", mimeType: "text/plain",
    }])
    expect((await connection.client.readResource({uri: "fixture://items/example"})).contents)
      .toEqual([{uri: "fixture://items/example", mimeType: "text/plain", text: "v1:example"}])
    expect((await connection.client.readResource({uri: "fixture://state"})).contents)
      .toEqual([{uri: "fixture://state", mimeType: "text/plain", text: "v1:state"}])

    const capture = await connection.client.callTool({name: "capture", arguments: {}})
    expect(capture, "MCP переносит text, image, resource_link, nested structuredContent и metadata целиком")
      .toEqual(captureResult)
    await waitFor(() => existsSync(join(fixture.root, "capture.exited")), "capture worker не завершился")
    const retained = await connection.client.readResource({uri: captureUri}, {cacheMode: "refresh"})
    expect(retained.contents, "Позднее чтение не зависит от memory завершившегося capture worker")
      .toEqual([{uri: captureUri, mimeType: "image/png", blob: png}])
    fixture.updateHandler("v2")
    expect((await connection.client.readResource({uri: "fixture://state"}, {cacheMode: "refresh"})).contents)
      .toEqual([{uri: "fixture://state", mimeType: "text/plain", text: "v2:state"}])
    expect((await connection.client.readResource({uri: captureUri}, {cacheMode: "refresh"})).contents)
      .toEqual([{uri: captureUri, mimeType: "image/png", blob: png}])
  } finally {
    await connection.close()
    fixture.dispose()
  }
}, 30_000)
