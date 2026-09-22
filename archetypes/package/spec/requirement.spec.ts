/**
Проверяет соответствие тестовых скриптов объявленным сценариям пакета.
Данные подготавливает [фикстура](./fixture/index.ts) из props выбранного варианта.
При наличии сценариев проверяется отдельный скрипт для каждого варианта;
при отсутствии — отсутствие скриптов сценариев. Неприменимая группа пропускается.
Путь передаётся через props.path; по умолчанию используется пакет Specs.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {fileURLToPath} from "node:url"
import {createScriptFixture} from "./fixture"

describe.each([
  {
    name: "Скрипты сценариев пакета",
    props: {path: fileURLToPath(new URL("../../specs/", import.meta.url))},
  },
])("$name", async ({props}) => {
  const result = await createScriptFixture(props.path)

  /** @remarks При отсутствии сценариев покрывать нечего. */
  test.skipIf(!result.hasScenarios)("Скрипты покрывают каждый вариант", () => {
    expect(result.missingScripts, "Для каждого объявленного сценария нужен скрипт, выбирающий только этот сценарий").toEqual([])
  })

  /** @remarks При наличии сценариев скрипты для них допустимы. */
  test.skipIf(result.hasScenarios)("При отсутствии сценариев отсутствуют скрипты их запуска", () => {
    expect(result.scriptNames, "Скрипты сценариев допустимы только при наличии объявленных сценариев").toEqual([])
  })
})
