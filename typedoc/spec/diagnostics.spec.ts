/** Несоответствия документации обнаруживаются тем же сценарием TypeDoc, который вызывают другие владельцы. */
import {describe, expect, test} from "bun:test"
import {mkdir, mkdtemp, rm} from "node:fs/promises"
import {resolve} from "node:path"
import readScenario from "@zavx0z/storybook-specs-scenarios-reader"
describe.each([
  {name: "Нет описания", source: 'export type Value = string\n', point: "Описание у владельца"},
  {name: "Нет typeParam", source: '/** Результат переданной операции. */\nexport type Value<Prepared> = {value: Prepared}\n', point: "Generic-параметры"},
  {name: "Нет param", source: '/**\nСохраняет текст.\n@returns Полученный текст.\n*/\nexport function keep(value: string): string {return value}\n', point: "Параметры функций"},
  {name: "Описание метода спрятано внутри типа", source: '/** Публикация результата. */\nexport type Output = {\n/** Выполняет публикацию. */\npublish(): void\n}\n', point: "Члены объектного контракта"},
  {name: "Метод не описан у родителя", source: '/** Публикация результата. */\nexport type Output = {publish(): void}\n', point: "Члены объектного контракта"},
  {name: "Несуществующее свойство", source: '/**\nПараметры публикации.\n@property missing - Несуществующий член.\n*/\nexport type Input = {value: number}\n', point: "Члены объектного контракта"},
  {name: "Нет returns", source: '/** Возвращает сохранённую версию. */\nexport function read(): number {return 1}\n', point: "Результат и ошибки"},
  {name: "Нет throws", source: '/** Отклоняет публикацию. */\nexport function reject(): never {throw new Error("Отклонено")}\n', point: "Результат и ошибки"},
])("$name", ({source, point}) => {
  test("Сценарий сохраняет нарушение", async () => {
    const base = resolve(import.meta.dir, "../test/fixture")
    await mkdir(base, {recursive: true})
    const root = await mkdtemp(resolve(base, ".typedoc-"))
    try {
      await Bun.write(resolve(root, "package.json"), '{"name":"@typedoc-fixture/source","type":"module"}')
      await Bun.write(resolve(root, "tsconfig.json"), '{"compilerOptions":{"strict":true,"noEmit":true,"types":[]},"include":["*.ts"]}')
      const path = resolve(root, "index.ts")
      await Bun.write(path, source)
      const report = await readScenario({path: resolve(import.meta.dir, "scenario.spec.ts"), props: {paths: [path]}})
      expect(report.tests.find(test => test.label === point)?.status,
        "Проверку выполняет публичный сценарий владельца, а не её копия в потребителе").toBe("failed")
      expect(report.exitCode, "Нарушение документации не выдаётся за успешный запуск").not.toBe(0)
    } finally {
      await rm(root, {recursive: true, force: true})
    }
  }, 30_000)
})
