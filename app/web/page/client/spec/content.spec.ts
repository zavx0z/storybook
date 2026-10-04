/** Документы раскрываются по выбранному узлу, с сохранением границы ревизии.
@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import Client from "@zavx0z/storybook-app-web-page-client"
import {controlledFetcher, documentedNode, emptySnapshot} from "./fixture/transport"

const documents = [{direction: "input" as const, document: {name: "Input", declarations: []}}]

describe.each([
  {name: "Контракт из каталога", view: "contract" as const, field: "contractDocuments" as const, value: documents},
  {name: "Зависимости из каталога", view: "dependencies" as const, field: "dependencyCases" as const, value: []},
])("$name", ({view, field, value}) => {
  const snapshot = {...emptySnapshot, rootIds: [documentedNode.id], nodes: [documentedNode]}
  const content = {nodeId: documentedNode.id, graphDigest: snapshot.graphDigest, [field]: value}

  test("читает один узел и не добавляет документы в общее дерево", async () => {
    const fetcher = controlledFetcher(async () => Response.json(content))
    const signal = new AbortController().signal
    const node = await Client.readExternalStorybookNodeContent(snapshot, documentedNode.id, view, fetcher, signal)
    expect(node[field]).toEqual(value)
    expect(snapshot.nodes[0]).not.toHaveProperty(field)
    const query = new URLSearchParams({nodeId: documentedNode.id, graphDigest: snapshot.graphDigest})
    expect(fetcher.mock.calls).toEqual([[`/api/client/node?${query}`, {headers: {accept: "application/json"}, signal}]])
  })

  test("готовая ревизия сохраняет свои документы без чтения более нового каталога", async () => {
    const node = {...documentedNode, [field]: value}
    const revision = {...snapshot, nodes: [node]}
    const fetcher = controlledFetcher(async () => { throw new Error("Unexpected fetch") })
    expect(await Client.readExternalStorybookNodeContent(revision, node.id, view, fetcher)).toBe(node)
    expect(fetcher).not.toHaveBeenCalled()
  })

  test("ошибки HTTP, identity и версии не превращаются в пустой документ", async () => {
    const stale = controlledFetcher(async () => new Response("Changed", {status: 409}))
    await expect(Client.readExternalStorybookNodeContent(snapshot, documentedNode.id, view, stale)).rejects.toThrow("409")
    for (const invalid of [null, {...content, nodeId: "another"}, {...content, graphDigest: "newer"}, {...content, [field]: undefined}]) {
      const fetcher = controlledFetcher(async () => Response.json(invalid))
      await expect(Client.readExternalStorybookNodeContent(snapshot, documentedNode.id, view, fetcher)).rejects.toThrow()
    }
  })

  test("отмена незавершённого чтения передаётся транспорту", async () => {
    const controller = new AbortController()
    const fetcher = controlledFetcher(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), {once: true})
    }))
    const pending = Client.readExternalStorybookNodeContent(snapshot, documentedNode.id, view, fetcher, controller.signal)
    controller.abort(new Error("Navigation changed"))
    await expect(pending).rejects.toThrow("Navigation changed")
  })
})
