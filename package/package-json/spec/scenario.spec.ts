import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import readPackageJson from "@archetypes/package-json"

describe.each([
  {
    name: "package.json",
    fail: "Содержимое package.json должно соответствовать контракту пакета",
    props: {
      path: resolve(import.meta.dir, "../../package.json"),
    },
  },
  {
    name: "Среда разработки Repo",
    props: {path: resolve(import.meta.dir, "../../../package.json")},
    engines: {bun: "1.4.x"},
  },
])("$name", async ({props, engines}) => {
  const result = await readPackageJson(props)

  const fields = [
    {field: "name"},
    {field: "description"},
    {field: "exports"},
  ]

  test.each(fields)("Содержит обязательное поле $field", ({field}) => {
    expect(result, `В package.json должно присутствовать поле ${field}`).toHaveProperty(field)
  })

  test("Не содержит других полей", () => {
    const extraFields = Object.keys(result ?? {}).filter(key => !["label", "workspaces", "engines"].includes(key) && !["dependencies", "peerDependencies", "optionalDependencies", "devDependencies"].includes(key) && !fields.some(({field}) => field === key))
    expect(extraFields, "В package.json не должно быть полей вне проверяемого состава").toEqual([])
  })

  test("Подпись необязательна, но заданная подпись содержательна", () => {
    if (result.label !== undefined) expect(result.label, "Заданная подпись объясняет предмет пакета человеку").toMatch(/\S/u)
  })

  /** @remarks Объявление среды применимо к примеру корневого манифеста Repo. */
  describe.skipIf(engines === undefined)("Среда Repo", () => {
    test("Объявленный диапазон", () => {
      expect(result.engines, "Читатель сохраняет выбранную Repo линию Bun без фиксации патча")
        .toEqual({bun: "1.4.x"})
    })
  })
})
