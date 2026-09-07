import type {Document} from "@zavx0z/dom"
import type {
  StorybookRuntimeAdapter,
  StorybookRuntimeContext,
  StorybookRuntimePresentationInput,
  StorybookRuntimeSession,
  StorybookRuntimeStoryInput,
} from "./runtime-protocol.ts"
import {validateStorybookRuntimeSession} from "./runtime-protocol.ts"
import type {StorybookPackageRevisionStoryPresentation} from "../sessions/package-revision.ts"
import type {
  ExternalStorybookClientNode,
  ExternalStorybookClientSnapshot,
} from "./client-protocol.ts"
import type {ExternalStorybookPackageTabModel} from "./model.ts"
import {externalStorybookClientNode} from "./shell.ts"

export type StorybookOverviewPlanItem = Readonly<{
  id: string
  label: string
  route: string
  subject: Readonly<{
    id: string
    kind: "subject"
    presentation: StorybookPackageRevisionStoryPresentation
  }>
}>

export type MountedStorybookAggregateChild = Readonly<{
  plan: StorybookOverviewPlanItem
  abort: AbortController
  session: StorybookRuntimeSession
  presentation: StorybookRuntimePresentationInput
  detachPresentation(): void
}>

type MountStorybookAggregateChildrenOptions = Readonly<{
  document: Document
  adapter: StorybookRuntimeAdapter
  plan: readonly StorybookOverviewPlanItem[]
  signal: AbortSignal
  loadStory(route: string): Promise<unknown>
  present(plan: StorybookOverviewPlanItem, value: StorybookRuntimePresentationInput): () => void
  validatePresentation(
    value: StorybookRuntimePresentationInput,
    presentation: StorybookPackageRevisionStoryPresentation,
  ): void
  reportDiagnostic(value: unknown): void
  requestRender(): void
}>

/** Publishes each child synchronously into its already attached overview host. */
export async function mountStorybookAggregateChildren(
  options: MountStorybookAggregateChildrenOptions,
): Promise<readonly MountedStorybookAggregateChild[]> {
  const children: MountedStorybookAggregateChild[] = []
  try {
    for (const item of options.plan) {
      children.push(await mountStorybookAggregateChild(options, item))
    }
    return Object.freeze(children)
  } catch (error) {
    await disposeStorybookAggregateChildren(children, error, true)
    throw error
  }
}

export async function disposeStorybookAggregateChildren(
  children: readonly MountedStorybookAggregateChild[],
  reason?: unknown,
  bestEffort = false,
): Promise<void> {
  const errors: unknown[] = []
  for (const child of [...children].reverse()) {
    child.abort.abort(reason ?? new DOMException("Storybook aggregate child disposed", "AbortError"))
    try {
      await child.session.unmount()
    } catch (error) {
      errors.push(error)
    }
    try {
      await child.session.dispose()
    } catch (error) {
      errors.push(error)
    }
    try {
      child.detachPresentation()
    } catch (error) {
      errors.push(error)
    }
  }
  if (!bestEffort && errors.length > 0) {
    throw new AggregateError(errors, "Storybook aggregate child cleanup failed")
  }
}

async function mountStorybookAggregateChild(
  options: MountStorybookAggregateChildrenOptions,
  plan: StorybookOverviewPlanItem,
): Promise<MountedStorybookAggregateChild> {
  const presentation = plan.subject.presentation
  if (presentation.projection === "space") {
    throw new Error(`Storybook Space subject cannot be materialized in a DOM aggregate: ${plan.subject.id}`)
  }
  const abort = new AbortController()
  const childSignal = AbortSignal.any([options.signal, abort.signal])
  let published: StorybookRuntimePresentationInput | null = null
  let detachPresentation = () => {}
  let mounting = false
  const context: StorybookRuntimeContext = Object.freeze({
    document: options.document,
    signal: childSignal,
    projection: presentation.projection,
    present(value: StorybookRuntimePresentationInput) {
      if (childSignal.aborted) throw childSignal.reason
      if (!mounting) throw new Error(`Storybook aggregate child published outside mount: ${plan.route}`)
      if (published !== null) {
        throw new Error(`Storybook aggregate child published more than once: ${plan.route}`)
      }
      options.validatePresentation(value, presentation)
      detachPresentation = options.present(plan, value)
      published = value
    },
    reportDiagnostic(value: unknown) {
      if (childSignal.aborted) throw childSignal.reason
      options.reportDiagnostic(value)
    },
    requestRender: options.requestRender,
  })
  let session: StorybookRuntimeSession | null = null
  try {
    if (childSignal.aborted) throw childSignal.reason
    const createdSession = await abortable<StorybookRuntimeSession>(Promise.resolve(options.adapter.create(context)).then(async candidate => {
      let created: StorybookRuntimeSession
      try {
        created = validateStorybookRuntimeSession(candidate)
        if (!childSignal.aborted) return created
      } catch (error) {
        await disposeCandidate(candidate)
        throw error
      }
      await disposeCandidate(created)
      throw childSignal.reason
    }), childSignal)
    session = createdSession
    const story = await abortable(options.loadStory(plan.route), childSignal)
    const input: StorybookRuntimeStoryInput = Object.freeze({
      route: plan.route,
      story,
      signal: childSignal,
    })
    mounting = true
    await abortable(Promise.resolve(createdSession.mount(input)), childSignal)
    mounting = false
    if (published === null) {
      throw new Error(`Storybook aggregate child published no presentation: ${plan.route}`)
    }
    return Object.freeze({plan, abort, session: createdSession, presentation: published, detachPresentation})
  } catch (error) {
    mounting = false
    abort.abort(error)
    if (session !== null) {
      try {
        await session.unmount()
      } catch {
        // The original aggregate child failure remains primary.
      }
      try {
        await session.dispose()
      } catch {
        // The original aggregate child failure remains primary.
      }
    }
    try {
      detachPresentation()
    } catch {
      // Preserve the original failure while the aggregate host is released.
    }
    throw error
  }
}

export function planStorybookOverview(
  snapshot: ExternalStorybookClientSnapshot,
  model: ExternalStorybookPackageTabModel,
): readonly StorybookOverviewPlanItem[] {
  const selected = externalStorybookClientNode(snapshot, model.selectedNode.id)
  if (selected.kind !== "category" && selected.kind !== "subject") return Object.freeze([])
  return Object.freeze(selected.childIds.flatMap((childId) => {
    const child = externalStorybookClientNode(snapshot, childId)
    const variant = firstStorybookVariantOrNull(snapshot, child)
    if (variant === null) return []
    const subject = variant.parentId === null
      ? null
      : externalStorybookClientNode(snapshot, variant.parentId)
    if (subject?.kind !== "subject" || subject.presentation === null || variant.routePath === null) {
      throw new Error(`Storybook overview child has no executable presentation: ${child.id}`)
    }
    return [Object.freeze({
      id: child.id,
      label: child.label,
      route: variant.routePath,
      subject: Object.freeze({
        id: subject.id,
        kind: "subject" as const,
        presentation: subject.presentation,
      }),
    })]
  }))
}

async function disposeCandidate(candidate: unknown): Promise<void> {
  if (candidate !== null && typeof candidate === "object" &&
    "dispose" in candidate && typeof candidate.dispose === "function") {
    try {
      await candidate.dispose()
    } catch {
      // A rejected or cancelled creation retains its original failure.
    }
  }
}

function firstStorybookVariantOrNull(
  snapshot: ExternalStorybookClientSnapshot,
  node: ExternalStorybookClientNode,
): ExternalStorybookClientNode | null {
  if (node.kind === "variant") return node
  for (const childId of node.childIds) {
    const child = firstStorybookVariantOrNull(
      snapshot,
      externalStorybookClientNode(snapshot, childId),
    )
    if (child !== null) return child
  }
  return null
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener("abort", onAbort, {once: true})
    promise.then(
      value => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      error => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}
