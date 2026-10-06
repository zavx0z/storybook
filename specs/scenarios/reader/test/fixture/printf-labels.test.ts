import {describe, expect, test} from "bun:test"

describe.each(["page", null])("группа %s", value => {
  test.each(["package", null, false])("обновление %s", item => {
    expect(item).toBe(item)
  })
  test.each([["left", "right"], [null, "right"]])("пара %s %s", (left, right) => {
    expect(right).toBe("right")
  })
  test.each(["value"])("литерал %%s и %s", item => {
    expect(item).toBe("value")
  })
})
