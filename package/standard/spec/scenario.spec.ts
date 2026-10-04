import {describe, expect, test} from "bun:test"
import standard from "@zavx0z/storybook-package-standard"

describe.each([
  {name: "Подтверждённый кандидат", props: {current: "transition" as const, status: "passed" as const}, expected: "strict"},
  {name: "Незавершённая проверка", props: {current: "transition" as const, status: "incomplete" as const}, expected: "transition"},
  {name: "Закреплённая строгость", props: {current: "strict" as const, status: "incomplete" as const}, expected: "strict"},
])("$name", ({props, expected}) => {
  const verification: NonNullable<Parameters<typeof standard.applied>[1]> = {status: props.status, diagnostics: []}
  const result = standard.applied(props.current, verification, [])

  test("Режим применённой ревизии", () => {
    expect(result, "Строгий режим появляется после полной успешной проверки и сохраняется при следующих применениях")
      .toBe(expected)
  })
})
