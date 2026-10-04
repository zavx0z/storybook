/**
Чтение серверного каталога и опубликованной документации через публичный Client.
Пустой каталог является полноценным результатом; отсутствие документации не
создаёт запрос к README. Узел выбирается с сохранением исходной object identity.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import Client from "@zavx0z/storybook-app-web-page-client"
import {controlledFetcher, documentedNode, emptySnapshot, undocumentedNode} from "./fixture/transport"

describe.each([
  {
    name: "Пустой каталог",
    props: {snapshot: emptySnapshot, url: undefined, documentation: null},
  },
  {
    name: "Опубликованная документация",
    props: {
      snapshot: {...emptySnapshot, rootIds: [documentedNode.id], nodes: [documentedNode]},
      url: "/api/client?project=example",
      documentation: "# Назначение\n\nОпубликованный текст владельца.",
    },
  },
  {
    name: "Документация отсутствует",
    props: {
      snapshot: {...emptySnapshot, rootIds: [undocumentedNode.id], nodes: [undocumentedNode]},
      url: "/api/client",
      documentation: null,
    },
  },
])("$name", async ({props}) => {
  const fetcher = controlledFetcher(async (_input, _init) => Response.json(props.snapshot))
  const actual = await Client.fetchExternalStorybookClientSnapshot(fetcher, props.url)

  test("Подтверждённый снимок", () => {
    expect(actual, "Client сохраняет полный транспортный снимок, включая допустимые пустые коллекции")
      .toEqual(props.snapshot)
  })

  test("Точный транспорт", () => {
    expect(fetcher.mock.calls, "Client читает заданный адрес один раз с запросом JSON")
      .toEqual([[props.url ?? "/api/client", {headers: {accept: "application/json"}}]])
  })

  /** @remarks Пустой каталог не содержит узла для выбора и чтения документации. */
  describe.skipIf(props.snapshot.nodes.length === 0)("Узел каталога", () => {
    test("Сохранение identity", () => {
      const node = actual.nodes[0]!
      expect(Client.externalStorybookClientNode(actual, node.id), "Поиск возвращает тот же узел подтверждённого снимка")
        .toBe(node)
    })

    test("Документация владельца", async () => {
      const node = actual.nodes[0]!
      const documentFetcher = controlledFetcher(async (_input, _init) => new Response(props.documentation))
      const documentation = await Client.readExternalStorybookNodeDocumentation(node, documentFetcher)
      expect(documentation, "Опубликованный текст читается как есть; отсутствие документации возвращает null")
        .toBe(props.documentation)
      expect(documentFetcher.mock.calls, "Запрос допустим только для узла с опубликованной документацией")
        .toEqual(node.hasModuleDocumentation
          ? [[node.resourceUrl, {headers: {accept: "text/markdown, text/plain"}}]]
          : [])
    })
  })
})
