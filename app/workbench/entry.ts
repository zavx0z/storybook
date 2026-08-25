/**
Live self-documenting Workbench page for `@zavx0z/storybook`.

The page owns one `UiRuntime`, one pathname router and its local stories. Every
visible region is a public Workbench surface; overview routes choose only a
presentation descendant and never rewrite their canonical pathname.

@packageDocumentation
*/

import {UiRuntime} from "@layout/core/runtime"
import {StorybookRouteTreeRouter, type StorybookRouteTreeNode} from "@zavx0z/storybook/route-tree"
import type {
  StorybookStoryArgs,
  StorybookStoryIndexItem,
  StorybookStoryModule,
} from "@zavx0z/storybook/stories"
import {
  StorybookBackdropSurface,
  StorybookDockSurface,
  StorybookNavigationSurface,
  StorybookStoryPanelSurface,
  planStorybookShell,
  type StorybookNavigationItem,
  type StorybookResponsivePolicy,
  type StorybookStoryPanelMode,
  type StorybookStoryPanelOptions,
} from "@zavx0z/storybook/workbench"
import {storybookPublicPath} from "@zavx0z/storybook/environment"
import {StorybookWorkbenchPreviewSurface} from "./preview.ts"
import {
  STORYBOOK_WORKBENCH_STORIES,
  observeStorybookWorkbenchButtonClicks,
  storybookWorkbenchPresentationRoute,
} from "./stories.ts"

const WORKBENCH_MOUNT_PATH = storybookPublicPath("storybook", "/")
const WORKBENCH_DESKTOP_POLICY: StorybookResponsivePolicy = Object.freeze({
  compactBelow: null,
  compactPanels: Object.freeze([]),
})

async function startStorybookWorkbenchDocumentation(): Promise<void> {
  const canvas = document.getElementById("storybook-canvas")
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("storybook-canvas not found")
  document.documentElement.dataset.storybookDocs = "starting"

  try {
    const runtime = await UiRuntime.create(canvas, {
      virtualDisplay: {initial: "near", surfaceDisplay: true, grid: false},
    })
    runtime.handleResize()

    const router = new StorybookRouteTreeRouter(STORYBOOK_WORKBENCH_STORIES.routeTree, {
      basePath: WORKBENCH_MOUNT_PATH,
    })
    let storyRoute = storybookWorkbenchPresentationRoute(router.current.path)
    let storyIndex = requireStory(storyRoute)
    let storyModule = await STORYBOOK_WORKBENCH_STORIES.load(storyRoute)
    let args: StorybookStoryArgs = Object.freeze({...storyModule.defaultArgs})
    let panelMode: StorybookStoryPanelMode = "controls"
    let clickCount = 0
    let controlChanges = 0
    let selectionRevision = 0
    let catalogQuery = ""
    let collapsedGroups = new Set<string>()

    const navigate = (path: string): void => {
      if (!router.go(path)) publishError(new Error(`Unknown Storybook Workbench route: ${path}`))
    }
    const backdrop = new StorybookBackdropSurface()
    const catalog = new StorybookNavigationSurface<string>(catalogOptions())
    const sections = new StorybookNavigationSurface<string>(sectionOptions())
    const dock = new StorybookDockSurface<string>(dockOptions())
    const preview = new StorybookWorkbenchPreviewSurface(storyIndex, storyModule, args)
    let storyPanel: StorybookStoryPanelSurface

    const panelOptions = (): StorybookStoryPanelOptions => ({
      source: storyModule.source(args),
      args,
      controls: storyModule.controls,
      events: [
        {id: "clicks", label: "Нажатия", value: String(clickCount)},
        {id: "changes", label: "Изменения", value: String(controlChanges)},
      ],
      mode: panelMode,
      onModeChange(mode) {
        panelMode = mode
        storyPanel.setOptions(panelOptions())
        publish()
      },
      onControlChange(key, value) {
        args = Object.freeze({...args, [key]: value})
        controlChanges += 1
        preview.setArgs(args)
        storyPanel.setOptions(panelOptions())
        publish()
      },
      async onCopy(source) {
        try {
          await navigator.clipboard.writeText(source)
          document.documentElement.dataset.storybookDocsCopy = "copied"
        } catch {
          document.documentElement.dataset.storybookDocsCopy = "error"
        }
      },
    })
    storyPanel = new StorybookStoryPanelSurface(panelOptions())

    const frames = (w: number, h: number) => planStorybookShell(w, h, {
      responsive: WORKBENCH_DESKTOP_POLICY,
    })
    runtime.addSurface(backdrop, ({w, h}) => ({x: 0, y: 0, w, h}))
    runtime.addSurface(catalog, ({w, h}) => frames(w, h).catalog)
    runtime.addSurface(sections, ({w, h}) => frames(w, h).section)
    runtime.addSurface(preview, ({w, h}) => frames(w, h).preview)
    runtime.addSurface(dock, ({w, h}) => frames(w, h).dock)
    runtime.addSurface(storyPanel, ({w, h}) => frames(w, h).info)

    function catalogOptions() {
      return {
        title: "Документация Storybook",
        items: catalogItems(collapsedGroups),
        route: storyIndex.componentId,
        onNavigate: navigate,
        query: catalogQuery,
        searchPlaceholder: "Пример, API, тег…",
        onQueryChange(query: string) {
          catalogQuery = query
          catalog.setOptions(catalogOptions())
          publish()
        },
        onGroupToggle(groupId: string, collapsed: boolean) {
          collapsedGroups = new Set(collapsedGroups)
          if (collapsed) collapsedGroups.add(groupId)
          else collapsedGroups.delete(groupId)
          catalog.setOptions(catalogOptions())
          publish()
        },
      }
    }

    function sectionOptions() {
      return {
        title: storyIndex.componentLabel,
        items: sectionItems(storyIndex),
        route: `${storyIndex.componentId}/${storyIndex.sectionId}`,
        onNavigate: navigate,
      }
    }

    function dockOptions() {
      return {
        title: "Варианты",
        items: variantItems(storyIndex),
        route: router.current.kind === "leaf" ? router.current.path : "",
        onNavigate: navigate,
      }
    }

    function publish(): void {
      for (const surface of [backdrop, catalog, sections, dock, preview, storyPanel]) surface.flushPendingRender()
      document.documentElement.dataset.storybookDocsRoute = router.current.path
      document.documentElement.dataset.storybookDocsRouteKind = router.current.kind
      document.documentElement.dataset.storybookDocsStory = storyRoute
      document.documentElement.dataset.storybookDocsSource = storyModule.source(args)
      document.documentElement.dataset.storybookDocsArgs = JSON.stringify(args)
    }

    async function applyRoute(node: StorybookRouteTreeNode<string>): Promise<void> {
      const revision = ++selectionRevision
      const nextRoute = storybookWorkbenchPresentationRoute(node.path)
      const nextIndex = requireStory(nextRoute)
      const nextModule = await STORYBOOK_WORKBENCH_STORIES.load(nextRoute)
      if (revision !== selectionRevision || router.current !== node) return
      storyRoute = nextRoute
      storyIndex = nextIndex
      storyModule = nextModule
      args = Object.freeze({...storyModule.defaultArgs})
      clickCount = 0
      controlChanges = 0
      catalog.setOptions(catalogOptions())
      sections.setOptions(sectionOptions())
      dock.setOptions(dockOptions())
      preview.setStory(storyIndex, storyModule, args)
      storyPanel.setOptions(panelOptions())
      runtime.relayout()
      publish()
    }

    observeStorybookWorkbenchButtonClicks(() => {
      clickCount += 1
      storyPanel.setOptions(panelOptions())
      publish()
    })
    router.subscribe((node) => {
      void applyRoute(node).catch(publishError)
    })
    new ResizeObserver(() => {
      runtime.handleResize()
      publish()
    }).observe(canvas)

    runtime.handleResize()
    publish()
    await nextPresentedFrame()
    publish()
    document.documentElement.dataset.storybookDocs = "ready"
  } catch (error) {
    publishError(error)
    throw error
  }
}

function requireStory(route: string): StorybookStoryIndexItem {
  const story = STORYBOOK_WORKBENCH_STORIES.find(route)
  if (story === undefined) throw new Error(`Storybook Workbench story not found: ${route}`)
  return story
}

function catalogItems(collapsed: ReadonlySet<string>): readonly StorybookNavigationItem<string>[] {
  const firstByComponent = new Map<string, StorybookStoryIndexItem>()
  for (const item of STORYBOOK_WORKBENCH_STORIES.index) {
    if (!firstByComponent.has(item.componentId)) firstByComponent.set(item.componentId, item)
  }
  return [...firstByComponent.values()].map((item) => ({
    id: item.componentId,
    label: item.componentLabel,
    route: item.componentId,
    group: {
      id: item.groupId,
      label: item.groupLabel,
      collapsed: collapsed.has(item.groupId),
    },
    searchText: `${item.apiName} ${item.tags.join(" ")}`,
  }))
}

function sectionItems(selected: StorybookStoryIndexItem): readonly StorybookNavigationItem<string>[] {
  const firstBySection = new Map<string, StorybookStoryIndexItem>()
  for (const item of STORYBOOK_WORKBENCH_STORIES.index) {
    if (item.componentId === selected.componentId && !firstBySection.has(item.sectionId)) {
      firstBySection.set(item.sectionId, item)
    }
  }
  return [...firstBySection.values()].map((item) => ({
    id: item.sectionId,
    label: item.sectionLabel,
    route: `${item.componentId}/${item.sectionId}`,
  }))
}

function variantItems(selected: StorybookStoryIndexItem): readonly StorybookNavigationItem<string>[] {
  return STORYBOOK_WORKBENCH_STORIES.variants(selected.route).map((item) => ({
    id: item.variantId,
    label: item.variantLabel,
    route: item.route,
  }))
}

function nextPresentedFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

function publishError(error: unknown): void {
  document.documentElement.dataset.storybookDocs = "error"
  document.documentElement.dataset.storybookDocsError = error instanceof Error
    ? error.stack ?? error.message
    : String(error)
}

if (typeof document !== "undefined") await startStorybookWorkbenchDocumentation()
