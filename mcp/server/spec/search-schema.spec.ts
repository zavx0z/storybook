import {describe, expect, test} from "bun:test"
import {STORYBOOK_MCP_SCHEMA_VERSION} from "../../../server/controller-contract"
import {storybookSearchSchema} from "../src/schemas"

describe("Виды узлов поиска Storybook", () => {
  const input = {schemaVersion: STORYBOOK_MCP_SCHEMA_VERSION, query: "fixture"}

  test("принимает виды действующего графа", () => {
    expect(storybookSearchSchema.safeParse({...input, kinds: ["package", "directory", "unavailable"]}).success).toBeTrue()
  })

  test.each(["workspace", "project", "category", "subject", "variant"])("отклоняет выведенный вид %s", kind => {
    expect(storybookSearchSchema.safeParse({...input, kinds: [kind]}).success).toBeFalse()
  })
})
