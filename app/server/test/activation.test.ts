import {expect, test} from "bun:test"
import {
  isStorybookNavigationSupersededError,
} from "../src/activation.ts"

test("отличает уход страницы от настоящей ошибки монтирования", () => {
  expect(isStorybookNavigationSupersededError(new Error("Storybook agent bridge call failed: AbortError: Storybook view navigated to another package"))).toBe(true)
  expect(isStorybookNavigationSupersededError(new Error("Storybook view navigated away from the requested package"))).toBe(true)
  expect(isStorybookNavigationSupersededError(new Error("Storybook environment following was disabled before navigation"))).toBe(true)
  expect(isStorybookNavigationSupersededError(new Error("Storybook environment following was superseded before navigation"))).toBe(true)
  expect(isStorybookNavigationSupersededError(new DOMException("Mount failed", "AbortError"))).toBe(false)
  expect(isStorybookNavigationSupersededError(new Error("External Storybook page has no active package scope"))).toBe(false)
})
