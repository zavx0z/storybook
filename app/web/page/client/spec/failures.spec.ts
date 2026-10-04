import {expect, test} from "bun:test"
import Client from "@storybook-app-web-page/client"
import {controlledFetcher, documentedNode, emptySnapshot} from "./fixture/transport"

test("ошибка HTTP не становится снимком каталога", async () => {
  const fetcher = controlledFetcher(async _input => new Response("Недоступно", {status: 503}))
  await expect(Client.fetchExternalStorybookClientSnapshot(fetcher)).rejects.toThrow("request failed: 503")
})

test("отказ транспорта сохраняет исходную причину", async () => {
  const failure = new Error("Связь потеряна")
  const fetcher = controlledFetcher(async _input => { throw failure })
  await expect(Client.fetchExternalStorybookClientSnapshot(fetcher)).rejects.toBe(failure)
})

test.each([
  {name: "null", value: null, message: "must be an object"},
  {name: "массив", value: [], message: "must be an object"},
  {name: "другой протокол", value: {...emptySnapshot, protocol: "unknown"}, message: "Unsupported"},
  {name: "пустое имя проекта", value: {...emptySnapshot, projectName: " "}, message: "incomplete"},
  {name: "отсутствие graph digest", value: {...emptySnapshot, graphDigest: ""}, message: "incomplete"},
  {name: "отсутствие nodes", value: {...emptySnapshot, nodes: null}, message: "incomplete"},
  {name: "неизвестный корень", value: {...emptySnapshot, rootIds: ["missing"]}, message: "Unknown"},
  {name: "повтор identity", value: {...emptySnapshot, nodes: [documentedNode, documentedNode]}, message: "Invalid"},
])("не принимает повреждённый снимок: $name", async ({value, message}) => {
  const fetcher = controlledFetcher(async _input => Response.json(value))
  await expect(Client.fetchExternalStorybookClientSnapshot(fetcher)).rejects.toThrow(message)
})

test("поиск отсутствующей identity сообщает точный узел", () => {
  expect(() => Client.externalStorybookClientNode(emptySnapshot, "missing"))
    .toThrow("Unknown external Storybook client node: missing")
})

test("поиск не выбирает произвольный узел среди дубликатов", () => {
  const snapshot = {...emptySnapshot, nodes: [documentedNode, {...documentedNode}]}
  expect(() => Client.externalStorybookClientNode(snapshot, documentedNode.id))
    .toThrow(`Ambiguous external Storybook client node: ${documentedNode.id}`)
})

test("ошибка документации не превращается в пустой текст", async () => {
  const fetcher = controlledFetcher(async _input => new Response("Недоступно", {status: 404}))
  await expect(Client.readExternalStorybookNodeDocumentation(documentedNode, fetcher))
    .rejects.toThrow("documentation request failed: 404")
})
