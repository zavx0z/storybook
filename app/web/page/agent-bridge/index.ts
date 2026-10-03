/**
Связывает агента с существующими semantic узлами и кадром страницы Storybook.
Инспекция сохраняет identity предмета; действия доставляются общему Browser input.
Bridge удерживает inspector и публикует себя в realm до dispose либо передачи scope.

@packageDocumentation
*/
import {createDomInspector} from "@zavx0z/devtools"
import type {WebAgentBridge} from "./contract"
import type {Request} from "./contract/request"
import {STORYBOOK_AGENT_BRIDGE_GLOBAL, STORYBOOK_AGENT_BRIDGE_PROTOCOL} from "./src/protocol"
import {projectNode, applyNodeAction, validateRequest, boundedInteger, boundedText, decodeCursor, encodeCursor, agentNodeId, exactClip, parseAgentNodeId, resolveTarget} from "./src/actions"
export type {WebAgentBridge} from "./contract"

/**
Публикует bridge для текущего scope и подключает inspector к его semantic Document.

@param options - Committed identity, существующая оболочка и callbacks владельца переходов.

@returns Bridge с текущей identity; потребитель обязан вызвать dispose при освобождении scope.

@throws При нарушении предоставленных возможностей Document/inspector.

@example
```ts
const bridge = createAgentBridge({packageId, revision, graphDigest, shell, getRoute, getModel, navigate, applyRevision})
try {
  await bridge.call("identity")
} finally {
  bridge.dispose()
}
```
*/
function createStorybookAgentBridge(
  options: WebAgentBridge.Input,
): WebAgentBridge.Output {
  const inspector = createDomInspector({
    document: options.shell.document,
    readFrame(node) {
      try {
        const projection = options.shell.projectionFor(node)
        return projection.kind === "space" ? null : projection.readFrame()
      } catch {
        return null
      }
    },
  })
  let disposed = false
  let packageId = options.packageId
  let revision = options.revision
  let graphDigest = options.graphDigest

  const bridge: WebAgentBridge.Output = Object.freeze({
    protocol: STORYBOOK_AGENT_BRIDGE_PROTOCOL,
    async call(method, params) {
      if (method === "identity") {
        const next = await options.waitForStableScope?.()
        if (next !== undefined) return next.call(method, params)
        assertActive()
        return state()
      }
      const record = params !== null && typeof params === "object" && !Array.isArray(params)
        ? params as Record<string, unknown>
        : {}
      return bridge.invoke({
        ...record,
        protocol: STORYBOOK_AGENT_BRIDGE_PROTOCOL,
        operation: method,
      } as Request)
    },
    async invoke(request) {
      const next = await options.waitForStableScope?.()
      if (next !== undefined) return next.invoke(request)
      assertActive()
      validateRequest(request)
      if (request.expectedPackageId !== undefined && request.expectedPackageId !== packageId) {
        throw new Error("Storybook view navigated to another package")
      }
      if (request.operation === "state") return state()
      if (request.operation === "applyRevision") {
        if (request.expectedPackageId === undefined) {
          throw new Error("Storybook applied revision requires an expected package identity")
        }
        const requestedRevision = boundedText(request.revision, 256, "revision")
        await options.applyRevision(requestedRevision)
        const appliedBridge = await options.waitForStableScope?.()
        if (appliedBridge !== undefined) {
          const result = await appliedBridge.call("identity") as {packageId?: string; revision?: string}
          if (result.packageId !== request.expectedPackageId || result.revision !== requestedRevision) {
            throw new Error("Storybook platform application returned another package or revision")
          }
          return result
        }
        assertActive()
        if (request.expectedPackageId !== packageId) throw new Error("Storybook view navigated to another package")
        return state()
      }
      if (request.operation === "inspect") return inspect(request)
      if (request.operation === "capture") return capture(request)
      return interact(request)
    },
    updateIdentity(nextPackageId, nextRevision, nextGraphDigest) {
      assertActive()
      packageId = boundedText(nextPackageId, 256, "package identity")
      revision = boundedText(nextRevision, 256, "revision")
      graphDigest = boundedText(nextGraphDigest, 256, "graph digest")
    },
    dispose() {
      if (disposed) return
      disposed = true
      inspector.dispose()
      const globalRecord = globalThis as typeof globalThis & Record<string, unknown>
      if (globalRecord[STORYBOOK_AGENT_BRIDGE_GLOBAL] === bridge) {
        delete globalRecord[STORYBOOK_AGENT_BRIDGE_GLOBAL]
      }
    },
  })
  ;(globalThis as typeof globalThis & Record<string, unknown>)[STORYBOOK_AGENT_BRIDGE_GLOBAL] = bridge
  return bridge

  function state() {
    const model = options.getModel()
    return Object.freeze({
      protocol: STORYBOOK_AGENT_BRIDGE_PROTOCOL,
      capabilities: Object.freeze({inPageUpdates: options.canApplyRevision?.() ?? false}),
      packageId,
      revision,
      graphDigest,
      sharedModuleEpoch: options.shell.browserDocument.documentElement.dataset.externalStorybookSharedModuleEpoch ?? null,
      hostModuleEpoch: options.shell.browserDocument.documentElement.dataset.externalStorybookHostModuleEpoch ?? null,
      route: options.getRoute(),
      pathname: options.shell.browserDocument.location?.pathname ?? null,
      preview: new URL(options.shell.browserDocument.location?.href ?? "http://storybook.invalid/").searchParams.has("preview"),
      viewName: options.shell.browserDocument.defaultView?.name ?? "",
      markers: Object.freeze({
        package: options.shell.browserDocument.documentElement.dataset.externalStorybookPackage ?? null,
        packageId: options.shell.browserDocument.documentElement.dataset.externalStorybookPackageId ?? null,
        route: options.shell.browserDocument.documentElement.dataset.externalStorybookRoute ?? null,
        revision: options.shell.browserDocument.documentElement.dataset.externalStorybookRevision ?? null,
      }),
      ready: options.shell.browserDocument.documentElement.dataset.externalStorybookPackage === "ready",
      presented: options.shell.presentedFrameSequence > 0,
      error: options.shell.browserDocument.documentElement.dataset.externalStorybookNavigationError ??
        options.shell.browserDocument.documentElement.dataset.externalStorybookUpdateError ??
        options.shell.browserDocument.documentElement.dataset.externalStorybookError ?? null,
      timeOrigin: performance.timeOrigin,
      frameSequence: options.shell.presentedFrameSequence,
      nativePage: Object.freeze({
        visibilityState: options.shell.browserDocument.visibilityState ?? null,
        hasFocus: typeof options.shell.browserDocument.hasFocus === "function"
          ? options.shell.browserDocument.hasFocus()
          : null,
      }),
      selected: Object.freeze({
        nodeId: model.selectedNode.id,
        directoryId: model.selectedNode.kind === "directory" ? model.selectedNode.id : null,
        tabId: model.tabActiveId,
      }),
      inspector: Object.freeze({
        selectedId: options.shell.workbench.controller?.selectedInspector?.() ?? null,
        workspaceId: options.shell.workbench.controller?.read?.("inspector.subject")?.workspaceId ?? null,
        parameter: new URLSearchParams(options.shell.browserDocument.location?.search ?? "").get("inspector"),
      }),
      canvas: Object.freeze({
        id: options.shell.canvas.id,
        width: options.shell.canvas.width,
        height: options.shell.canvas.height,
        hidden: options.shell.canvas.hidden,
      }),
    })
  }

  function inspect(request: Request) {
    const defaultInspection = request.include === undefined
    const include = new Set(request.include ?? ["state", "diagnostics", "semantic", "canvas"])
    const stateProjection = state()
    const {canvas, ...identity} = stateProjection
    const needsNodes = include.has("semantic") || include.has("layout") || include.has("display")
    if (!needsNodes) {
      return Object.freeze({
        ...identity,
        ...(include.has("diagnostics") ? {
          diagnostics: identity.error === null ? Object.freeze([]) : Object.freeze([identity.error]),
        } : {}),
        ...(include.has("canvas") ? {canvas} : {}),
      })
    }
    const maximumDepth = boundedInteger(request.maxDepth ?? (defaultInspection ? 4 : 6), 0, 12, "maxDepth")
    const limit = boundedInteger(request.limit ?? (defaultInspection ? 40 : 80), 1, 200, "limit")
    const {offset, rootId} = decodeCursor(request.cursor)
    const root = rootId === undefined ? options.shell.space : inspector.nodeForId(rootId)
    if (root === null || root !== options.shell.space && !options.shell.space.contains(root)) {
      throw new Error("Storybook inspection subtree no longer belongs to this view")
    }
    const snapshot = inspector.snapshot(root)
    const byId = new Map(snapshot.nodes.map((node) => [node.id, node] as const))
    const depths = new Map<number, number>([[snapshot.root, 0]])
    const ordered = snapshot.nodes.filter((node) => {
      const parentDepth = node.parent === null ? -1 : depths.get(node.parent) ?? -1
      const depth = node.id === snapshot.root ? 0 : parentDepth + 1
      depths.set(node.id, depth)
      return depth <= maximumDepth
    })
    const page = ordered.slice(offset, offset + limit)
    return Object.freeze({
      ...identity,
      ...(include.has("diagnostics") ? {
        diagnostics: identity.error === null ? Object.freeze([]) : Object.freeze([identity.error]),
      } : {}),
      ...(include.has("canvas") ? {canvas} : {}),
      semantic: Object.freeze({
        mutationVersion: snapshot.mutationVersion,
        stateVersion: snapshot.stateVersion,
        root: agentNodeId(snapshot.root),
        nodes: Object.freeze(page.map((node) => projectNode(node, byId, inspector, {
          layout: include.has("layout"),
          display: include.has("display"),
        }))),
        nextCursor: offset + page.length < ordered.length ? encodeCursor(offset + page.length, rootId) : null,
        total: ordered.length,
      }),
    })
  }

  async function interact(request: Request) {
    const action = request.action
    if (action === undefined) throw new Error("Storybook agent interaction action is required")
    boundedInteger(request.timeoutMs ?? 8_000, 1, 30_000, "timeoutMs")
    const before = options.shell.presentedFrameSequence
    if (action === "scenario") {
      if (typeof request.value !== "string" || request.value.length === 0 || request.value.length > 256) {
        throw new Error("Storybook scenario value must be a bounded route or variant id")
      }
      if (options.selectScenario === undefined) throw new Error("На текущей странице нет сценариев")
      options.selectScenario(request.value)
    } else {
      const node = resolveTarget(request.target, inspector)
      await applyNodeAction(action, node, request, inspector, options.shell)
    }
    const next = await options.waitForStableScope?.()
    if (next !== undefined) {
      const identity = await next.call("identity") as {frameSequence: number}
      return Object.freeze({ok: true, action, frameSequence: identity.frameSequence, state: identity})
    }
    const frameSequence = options.shell.presentFrame()
    if (frameSequence <= before) throw new Error("Storybook interaction did not present a new frame")
    return Object.freeze({ok: true, action, frameSequence, state: state()})
  }

  async function capture(request: Request) {
    boundedInteger(request.timeoutMs ?? 8_000, 1, 30_000, "timeoutMs")
    const before = options.shell.presentedFrameSequence
    const frameSequence = options.shell.presentFrame()
    if (frameSequence <= before) throw new Error("Storybook capture did not present a new frame")
    const area = typeof (request as Record<string, unknown>).area === "string"
      ? String((request as Record<string, unknown>).area)
      : "workbench"
    let clip: Readonly<{x: number; y: number; width: number; height: number; scale: number}>
    if (area === "canvas") {
      const box = options.shell.canvas.getBoundingClientRect()
      clip = exactClip(box.left, box.top, box.width, box.height)
    } else {
      const semantic = area === "preview"
        ? options.shell.workbench.elements.previewHost
        : area === "node" && typeof (request as Record<string, unknown>).nodeId === "string"
          ? inspector.nodeForId(parseAgentNodeId(String((request as Record<string, unknown>).nodeId)))
          : options.shell.workbench.element
      if (semantic === null) throw new Error("Unknown Storybook capture node")
      const snapshot = inspector.snapshot(options.shell.space)
      const id = inspector.idForNode(semantic)
      const node = snapshot.nodes.find((candidate) => candidate.id === id)
      if (node?.box === undefined || node.box === null) throw new Error(`Storybook ${area} has no presented bounds`)
      clip = exactClip(node.box.x, node.box.y, node.box.width, node.box.height)
    }
    return Object.freeze({
      frameSequence,
      clip,
    })
  }

  function assertActive(): void {
    if (disposed) throw new Error("Storybook agent bridge is disposed")
  }
}


export default Object.assign(createStorybookAgentBridge, {
  global: STORYBOOK_AGENT_BRIDGE_GLOBAL,
  protocol: STORYBOOK_AGENT_BRIDGE_PROTOCOL,
})
