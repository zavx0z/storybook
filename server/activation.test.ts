import {expect, test} from "bun:test"
import {
  assertStorybookActivationEvidence,
  isStorybookNavigationSupersededError,
} from "./activation.ts"

test("отличает уход страницы от настоящей ошибки монтирования", () => {
  expect(isStorybookNavigationSupersededError(new Error("Storybook agent bridge call failed: AbortError: Storybook view navigated to another package"))).toBe(true)
  expect(isStorybookNavigationSupersededError(new Error("Storybook view navigated away from the requested package"))).toBe(true)
  expect(isStorybookNavigationSupersededError(new DOMException("Mount failed", "AbortError"))).toBe(false)
  expect(isStorybookNavigationSupersededError(new Error("External Storybook page has no active package scope"))).toBe(false)
})

test("requires exact package, revision, route, graph, ready frame and an empty console", () => {
  const expected = {
    packageId: "@fixture/a",
    revision: "revision-a",
    route: "component/basic",
    graphDigest: "a".repeat(64),
  }
  const evidence = {
    ...expected,
    ready: true,
    presented: true,
    frameSequence: 3,
    consoleErrors: [],
  }
  expect(assertStorybookActivationEvidence(evidence, expected)).toBe(3)

  const failures: Array<Readonly<Record<string, unknown>>> = [
    {...evidence, packageId: "@fixture/b"},
    {...evidence, revision: "revision-b"},
    {...evidence, route: "component/other"},
    {...evidence, graphDigest: "b".repeat(64)},
    {...evidence, ready: false},
    {...evidence, presented: false},
    {...evidence, frameSequence: 0},
    {...evidence, consoleErrors: ["render failed"]},
  ]
  for (const failure of failures) {
    expect(() => assertStorybookActivationEvidence(failure, expected))
      .toThrow("did not pass activation verification")
  }
})

/** Ожидает bounded завершение асинхронного unit scenario. */
async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate() && Date.now() < deadline) await Bun.sleep(5)
  expect(predicate()).toBeTrue()
}
