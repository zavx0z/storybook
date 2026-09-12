/**
Проверяет соответствие тестовых скриптов объявленным сценариям пакета.
Данные подготавливает [фикстура](./fixture/index.ts) до регистрации групп.
При наличии сценариев проверяется отдельный скрипт для каждого варианта;
при отсутствии — отсутствие скриптов сценариев. Неприменимая группа пропускается.
`PACKAGE_PATH` задаёт входной путь, по умолчанию используется пакет Specs.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {fileURLToPath} from "node:url"
import {createScriptFixture} from "./fixture"

const inputPath = process.env.PACKAGE_PATH ?? fileURLToPath(new URL("../../specs/", import.meta.url))
const scriptFixture = await createScriptFixture(inputPath)

/**
Проверяет покрытие объявленных сценариев отдельными скриптами.

@remarks
Если файл сценариев отсутствует или не содержит вариантов, покрывать нечего,
поэтому группа пропускается. Отсутствие лишних скриптов проверяет следующая группа.
*/
describe.skipIf(!scriptFixture.hasScenarios).each([
  {
    name: "Каждый сценарий пакета имеет отдельный тестовый скрипт",
    props: {path: scriptFixture.path, actual: scriptFixture.missingScripts},
    fail: "Для каждого объявленного сценария нужен скрипт, выбирающий только этот сценарий",
  },
])("$name", ({props, fail}) => {
  test("Скрипты покрывают каждый вариант", () => {
    expect(props.actual, fail).toEqual([])
  })
})

/**
Проверяет отсутствие скриптов сценариев, когда сценарии не объявлены.

@remarks
При наличии сценариев группа пропускается: скрипты для них допустимы,
а полнота покрытия проверяется предыдущей группой.
*/
describe.skipIf(scriptFixture.hasScenarios).each([
  {
    name: "Скрипты сценариев соответствуют их наличию",
    props: {path: scriptFixture.path, actual: scriptFixture.scriptNames},
    fail: "Скрипты сценариев допустимы только при наличии объявленных сценариев",
  },
])("$name", ({props, fail}) => {
  test("При отсутствии сценариев отсутствуют скрипты их запуска", () => {
    expect(props.actual, fail).toEqual([])
  })
})
