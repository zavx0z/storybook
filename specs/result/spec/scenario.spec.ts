/**
Проверяет получение данных Package через вариант «Пакет» спецификации Specs.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {fileURLToPath} from "node:url"
import readPackageNode from "@mcp-rest/package"
import {snapshotPath} from "../../../tests/fixture/snapshot-paths"

describe.each([
  {
    name: "Пакет",
    props: {
      path: fileURLToPath(new URL("../../../package/reader", import.meta.url))
    },
    expected: {
      result: {
        scenario: expect.objectContaining({
          path: fileURLToPath(new URL("../../../package/reader/spec/scenario.spec.ts", import.meta.url)),
          exitCode: 0,
          calls: expect.arrayContaining([
            expect.objectContaining({name: "default", describe: ["Архетип пакета"]}),
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

  test("Сохраняет результат чтения спецификации", () => {
    const snapshot = {
      ...result,
      result: result.result && {
        ...result.result,
        scenario: result.result.scenario && {
          ...result.result.scenario,
          stderr: result.result.scenario.stderr.replace(/ \[\d+(?:\.\d+)?(?:ms|s)\]/g, ""),
          junit: result.result.scenario.junit.replace(/\btime="[^"]*"/g, 'time="<duration>"').split("\n"),
        },
      },
    }
    // Размещение Repo и зависимостей не входит в содержание; все остальные строки сохраняются.
    expect(JSON.parse(JSON.stringify(snapshot, (_key, value: unknown) =>
      typeof value === "string"
        ? value.includes("\n") ? snapshotPath(value).split("\n") : snapshotPath(value)
        : value))).toMatchSnapshot()
  })
})
