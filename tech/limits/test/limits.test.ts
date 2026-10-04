import {expect, test} from "bun:test"
import limits from "@zavx0z/storybook-tech-limits"

test("лимиты транспорта не содержат общего срока сборки и сценария", () => {
  expect(Object.keys(limits).some(key => key.includes("COMPILE") || key.includes("SCENARIO"))).toBeFalse()
  expect(limits.STORYBOOK_SERVER_IDLE_TIMEOUT_SECONDS).toBeLessThanOrEqual(255)
})
