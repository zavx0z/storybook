import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readPackageReadme} from "@archetypes/package/readme"

describe.each([
  {name: "Обзор пакета", props: {path: resolve(import.meta.dir, "../..")}},
])("$name", async ({props}) => {
  const result = await readPackageReadme(props)

  test("Авторское объяснение", () => {
    expect(result.content, "README выбранного пакета раскрывает его назначение и принадлежит этому пакету").toMatch(/\S/u)
  })
})
