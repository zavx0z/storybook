import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import readScenario from "@archetypes/scenario-reader"
import Loader from "@package-build/loader"

const path = resolve(import.meta.dir, "../spec/fixture/slots/spec/scenario.spec.tsx")

describe("Слоты варианта", async () => {
  const report = await readScenario({path})
  if (report.preview?.kind !== "component") throw new Error(`Нет preview: ${report.stderr}`)
  const preview = report.preview

  test("свойства, именованный и безымянный слоты сохраняются отдельно", () => {
    expect(report.exitCode).toBe(0)
    expect(preview.variants[0]!.props).toEqual({label: "Панель"})
    expect(preview.variants[0]!.slots).toMatchObject({
      header: {source: '<Badge slot="header" label="Заголовок" />'},
      default: {source: '<Badge label="Содержимое" />'},
    })
    expect(preview.variants[1]!.slots).toEqual({})
    expect(preview.variants[0]!.source).toContain('  <Badge slot="header" label="Заголовок" />')
    expect(preview.variants[0]!.source).toContain('  <Badge label="Содержимое" />')
    expect(preview.variants[1]!.source).not.toContain("slots.")
    expect(preview.variants[1]!.source).not.toContain("{null}")
    expect(preview.variants[1]!.source).not.toContain("{undefined}")
    expect(preview.variants[1]!.source).toContain('<SlotPanel label={"Пустая панель"}>\n</SlotPanel>')
    expect(preview.variants[2]!.source).toContain('  <Badge slot="header" label="Заголовок" />\n</SlotPanel>')
  })

  test("браузерный модуль использует штатную передачу слотов Template", () => {
    expect(preview.module.source).toContain('<slot name="header" slot="header" />')
    expect(preview.module.source).toContain('<slot />')
    const modules = Loader.generateJsxModules([{...preview, nodeId: "slots"}])
    expect(modules).toHaveLength(3)
    expect(modules[0]!.source).toContain('<slot name="header" />')
  })

  test("повторный запуск меняет props, сохраняя слоты выбранного варианта", async () => {
    const selected = await readScenario({path, variant: 0, props: {label: "Изменённая панель"}})
    expect(selected.exitCode).toBe(0)
    expect(selected.preview?.variants).toHaveLength(1)
    if (selected.preview?.kind !== "component") throw new Error("Нет preview")
    expect(selected.preview.variants[0]!.slots).toEqual(preview.variants[0]!.slots)
    expect(selected.preview.variants[0]!.source).toContain('label={"Изменённая панель"}')
  }, 30000)
})
