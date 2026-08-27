import {loadDocumentDefaultFont} from "@engine/core/default-font"
import {
  CustomEvent as DomCustomEvent,
  createDocument,
  type Document,
  type HTMLElement,
  type Text,
} from "@zavx0z/dom"
import {createDocumentCanvasRuntime} from "@zavx0z/renderer-browser"
import type {StorybookDomCatalogIndexItem} from "@zavx0z/storybook/catalog"
import type {
  StorybookDomStoryArgs,
  StorybookDomStoryModule,
  StorybookDomStorySource,
} from "@zavx0z/storybook/stories"
import {
  STORYBOOK_DOM_WORKBENCH_EVENTS,
  createStorybookDomWorkbench,
  storybookDomWorkbenchCss,
  type StorybookDomNavigationItem,
  type StorybookDomScenarioItem,
} from "@zavx0z/storybook/workbench"
import {
  storybookPublicPath,
  waitForStorybookFrameBoundary,
} from "@zavx0z/storybook/environment"
import {
  StorybookRouteTreeRouter,
  type StorybookRouteTreeNode,
} from "@zavx0z/storybook/route-tree"
import {
  STORYBOOK_DOCUMENTATION_CATALOG,
  storybookDocumentationContext,
  storybookDocumentationIndex,
} from "./catalog.ts"

const MOUNT = storybookPublicPath("storybook", "/")

type OverviewPresentation = Readonly<{
  element: HTMLElement
  title: Text
  description: Text
  items: HTMLElement
}>

async function startStorybookDocumentation(): Promise<void> {
  const canvas = document.getElementById("storybook-canvas")
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("storybook-canvas not found")
  document.documentElement.dataset.storybookDocs = "starting"

  try {
    const semanticDocument = createDocument()
    const overview = createOverviewPresentation(semanticDocument)
    const workbench = createStorybookDomWorkbench({
      document: semanticDocument,
      parent: semanticDocument,
      initial: {
        title: "@zavx0z/storybook",
        "catalog.label": "Документация Storybook",
        "catalog.items": catalogItems(),
        "catalog.active": null,
        "secondary.label": "Разделы",
        "secondary.items": Object.freeze([]),
        "secondary.active": null,
        "preview.label": "Документация Storybook · Обзор",
        "preview.node": overview.element,
        "scenarios.label": "Варианты",
        "scenarios.items": Object.freeze([]),
        "scenarios.active": null,
        "inspector.label": "Исходный код",
        "inspector.source": overviewSource(
          "Документация Storybook · Обзор",
          "Публичные target-neutral контракты и DOM Workbench.",
        ),
        status: {
          lead: "Создано для ",
          owner: "MetaFor",
          detail: " · shared DOM Storybook infrastructure",
        },
      },
    })
    const font = await loadDocumentDefaultFont()
    const runtime = await createDocumentCanvasRuntime({
      canvas,
      document: semanticDocument,
      root: workbench.element,
      styleSheets: [storybookDomWorkbenchCss, documentationCss],
      font,
      tooltipDelayMs: 500,
    })
    const router = new StorybookRouteTreeRouter(
      STORYBOOK_DOCUMENTATION_CATALOG.routeTree,
      {basePath: MOUNT},
    )
    let revision = 0
    let story: StorybookDomStoryModule | null = null
    let storyRoot: ReturnType<StorybookDomStoryModule["render"]> | null = null
    let args: StorybookDomStoryArgs = Object.freeze({})
    let clicks = 0
    let renders = 0
    let disposed = false

    const navigate = (route: string): void => {
      if (!router.go(route)) throw new Error(`Unknown Storybook documentation route: ${route}`)
    }
    const onNavigate = (event: unknown): void => navigate(
      (event as DomCustomEvent<{route: string}>).detail.route,
    )
    const onScenario = (event: unknown): void => navigate(
      (event as DomCustomEvent<{id: string}>).detail.id,
    )
    const onPreviewClick = (): void => {
      if (storyRoot === null) return
      clicks += 1
      publish(router.current, story?.source(args) ?? emptySource(), "Interaction")
    }
    workbench.element.addEventListener(STORYBOOK_DOM_WORKBENCH_EVENTS.navigate, onNavigate)
    workbench.element.addEventListener(STORYBOOK_DOM_WORKBENCH_EVENTS.scenario, onScenario)
    workbench.elements.previewHost.addEventListener("click", onPreviewClick)

    const publish = (
      node: StorybookRouteTreeNode<string>,
      source: StorybookDomStorySource,
      state: string,
    ): void => {
      renders += 1
      document.documentElement.dataset.storybookDocsRoute = node.path
      document.documentElement.dataset.storybookDocsRouteKind = node.kind
      document.documentElement.dataset.storybookDocsStory = node.kind === "leaf" ? node.path : "overview"
      document.documentElement.dataset.storybookDocsHtml = source.html
      document.documentElement.dataset.storybookDocsCss = source.css
      document.documentElement.dataset.storybookDocsTypescript = source.typescript
      document.documentElement.dataset.storybookDocsArgs = JSON.stringify(args)
      document.documentElement.dataset.storybookDocsClicks = String(clicks)
      workbench.update("status", {
        lead: "Создано для ",
        owner: "MetaFor",
        detail: ` · Storybook DOM · ${state} · render ${renders} · click ${clicks}`,
      })
      runtime.render()
    }

    const applyRoute = async (node: StorybookRouteTreeNode<string>): Promise<void> => {
      const routeRevision = ++revision
      document.documentElement.dataset.storybookDocs = "starting"
      clicks = 0
      if (node.kind === "overview") {
        story = null
        storyRoot = null
        args = Object.freeze({})
        const source = applyOverview(workbench, overview, node)
        publish(node, source, "Обзор")
      } else {
        const nextIndex = storybookDocumentationIndex(node.path)
        const nextStory = await STORYBOOK_DOCUMENTATION_CATALOG.load(node.path)
        if (routeRevision !== revision || router.current !== node) return
        const nextArgs = Object.freeze({...nextStory.defaultArgs})
        const nextRoot = nextStory.render(semanticDocument, nextArgs, null)
        story = nextStory
        storyRoot = nextRoot
        args = nextArgs
        const source = nextStory.source(nextArgs)
        applyLeaf(workbench, nextIndex, nextRoot, source)
        publish(node, source, "Готово")
      }
      await waitForStorybookFrameBoundary()
      if (routeRevision !== revision || router.current !== node) return
      document.documentElement.dataset.storybookDocs = "ready"
    }

    const unsubscribeRouter = router.subscribe((node) => void applyRoute(node).catch(publishError))
    const dispose = (): void => {
      if (disposed) return
      disposed = true
      revision += 1
      unsubscribeRouter()
      workbench.element.removeEventListener(STORYBOOK_DOM_WORKBENCH_EVENTS.navigate, onNavigate)
      workbench.element.removeEventListener(STORYBOOK_DOM_WORKBENCH_EVENTS.scenario, onScenario)
      workbench.elements.previewHost.removeEventListener("click", onPreviewClick)
      router.dispose()
      runtime.dispose()
      workbench.dispose()
    }
    window.addEventListener("pagehide", dispose, {once: true})
    await applyRoute(router.current)
  } catch (error) {
    publishError(error)
    throw error
  }
}

function applyOverview(
  workbench: ReturnType<typeof createStorybookDomWorkbench>,
  overview: OverviewPresentation,
  node: StorybookRouteTreeNode<string>,
): StorybookDomStorySource {
  const context = storybookDocumentationContext(node.path)
  const children = STORYBOOK_DOCUMENTATION_CATALOG.routeTree.children(node.path)
  const title = node.path === ""
    ? "Документация Storybook · Обзор"
    : node.depth === 1
      ? `${context?.componentLabel ?? node.segment} · Обзор`
      : `${context?.sectionLabel ?? node.segment} · Обзор`
  const description = node.path === ""
    ? "Публичные target-neutral контракты и DOM Workbench."
    : `${children.length} непосредственных разделов без detail fallback.`
  updateOverviewPresentation(
    overview,
    title,
    description,
    children.map((child) => labelForNode(child)),
  )
  const source = overviewSource(title, description)
  workbench.document.transaction(() => {
    workbench.update("catalog.active", context?.componentId ?? null)
    workbench.update("secondary.items", context === null ? Object.freeze([]) : sectionItems(context))
    workbench.update("secondary.active", node.depth >= 2 ? context?.sectionId ?? null : null)
    workbench.update("preview.label", title)
    workbench.update("preview.node", overview.element)
    workbench.update("scenarios.items", node.depth >= 2 && context !== null
      ? scenarioItems(context)
      : Object.freeze([]))
    workbench.update("scenarios.active", null)
    workbench.update("inspector.source", source)
  })
  return source
}

function applyLeaf(
  workbench: ReturnType<typeof createStorybookDomWorkbench>,
  index: StorybookDomCatalogIndexItem,
  root: ReturnType<StorybookDomStoryModule["render"]>,
  source: StorybookDomStorySource,
): void {
  workbench.document.transaction(() => {
    workbench.update("catalog.active", index.componentId)
    workbench.update("secondary.items", sectionItems(index))
    workbench.update("secondary.active", index.sectionId)
    workbench.update("preview.label", index.title)
    workbench.update("preview.node", root)
    workbench.update("scenarios.items", scenarioItems(index))
    workbench.update("scenarios.active", index.route)
    workbench.update("inspector.source", source)
  })
}

function catalogItems(): readonly StorybookDomNavigationItem[] {
  const seen = new Set<string>()
  return STORYBOOK_DOCUMENTATION_CATALOG.index.flatMap((item) => {
    if (seen.has(item.componentId)) return []
    seen.add(item.componentId)
    return [{
      id: item.componentId,
      label: item.componentLabel,
      route: item.componentId,
      title: item.apiName,
    }]
  })
}

function sectionItems(
  selected: StorybookDomCatalogIndexItem,
): readonly StorybookDomNavigationItem[] {
  const seen = new Set<string>()
  return STORYBOOK_DOCUMENTATION_CATALOG.index.flatMap((item) => {
    if (item.componentId !== selected.componentId || seen.has(item.sectionId)) return []
    seen.add(item.sectionId)
    return [{
      id: item.sectionId,
      label: item.sectionLabel,
      route: `${item.componentId}/${item.sectionId}`,
      title: `${item.componentLabel} · ${item.sectionLabel}`,
    }]
  })
}

function scenarioItems(
  selected: StorybookDomCatalogIndexItem,
): readonly StorybookDomScenarioItem[] {
  return STORYBOOK_DOCUMENTATION_CATALOG.index
    .filter((item) => (
      item.componentId === selected.componentId &&
      item.sectionId === selected.sectionId
    ))
    .map((item) => ({
      id: item.route,
      label: item.variantLabel,
      title: item.title,
    }))
}

function labelForNode(node: StorybookRouteTreeNode<string>): string {
  if (node.kind === "leaf") return storybookDocumentationIndex(node.path).variantLabel
  const context = storybookDocumentationContext(node.path)
  if (node.depth === 1) return context?.componentLabel ?? node.segment
  return context?.sectionLabel ?? node.segment
}

function createOverviewPresentation(document: Document): OverviewPresentation {
  const element = document.createElement("section")
  const heading = document.createElement("h3")
  const title = document.createTextNode("")
  const paragraph = document.createElement("p")
  const description = document.createTextNode("")
  const items = document.createElement("ul")
  element.className = "documentation-overview"
  heading.className = "documentation-overview__title"
  paragraph.className = "documentation-overview__description"
  items.className = "documentation-overview__items"
  heading.appendChild(title)
  paragraph.appendChild(description)
  element.append(heading, paragraph, items)
  return Object.freeze({element, title, description, items})
}

function updateOverviewPresentation(
  presentation: OverviewPresentation,
  title: string,
  description: string,
  labels: readonly string[],
): void {
  presentation.title.data = title
  presentation.description.data = description
  const document = presentation.element.ownerDocument!
  presentation.items.replaceChildren(...labels.map((label) => {
    const item = document.createElement("li")
    item.className = "documentation-overview__item"
    item.appendChild(document.createTextNode(label))
    return item
  }))
}

function overviewSource(title: string, description: string): StorybookDomStorySource {
  return Object.freeze({
    html: `<section class="documentation-overview"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></section>`,
    css: documentationCss,
    typescript: `export const overview = ${JSON.stringify({title, description}, null, 2)} as const`,
  })
}

function emptySource(): StorybookDomStorySource {
  return Object.freeze({html: "<div></div>", css: "div { display: block; }", typescript: "const value = null"})
}

const documentationCss = `
.documentation-overview { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 220px; gap: 10px; padding: 18px; border: 1px solid #30343c; border-radius: 4px; background: #202124; color: #e8e8e8; }
.documentation-overview__title { display: block; color: #7edcec; font-size: 16px; }
.documentation-overview__description, .documentation-overview__item { display: block; color: #b8b8b8; font-size: 12px; }
.documentation-overview__items { display: flex; flex-direction: column; gap: 6px; }
.contract { display: flex; flex-direction: column; width: 100%; height: 100%; gap: 10px; padding: 22px; border: 1px solid #1a1a1a; border-radius: 6px; color: #e8e8e8; background: #303030; overflow: auto; }
.contract__title { display: block; color: #f4f4f4; font-size: 18px; line-height: 30px; }
.contract__summary, .contract__ownership { display: block; color: #d0d0d0; font-size: 12px; line-height: 22px; white-space: normal; }
.contract__subtitle { display: block; margin-top: 12px; color: #f0f0f0; font-size: 14px; line-height: 24px; }
.documentation-button { display: block; width: 240px; height: 40px; padding: 8px 14px; border: 1px solid #181818; border-radius: 4px; color: #f0f0f0; background: #4772b3; }
.documentation-button--outlined { color: #9fc5ff; background: transparent; border-color: #4772b3; }
.documentation-button--glass { background: rgba(71, 114, 179, 0.24); }
.documentation-button:hover { background: #5683c5; }
.documentation-button:active { background: #365f9d; }
.documentation-button:disabled { color: #808080; background: #333333; }
`.trim()

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function publishError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  document.documentElement.dataset.storybookDocs = "error"
  document.documentElement.dataset.storybookDocsError = message
  console.error(error)
}

void startStorybookDocumentation()
