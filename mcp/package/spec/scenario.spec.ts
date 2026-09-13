/**
Проверяет получение данных Package через вариант «Пакет» спецификации Specs.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {fileURLToPath} from "node:url"
import {readPackageNode} from ".."

describe.each([
  {
    name: "Пакет",
    props: {
      path: fileURLToPath(new URL("../../../archetypes/package/", import.meta.url))
    },
    expected: {
      result: {
        scenario: expect.objectContaining({
          path: fileURLToPath(new URL("../../../archetypes/package/spec/scenario.spec.ts", import.meta.url)),
          exitCode: 0,
          calls: expect.arrayContaining([
            expect.objectContaining({name: "readPackage", describe: ["Корневой пакет"]}),
            expect.objectContaining({name: "readPackage", describe: ["Вложенный пакет"]}),
          ]),
        }),
      },
    },
  },
])("$name", async ({props, expected}) => {
  const result = await readPackageNode(props.path)

  test("Возвращает результат чтения спецификации пакета", () => {
    expect(result).toEqual(expected)
  })
})
