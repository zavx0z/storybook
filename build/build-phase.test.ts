import {describe, expect, test} from "bun:test"
import {
  STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL,
  parseStorybookBuildWorkerTransportEvent,
} from "./build-phase.ts"

describe("Storybook build worker event protocol", () => {
  test("принимает exact handshake и phase boundary", () => {
    expect(parseStorybookBuildWorkerTransportEvent({
      protocol: STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL,
      kind: "ready",
      workerId: "0123456789abcdef",
      pid: 42,
    })).toMatchObject({kind: "ready", pid: 42})
    expect(parseStorybookBuildWorkerTransportEvent({
      protocol: STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL,
      kind: "phase",
      event: {
        phase: "cache",
        state: "completed",
        at: "2026-09-11T00:00:00.000Z",
        cache: {status: "hit", layer: "shared"},
      },
    })).toMatchObject({kind: "phase", event: {phase: "cache", cache: {status: "hit"}}})
  })

  test("отклоняет old protocol, unknown phase и невалидный PID", () => {
    expect(parseStorybookBuildWorkerTransportEvent({
      protocol: "storybook-build-worker-event/0",
      kind: "ready",
      workerId: "0123456789abcdef",
      pid: 42,
    })).toBeNull()
    expect(parseStorybookBuildWorkerTransportEvent({
      protocol: STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL,
      kind: "phase",
      event: {phase: "unknown", state: "started", at: "2026-09-11T00:00:00.000Z"},
    })).toBeNull()
    expect(parseStorybookBuildWorkerTransportEvent({
      protocol: STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL,
      kind: "phase",
      event: {
        phase: "cache",
        state: "completed",
        at: "2026-09-11T00:00:00.000Z",
        cache: {status: "hit", layer: "package"},
      },
    })).toBeNull()
    expect(parseStorybookBuildWorkerTransportEvent({
      protocol: STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL,
      kind: "ready",
      workerId: "0123456789abcdef",
      pid: 0,
    })).toBeNull()
  })
})
