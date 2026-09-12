/**
 Проверяет минимальный ответ сущности package в MCP.

 Вариант выбирает узел `archetypes` и передаёт путь к минимальной фикстуре
 package.json. Сценарий проверяет только node, description из manifest и пустые
 children; обход структуры пакета здесь не выполняется.

 @packageDocumentation
 */
import {describe, expect, test} from "bun:test"
import {fileURLToPath} from "node:url"
import {readPackageNode} from ".."

const fixture = fileURLToPath(new URL("./fixture/archetypes/", import.meta.url))

describe.each([
  {
    name: "Корневой пакет",
    props: {
      node: "archetypes",
      path: fixture
    },
    expected: {
      node: "archetypes",
      description: "Описание узла Archetypes из package.json",
      children: []
    },
  },
])("$name", ({props, expected}) => {
  test.each([{
    runtime: async () => {
      return readPackageNode(props.node, props.path)
    }
  }])("Возвращает описание из package.json и пустые children", async ({runtime}) => {
    expect(await runtime()).toEqual(expected)
  })
})
