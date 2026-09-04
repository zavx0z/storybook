import {describe, expect, test} from "bun:test"
import {createDocument} from "@zavx0z/dom"
import {
  mountStorybookAggregateChildren,
  type StorybookOverviewPlanItem,
} from "./aggregate-runtime.ts"

describe("external Storybook aggregate runtime", () => {
  test("rejects a Space subject before creating a DOM aggregate session", async () => {
    const document = createDocument()
    let creates = 0
    const plan: readonly StorybookOverviewPlanItem[] = [Object.freeze({
      id: "space",
      label: "Space",
      route: "space/default",
      subject: Object.freeze({
        id: "subject:@fixture/space",
        kind: "subject" as const,
        presentation: Object.freeze({
          protocol: "story-presentation/1" as const,
          projection: "space" as const,
          widgets: Object.freeze(["source", "diagnostics"]),
        }),
      }),
    })]

    await expect(mountStorybookAggregateChildren({
      document,
      adapter: {
        protocol: "storybook-runtime/4",
        create() {
          creates += 1
          throw new Error("Space aggregate adapter must not run")
        },
      },
      plan,
      signal: new AbortController().signal,
      async loadStory() {
        throw new Error("Space aggregate story must not load")
      },
      validatePresentation() {},
      reportDiagnostic() {},
      requestRender() {},
    })).rejects.toThrow("Storybook Space subject cannot be materialized in a DOM aggregate")
    expect(creates).toBe(0)
  })
})
