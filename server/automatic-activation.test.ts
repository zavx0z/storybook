import {expect, test} from "bun:test"
import {
  StorybookAutomaticActivationCoordinator,
  assertStorybookActivationEvidence,
} from "./automatic-activation.ts"

test("serializes automatic activation and coalesces each package to its latest pending revision", async () => {
  const entered: string[] = []
  const completed: string[] = []
  let releaseFirst!: () => void
  const first = new Promise<void>(resolve => {
    releaseFirst = resolve
  })
  let active = 0
  let maximumActive = 0
  const coordinator = new StorybookAutomaticActivationCoordinator({
    async apply(candidate) {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      entered.push(`${candidate.packageId}:${candidate.revision}`)
      if (candidate.packageId === "@fixture/a" && candidate.revision === "a1") await first
      completed.push(`${candidate.packageId}:${candidate.revision}`)
      active -= 1
      return "applied"
    },
    failed() {
      throw new Error("Unexpected automatic activation failure")
    },
  })

  coordinator.request({packageId: "@fixture/a", revision: "a1"})
  await waitFor(() => entered.length === 1)
  coordinator.request({packageId: "@fixture/b", revision: "b1"})
  coordinator.request({packageId: "@fixture/b", revision: "b2"})
  coordinator.request({packageId: "@fixture/a", revision: "a2"})
  releaseFirst()
  await waitFor(() => completed.length === 3)
  await coordinator.dispose()

  expect(maximumActive).toBe(1)
  expect(entered).toEqual([
    "@fixture/a:a1",
    "@fixture/b:b2",
    "@fixture/a:a2",
  ])
})

test("isolates one activation failure and continues with the next package", async () => {
  const failures: string[] = []
  const applied: string[] = []
  const coordinator = new StorybookAutomaticActivationCoordinator({
    async apply(candidate) {
      if (candidate.packageId === "@fixture/a") throw new Error("candidate failed")
      applied.push(candidate.packageId)
      return "applied"
    },
    failed(candidate, error) {
      failures.push(`${candidate.packageId}:${error instanceof Error ? error.message : String(error)}`)
    },
  })

  coordinator.request({packageId: "@fixture/a", revision: "a1"})
  coordinator.request({packageId: "@fixture/b", revision: "b1"})
  await waitFor(() => failures.length === 1 && applied.length === 1)
  await coordinator.dispose()

  expect(failures).toEqual(["@fixture/a:candidate failed"])
  expect(applied).toEqual(["@fixture/b"])
})

test("cancels an in-flight package when an explicit preview supersedes automatic apply", async () => {
  let aborted = false
  let entered = false
  const coordinator = new StorybookAutomaticActivationCoordinator({
    async apply(_candidate, signal) {
      entered = true
      await new Promise<void>(resolve => signal.addEventListener("abort", () => {
        aborted = true
        resolve()
      }, {once: true}))
      return "stale"
    },
    failed() {
      throw new Error("Canceled automatic activation must not be reported as a failure")
    },
  })

  coordinator.request({packageId: "@fixture/a", revision: "a1"})
  await waitFor(() => entered)
  coordinator.cancel("@fixture/a")
  await waitFor(() => aborted)
  await coordinator.dispose()

  expect(aborted).toBeTrue()
})

test("bounds one activation so a stalled package cannot block the queue", async () => {
  const failures: string[] = []
  const applied: string[] = []
  const coordinator = new StorybookAutomaticActivationCoordinator({
    timeoutMs: 20,
    async apply(candidate, signal) {
      if (candidate.packageId === "@fixture/a") {
        await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), {once: true}))
      }
      applied.push(candidate.packageId)
      return "applied"
    },
    failed(candidate) {
      failures.push(candidate.packageId)
    },
  })

  coordinator.request({packageId: "@fixture/a", revision: "a1"})
  coordinator.request({packageId: "@fixture/b", revision: "b1"})
  await waitFor(() => failures.length === 1 && applied.length === 1)
  await coordinator.dispose()

  expect(failures).toEqual(["@fixture/a"])
  expect(applied).toEqual(["@fixture/b"])
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
