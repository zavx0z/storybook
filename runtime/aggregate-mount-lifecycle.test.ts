import {DisplayElement} from "@zavx0z/dom/display"
import {describe, expect, test} from "bun:test"
import {createDocument, type Element} from "@zavx0z/dom"
import {createSpaceElementFactories} from "@zavx0z/space"
import {
  disposeStorybookAggregateChildren,
  mountStorybookAggregateChildren,
  type StorybookOverviewPlanItem,
} from "./aggregate-runtime.ts"
import type {
  StorybookRuntimeAdapter,
  StorybookRuntimeContext,
  StorybookRuntimePresentationInput,
  StorybookRuntimeSession,
} from "./runtime-protocol.ts"

describe("external Storybook aggregate mount lifecycle", () => {
  test("attaches a published owner root before its mount continuation, as a leaf does", async () => {
    const document = createDocument({elementFactories: createSpaceElementFactories()})
    const space = document.createElement("space")
    const display = document.createElement("display")
    document.appendChild(space)
    space.appendChild(display)
    expect(display).toBeInstanceOf(DisplayElement)

    const signal = new AbortController().signal
    const observedDisplays: DisplayElement[] = []
    const adapter: StorybookRuntimeAdapter = {
      protocol: "storybook-runtime/4",
      create(context) {
        let owner: Element | null = null
        const unmount = () => {
          owner?.parentNode?.removeChild(owner)
          owner = null
        }
        return {
          mount() {
            owner = context.document.createElement("article")
            owner.textContent = "Projection-dependent owner"
            expect(owner.parentNode).toBeNull()
            context.present({
              protocol: "story-presentation/1",
              node: owner,
              componentRoot: {
                readStyleSheets: () => ({revision: 0, styleSheets: []}),
              },
              source: {
                html: "<article>Projection-dependent owner</article>",
                typescript: "export const label = 'Projection-dependent owner'",
              },
            })
            observedDisplays.push(requiredDisplayAncestor(owner))
          },
          unmount,
          dispose: unmount,
        }
      },
    }

    // A leaf publication connects the same-Document owner synchronously.
    const leafSession = await adapter.create({
      document,
      signal,
      projection: "display",
      present({node}) {
        display.appendChild(node)
      },
      reportDiagnostic() {},
      requestRender() {},
    })
    await leafSession.mount({route: "components/owner/default", story: {}, signal})
    expect(observedDisplays).toEqual([display])
    await leafSession.unmount()
    await leafSession.dispose()
    expect(display.childNodes).toHaveLength(0)

    const plan: readonly StorybookOverviewPlanItem[] = [{
      id: "owner",
      label: "Owner",
      route: "components/owner/default",
      subject: {
        id: "subject:@fixture/owner",
        kind: "subject",
        presentation: {
          protocol: "story-presentation/1",
          projection: "display",
          widgets: ["source", "diagnostics"],
        },
      },
    }]

    // The identical owner must have the same post-present guarantees in an overview.
    const children = await mountStorybookAggregateChildren({
      document,
      adapter,
      plan,
      signal,
      async loadStory() {
        return {}
      },
      present(_item, {node}) {
        display.appendChild(node)
        return () => {
          if (node.parentNode === display) display.removeChild(node)
        }
      },
      validatePresentation() {},
      reportDiagnostic() {},
      requestRender() {},
    })
    try {
      expect(children).toHaveLength(1)
      expect(observedDisplays).toEqual([display, display])
      expect(children[0]!.presentation.node.ownerDocument).toBe(document)
      expect(document.querySelectorAll("display")).toHaveLength(1)
    } finally {
      await disposeStorybookAggregateChildren(children)
    }
  })

  test("validates before publication and cleans every partial child in reverse order", async () => {
    const lifecycle: string[] = []
    const fixture = createMountFixture((context, id) => ({
      mount() {
        context.present(ownerPresentation(context, id))
        lifecycle.push(`mounted:${id}`)
      },
      unmount() {
        lifecycle.push(`unmount:${id}`)
        throw new Error("Owner cleanup failed")
      },
      dispose() {
        lifecycle.push(`dispose:${id}`)
      },
    }), ["first", "invalid"])
    await expect(mountStorybookAggregateChildren({
      ...fixture.options,
      validatePresentation(value) {
        if (value.node.textContent === "invalid") throw new Error("Invalid presentation")
      },
    })).rejects.toThrow("Invalid presentation")
    expect(lifecycle).toEqual([
      "mounted:first", "unmount:invalid", "dispose:invalid", "unmount:first", "dispose:first",
    ])
    expect(fixture.host.childNodes).toHaveLength(0)
  })

  test("detaches a published root when mount continuation fails", async () => {
    const fixture = createMountFixture(context => ({
      mount() {
        context.present(ownerPresentation(context, "failed"))
        throw new Error("Mount continuation failed")
      },
      unmount() {},
      dispose() {},
    }))
    await expect(mountStorybookAggregateChildren(fixture.options))
      .rejects.toThrow("Mount continuation failed")
    expect(fixture.host.childNodes).toHaveLength(0)
  })

  test("aborts an in-flight mounted child and rejects its late publication", async () => {
    const mounted = Promise.withResolvers<void>()
    const continuation = Promise.withResolvers<void>()
    let staleContext: StorybookRuntimeContext | null = null
    let cleanups = 0
    const fixture = createMountFixture(context => {
      staleContext = context
      return {
        async mount() {
          context.present(ownerPresentation(context, "pending"))
          mounted.resolve()
          await continuation.promise
        },
        unmount() {
          cleanups += 1
        },
        dispose() {
          cleanups += 1
        },
      }
    })
    const mounting = mountStorybookAggregateChildren(fixture.options)
    await mounted.promise
    expect(fixture.host.childNodes).toHaveLength(1)
    fixture.abort.abort(new Error("Navigation superseded"))
    await expect(mounting).rejects.toThrow("Navigation superseded")
    expect(cleanups).toBe(2)
    expect(fixture.host.childNodes).toHaveLength(0)
    const context = staleContext as unknown as StorybookRuntimeContext
    expect(() => context.present(ownerPresentation(context, "late")))
      .toThrow("Navigation superseded")
    continuation.resolve()
  })

  test("disposes an asynchronously created session that arrives after cancellation", async () => {
    const created = Promise.withResolvers<StorybookRuntimeSession>()
    const disposed = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    const fixture = createMountFixture(() => {
      started.resolve()
      return created.promise
    })
    const mounting = mountStorybookAggregateChildren(fixture.options)
    await started.promise
    fixture.abort.abort(new Error("Navigation superseded"))
    await expect(mounting).rejects.toThrow("Navigation superseded")
    created.resolve({
      mount() {
        throw new Error("A cancelled session must not mount")
      },
      unmount() {},
      dispose() {
        disposed.resolve()
      },
    })
    await disposed.promise
    expect(fixture.host.childNodes).toHaveLength(0)
  })

  test("detaches every child even if owner cleanup rejects", async () => {
    const fixture = createMountFixture(context => ({
      mount() {
        context.present(ownerPresentation(context, "owner"))
      },
      unmount() {
        throw new Error("Unmount failed")
      },
      dispose() {
        throw new Error("Dispose failed")
      },
    }))
    const children = await mountStorybookAggregateChildren(fixture.options)
    await expect(disposeStorybookAggregateChildren(children))
      .rejects.toThrow("Storybook aggregate child cleanup failed")
    expect(fixture.host.childNodes).toHaveLength(0)
  })
})

function createMountFixture(
  create: (context: StorybookRuntimeContext, id: string) => StorybookRuntimeSession | Promise<StorybookRuntimeSession>,
  ids = ["owner"],
) {
  const document = createDocument()
  const host = document.createElement("main")
  document.appendChild(host)
  const abort = new AbortController()
  let index = 0
  const options: Parameters<typeof mountStorybookAggregateChildren>[0] = {
    document,
    adapter: {
      protocol: "storybook-runtime/4",
      create(context) {
        return create(context, ids[index++]!)
      },
    },
    plan: ids.map(id => ({
      id,
      label: id,
      route: `components/${id}/default`,
      subject: {
        id: `subject:@fixture/${id}`,
        kind: "subject",
        presentation: {
          protocol: "story-presentation/1",
          projection: "display",
          widgets: ["source", "diagnostics"],
        },
      },
    })),
    signal: abort.signal,
    async loadStory() {
      return {}
    },
    present(_item, {node}) {
      host.appendChild(node)
      return () => {
        if (node.parentNode === host) host.removeChild(node)
      }
    },
    validatePresentation() {},
    reportDiagnostic() {},
    requestRender() {},
  }
  return {host, abort, options}
}

function ownerPresentation(context: StorybookRuntimeContext, id: string): StorybookRuntimePresentationInput {
  const node = context.document.createElement("article")
  node.textContent = id
  return {
    protocol: "story-presentation/1",
    node,
    componentRoot: {readStyleSheets: () => ({revision: 0, styleSheets: []})},
    source: {html: `<article>${id}</article>`, typescript: `export const id = '${id}'`},
  }
}

function requiredDisplayAncestor(owner: Element): DisplayElement {
  let ancestor = owner.parentElement
  while (ancestor !== null) {
    if (ancestor instanceof DisplayElement) return ancestor
    ancestor = ancestor.parentElement
  }
  throw new Error("Storybook owner mount continued after present without its host-owned DisplayElement")
}
