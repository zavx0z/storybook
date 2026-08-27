import {type Object3D} from "@engine/core"
import {Button} from "@ui/components/button"
import {
  CodeEditor,
  type CodeEditorScrollPosition,
  type CodeEditorSelection,
} from "@ui/components/code-editor"
import {
  Inspector,
  planInspector,
  type InspectorCategory,
  type InspectorPlan,
  type InspectorSection,
} from "@ui/components/inspector"
import {Pane} from "@ui/components/pane"
import {TextField} from "@ui/components/text-field"
import {Typography} from "@ui/components/typography"
import {div, divScrollPosition, divScrollTo} from "@ui/elements/div"
import {li, ul} from "@ui/elements/list"
import {uiIcons} from "@ui/elements/icons"
import {uiShapeMetrics} from "@ui/elements/shape"
import {span} from "@ui/elements/span"
import {statusBar, type StatusBarItem} from "@ui/elements/status-bar"
import {activeUiTheme} from "@ui/elements/theme"
import {
  rgba8ToColor,
} from "@ui/elements/theme-reference"
import {UiSurface, Z} from "@layout/core/surface"
import {type UiSurfaceRect} from "@layout/core/runtime"
import {flexColumn, flexRow} from "@layout/core/flex"
import {storybookTheme} from "./theme.ts"
import {STORYBOOK_SHELL_BACKGROUND_RGBA} from "../shell-theme.ts"
import {readInjectedStorybookStatusBar} from "../internal/status-bar-environment.ts"
import type {
  StorybookStoryArgs,
  StorybookStoryControl,
  StorybookStorySource,
} from "../stories.ts"

export type StorybookNavigationGroup = Readonly<{
  id: string
  label: string
  collapsed?: boolean
}>

export type StorybookNavigationItem<Route extends string> = Readonly<{
  id: string
  label: string
  route: Route
  disabled?: boolean
  group?: StorybookNavigationGroup
  searchText?: string
}>

export type StorybookNavigationWindow = Readonly<{
  offset: number
  limit: number
}>

export type StorybookNavigationView<Route extends string> = Readonly<{
  total: number
  offset: number
  items: readonly StorybookNavigationItem<Route>[]
}>

export type StorybookNavigationOptions<Route extends string> = Readonly<{
  title: string
  items: readonly StorybookNavigationItem<Route>[]
  route: Route
  onNavigate(route: Route): void
  query?: string
  window?: StorybookNavigationWindow
  searchPlaceholder?: string
  onQueryChange?(query: string): void
  onGroupToggle?(groupId: string, collapsed: boolean): void
}>

export type StorybookInfoLine = string | Readonly<{
  id: string
  label: string
}>

export type StorybookInfoOptions = Readonly<{
  title: string
  lines: readonly StorybookInfoLine[]
  status?: string
}>

export type StorybookPreviewChromeOptions = Readonly<{
  title?: string
  description?: string
}>

export type StorybookStatusBarOptions = Readonly<{
  lead: string
  owner: string
  detail: string
}>

export type StorybookStoryPanelCategory = "source" | "controls" | "events"
export type StorybookStorySourceKind = keyof StorybookStorySource

export type StorybookStoryEvent = Readonly<{
  id: string
  label: string
  value: string
}>

export type StorybookStoryPanelOptions = Readonly<{
  source: StorybookStorySource
  args: StorybookStoryArgs
  controls: readonly StorybookStoryControl[]
  events?: readonly StorybookStoryEvent[]
  contextLabel?: string
  category: StorybookStoryPanelCategory
  onCategoryChange(category: StorybookStoryPanelCategory): void
  onControlChange(key: string, value: unknown): void
  onCopy(kind: StorybookStorySourceKind, source: string): void | Promise<void>
  onSourceScrollChange?(kind: StorybookStorySourceKind, position: CodeEditorScrollPosition): void
  onSourceSelectionChange?(kind: StorybookStorySourceKind, selection: CodeEditorSelection | null): void
}>

export type StorybookRetainedOwnerDiagnostics = Readonly<{
  key: string
  materializations: number
}>

export type StorybookRetainedDiagnostics = Readonly<{
  layoutPlans: number
  materializations: number
  owners: readonly StorybookRetainedOwnerDiagnostics[]
}>

type RetainedOwner = {
  key: string
  parent: Object3D
  frame: UiSurfaceRect | null
  materializations: number
}

type NormalizedNavigationGroup = Readonly<{
  id: string
  label: string
  collapsed: boolean
}>

type NormalizedNavigationItem<Route extends string> = Readonly<{
  id: string
  label: string
  route: Route
  disabled: boolean
  group: NormalizedNavigationGroup | undefined
  searchText: string
}>

type NormalizedNavigationOptions<Route extends string> = Readonly<{
  title: string
  items: readonly NormalizedNavigationItem<Route>[]
  route: Route
  onNavigate(route: Route): void
  query: string
  window: StorybookNavigationWindow | undefined
  searchPlaceholder: string | undefined
  onQueryChange: ((query: string) => void) | undefined
  onGroupToggle: ((groupId: string, collapsed: boolean) => void) | undefined
}>

type NavigationSectionRow<Route extends string> = Readonly<{
  kind: "section"
  id: string
  ownerKey: string
  group: NormalizedNavigationGroup
  leaves: readonly NormalizedNavigationItem<Route>[]
}>

type NavigationLeafRow<Route extends string> = Readonly<{
  kind: "leaf"
  id: string
  ownerKey: string
  item: NormalizedNavigationItem<Route>
  parentId: string | null
}>

type NavigationRow<Route extends string> = NavigationSectionRow<Route> | NavigationLeafRow<Route>

type NormalizedInfoLine = Readonly<{
  key: string
  label: string
}>

type NormalizedInfoOptions = Readonly<{
  title: string
  lines: readonly NormalizedInfoLine[]
  status: string | undefined
}>

type NormalizedStoryControl = Readonly<{
  descriptor: StorybookStoryControl
  value: unknown
}>

type NormalizedStoryPanelOptions = Readonly<{
  source: StorybookStorySource
  controls: readonly NormalizedStoryControl[]
  events: readonly StorybookStoryEvent[]
  contextLabel: string | undefined
  category: StorybookStoryPanelCategory
  onCategoryChange(category: StorybookStoryPanelCategory): void
  onControlChange(key: string, value: unknown): void
  onCopy(kind: StorybookStorySourceKind, source: string): void | Promise<void>
  onSourceScrollChange: ((kind: StorybookStorySourceKind, position: CodeEditorScrollPosition) => void) | undefined
  onSourceSelectionChange: ((kind: StorybookStorySourceKind, selection: CodeEditorSelection | null) => void) | undefined
}>

const PANEL_OWNER = "panel"
const TITLE_OWNER = "title"
const STATUS_OWNER = "status"
const SEARCH_OWNER = "search"
const STORY_SOURCE_KINDS = Object.freeze(["html", "css", "typescript"] as const)
const STORY_INSPECTOR_KEY = "storybook-story-inspector"
const STORY_INSPECTOR_SECTIONS_SCROLL_KEY = `${STORY_INSPECTOR_KEY}:sections`
const workbenchText = rgba8ToColor(activeUiTheme.widgets.box.text)
const workbenchMuted = rgba8ToColor(activeUiTheme.widgets.menuBack.text)
const workbenchNavigationFill = rgba8ToColor(activeUiTheme.spaceNode.list)
const workbenchSectionHeaderFill = rgba8ToColor(activeUiTheme.spaceNode.panel.header)
const workbenchSectionBodyFill = rgba8ToColor(activeUiTheme.spaceNode.panel.back)
const workbenchEditorBorder = rgba8ToColor(activeUiTheme.material.editorBorder)
const workbenchFocusOutline = rgba8ToColor(activeUiTheme.material.editorOutlineActive)

abstract class RetainedStorybookSurface extends UiSurface {
  readonly #retainedRoot: Object3D
  readonly #owners = new Map<string, RetainedOwner>()
  readonly #ownerKeysByParent = new Map<Object3D, string>()
  readonly #dirtyOwners = new Set<string>()
  #layoutPlans = 0
  #materializations = 0
  #panelActive = false

  protected constructor(name: string) {
    super({bgColor: null, borderColor: null})
    this.node.name = name
    this.#retainedRoot = this.createRetainedParent()
    this.#retainedRoot.name = `${name}.retainedRoot`
  }

  /** Bounded cumulative evidence for the current retained owners of this dev surface. */
  get diagnostics(): StorybookRetainedDiagnostics {
    const owners: StorybookRetainedOwnerDiagnostics[] = []
    for (const parent of this.#retainedRoot.children) {
      const key = this.#ownerKeysByParent.get(parent)
      const owner = key === undefined ? undefined : this.#owners.get(key)
      if (owner !== undefined) owners.push(Object.freeze({key: owner.key, materializations: owner.materializations}))
    }
    return Object.freeze({
      layoutPlans: this.#layoutPlans,
      materializations: this.#materializations,
      owners: Object.freeze(owners),
    })
  }

  protected noteLayoutPlan(): void {
    this.#layoutPlans += 1
  }

  protected markOwnerDirty(key: string): void {
    if (this.#owners.has(key)) this.#dirtyOwners.add(key)
  }

  protected get panelActive(): boolean {
    return this.#panelActive
  }

  onActivate(): void {
    if (this.#panelActive) return
    this.#panelActive = true
    this.markOwnerDirty(PANEL_OWNER)
    this.requestRender()
  }

  override onDeactivate(): void {
    super.onDeactivate()
    if (!this.#panelActive) return
    this.#panelActive = false
    this.markOwnerDirty(PANEL_OWNER)
    this.requestRender()
  }

  protected reconcileOwner(key: string, name: string, frame: UiSurfaceRect, force = false): RetainedOwner {
    let owner = this.#owners.get(key)
    if (owner === undefined) {
      const parent = this.createRetainedParent(this.#retainedRoot)
      parent.name = name
      owner = {key, parent, frame: null, materializations: 0}
      this.#owners.set(key, owner)
      this.#ownerKeysByParent.set(parent, key)
      this.#dirtyOwners.add(key)
    }

    const previous = owner.frame
    if (force || previous === null || previous.x !== frame.x || previous.y !== frame.y) {
      this.updateRetainedTransform(owner.parent, (parent) => {
        parent.position.set(frame.x * this.pixelScale, -frame.y * this.pixelScale, 0)
      })
    }
    if (force || previous === null || previous.w !== frame.w || previous.h !== frame.h) this.#dirtyOwners.add(key)
    owner.frame = {...frame}
    return owner
  }

  protected removeMissingOwners(retainedKeys: ReadonlySet<string>): void {
    for (const [key, owner] of this.#owners) {
      if (retainedKeys.has(key)) continue
      this.#dirtyOwners.delete(key)
      this.#ownerKeysByParent.delete(owner.parent)
      this.removeRetainedParent(owner.parent)
      this.#owners.delete(key)
    }
  }

  protected setOwnerOrder(keys: readonly string[]): void {
    const parents = keys.map((key) => this.#requireOwner(key).parent)
    if (parents.length === this.#retainedRoot.children.length &&
      parents.every((parent, index) => this.#retainedRoot.children[index] === parent)) return
    for (const parent of parents) {
      this.#retainedRoot.remove(parent)
      this.#retainedRoot.add(parent)
    }
  }

  protected materializeDirtyOwners(draw: (key: string, frame: UiSurfaceRect) => void): void {
    for (const key of [...this.#dirtyOwners]) {
      const owner = this.#owners.get(key)
      this.#dirtyOwners.delete(key)
      if (owner?.frame === null || owner === undefined) continue
      try {
        this.materializeRetainedParent(owner.parent, () => draw(key, owner.frame!))
      } catch (error) {
        if (this.#owners.get(key) === owner) this.#dirtyOwners.add(key)
        throw error
      }
      owner.materializations += 1
      this.#materializations += 1
    }
  }

  protected override onRetainedInteractionChange(parent: Object3D): void {
    const key = this.#ownerKeysByParent.get(parent)
    if (key !== undefined) this.#dirtyOwners.add(key)
  }

  override dispose(): void {
    super.dispose()
    this.#owners.clear()
    this.#ownerKeysByParent.clear()
    this.#dirtyOwners.clear()
  }

  #requireOwner(key: string): RetainedOwner {
    const owner = this.#owners.get(key)
    if (owner === undefined) throw new Error(`Unknown retained storybook owner: ${key}`)
    return owner
  }
}

abstract class StorybookNavigationBaseSurface<Route extends string> extends RetainedStorybookSurface {
  #options: NormalizedNavigationOptions<Route>
  #layout: Readonly<{w: number; h: number; pixelScale: number; font: unknown; ownerKeys: readonly string[]}> | null = null
  #focusedOwnerKey: string | null
  #focusVisible = false
  readonly #dock: boolean

  protected constructor(options: StorybookNavigationOptions<Route>, dock: boolean) {
    const normalized = normalizeNavigationOptions(options)
    super(dock ? "StorybookDockSurface" : `StorybookNavigationSurface.${normalized.title}`)
    this.#options = normalized
    this.#dock = dock
    this.#focusedOwnerKey = preferredNavigationRowFocus(
      this.#focusRows(normalized),
      normalized.route,
      null,
      normalized.onGroupToggle !== undefined,
    )
  }

  /** Stable descriptor focus shared by pointer and keyboard navigation. */
  get focusedItemId(): string | null {
    return navigationRowId(this.#focusRows().find(({ownerKey}) => ownerKey === this.#focusedOwnerKey))
  }

  setOptions(options: StorybookNavigationOptions<Route>): void {
    const next = normalizeNavigationOptions(options)
    const previous = this.#options
    let changed = !sameIds(previous.items, next.items) ||
      previous.query !== next.query ||
      !sameNavigationWindow(previous.window, next.window) ||
      !sameStrings(navigationOwnerKeys(previous, this.#dock), navigationOwnerKeys(next, this.#dock))

    if (!this.#dock && previous.title !== next.title) {
      this.markOwnerDirty(TITLE_OWNER)
      changed = true
    }
    if (!this.#dock && (previous.query !== next.query || previous.searchPlaceholder !== next.searchPlaceholder ||
      (previous.onQueryChange === undefined) !== (next.onQueryChange === undefined))) {
      this.markOwnerDirty(SEARCH_OWNER)
      changed = true
    }

    if (!this.#dock) {
      const previousGroups = navigationGroups(previous)
      const nextGroups = navigationGroups(next)
      for (const [id, group] of nextGroups) {
        const before = previousGroups.get(id)
        if (before !== undefined && (before.label !== group.label || before.collapsed !== group.collapsed ||
          (previous.onGroupToggle === undefined) !== (next.onGroupToggle === undefined))) {
          this.markOwnerDirty(groupOwnerKey(id))
          changed = true
        }
      }
    }

    const previousItems = new Map(previous.items.map((item) => [item.id, item] as const))
    for (const item of next.items) {
      const before = previousItems.get(item.id)
      if (before === undefined) continue
      const beforeActive = before.route === previous.route
      const nextActive = item.route === next.route
      if (before.label !== item.label || before.route !== item.route || before.disabled !== item.disabled ||
        before.searchText !== item.searchText || !sameNavigationGroup(before.group, item.group) || beforeActive !== nextActive) {
        this.markOwnerDirty(itemOwnerKey(item.id))
        changed = true
      }
    }

    this.#options = next
    const nextFocus = preferredNavigationRowFocus(
      this.#focusRows(next),
      next.route,
      this.#focusedOwnerKey,
      next.onGroupToggle !== undefined,
    )
    if (this.#setFocus(nextFocus, this.#focusVisible)) changed = true
    if (changed) this.requestRender()
  }

  override onActivate(): void {
    super.onActivate()
    if (this.#setFocus(this.#focusedOwnerKey, true)) this.requestRender()
  }

  override onDeactivate(): void {
    super.onDeactivate()
    if (this.#setFocus(this.#focusedOwnerKey, false)) this.requestRender()
  }

  onKey(event: KeyboardEvent): void {
    if (this.#usesAccordion() && this.#handleAccordionKey(event)) return
    const direction = navigationDirection(event.key)
    if (direction !== null) {
      event.preventDefault()
      const enabled = this.#focusRows().filter((row) => navigationRowEnabled(row, false))
      let nextFocus: string | null = null
      if (enabled.length > 0) {
        if (direction === "home") nextFocus = enabled[0]!.ownerKey
        else if (direction === "end") nextFocus = enabled.at(-1)!.ownerKey
        else {
          const currentIndex = enabled.findIndex(({ownerKey}) => ownerKey === this.#focusedOwnerKey)
          const origin = currentIndex < 0 ? (direction === "next" ? -1 : 0) : currentIndex
          const offset = direction === "next" ? 1 : -1
          nextFocus = enabled[(origin + offset + enabled.length) % enabled.length]!.ownerKey
        }
      }
      if (this.#setFocus(nextFocus, true)) this.requestRender()
      return
    }
    if (!isNavigationActivationKey(event.key)) return
    event.preventDefault()
    if (this.#setFocus(preferredNavigationRowFocus(
      this.#focusRows(),
      this.#options.route,
      this.#focusedOwnerKey,
      false,
    ), true)) this.requestRender()
    this.#activateFocusedRow()
  }

  protected override render(): void {
    if (this.#layoutChanged()) this.#reconcileLayout()
    this.materializeDirtyOwners((key, frame) => this.#drawOwner(key, frame))
  }

  #layoutChanged(): boolean {
    const ownerKeys = navigationOwnerKeys(this.#options, this.#dock)
    return this.#layout === null || this.#layout.w !== this.rectW || this.#layout.h !== this.rectH ||
      this.#layout.pixelScale !== this.pixelScale || this.#layout.font !== this.font ||
      !sameStrings(this.#layout.ownerKeys, ownerKeys)
  }

  #reconcileLayout(): void {
    this.noteLayoutPlan()
    const forceGeometry = this.#layout !== null &&
      (this.#layout.pixelScale !== this.pixelScale || this.#layout.font !== this.font)
    const frames = this.#dock ? this.#planDock() : this.#planNavigation()
    const retainedKeys = new Set<string>([PANEL_OWNER, ...frames.keys()])
    this.removeMissingOwners(retainedKeys)
    this.reconcileOwner(
      PANEL_OWNER,
      `${this.node.name}.panel`,
      {x: 0, y: 0, w: this.frameWidth, h: this.frameHeight},
      forceGeometry,
    )
    for (const [key, frame] of frames) this.reconcileOwner(key, `${this.node.name}.${key}`, frame, forceGeometry)
    this.setOwnerOrder([PANEL_OWNER, ...frames.keys()])
    this.#layout = {
      w: this.rectW,
      h: this.rectH,
      pixelScale: this.pixelScale,
      font: this.font,
      ownerKeys: [...frames.keys()],
    }
  }

  #planNavigation(): Map<string, UiSurfaceRect> {
    const frames = new Map<string, UiSurfaceRect>()
    const hasAccordionSections = this.#usesAccordion()
    flexColumn({
      x: 0,
      y: 0,
      w: this.rectW,
      h: this.rectH,
      paddingX: uiShapeMetrics.tightGap * 2,
      paddingTop: uiShapeMetrics.tightGap,
      paddingBottom: uiShapeMetrics.tightGap,
      gap: hasAccordionSections ? uiShapeMetrics.separatorWidth * 2 : uiShapeMetrics.separatorWidth,
      items: [
        {height: uiShapeMetrics.panelHeaderHeight, draw: (x, y, w, h) => { frames.set(TITLE_OWNER, {x, y, w, h}) }},
        this.#options.onQueryChange === undefined ? false : {
          height: uiShapeMetrics.rowHeight,
          draw: (x: number, y: number, w: number, h: number) => { frames.set(SEARCH_OWNER, {x, y, w, h}) },
        },
        ...navigationAccordionItems(this.#options, frames),
      ],
    })
    return frames
  }

  #planDock(): Map<string, UiSurfaceRect> {
    const frames = new Map<string, UiSurfaceRect>()
    flexRow({
      x: 0,
      y: 0,
      w: this.rectW,
      h: this.rectH,
      paddingX: uiShapeMetrics.tightGap,
      paddingY: 0,
      gap: uiShapeMetrics.separatorWidth,
      alignItems: "stretch",
      items: this.#visibleItems().map((item) => ({
        width: "1fr" as const,
        height: uiShapeMetrics.rowHeight,
        draw: (x: number, y: number, w: number, h: number) => {
          frames.set(itemOwnerKey(item.id), {x, y, w, h})
        },
      })),
    })
    return frames
  }

  #drawOwner(key: string, frame: UiSurfaceRect): void {
    if (key === PANEL_OWNER) {
      if (this.#dock) drawPanel(this, frame.w, frame.h, this.panelActive)
      else drawNavigationPanel(this, frame.w, frame.h, this.panelActive)
      return
    }
    if (key === TITLE_OWNER) {
      Typography(this, 0, 0, frame.w, frame.h, {
        children: this.#options.title,
        variant: "title",
        fontPx: uiShapeMetrics.compactFontPx,
        color: workbenchText,
        style: {textAlign: "center"},
      })
      return
    }
    if (key === SEARCH_OWNER) {
      TextField(this, 0, 0, frame.w, frame.h, {
        key: `${this.node.name}:search`,
        value: this.#options.query,
        placeholder: this.#options.searchPlaceholder ?? "Поиск…",
        fontPx: uiShapeMetrics.compactFontPx,
        onChange: (value) => this.#options.onQueryChange?.(value),
      })
      return
    }
    if (key.startsWith("group:")) {
      const section = this.#focusRows().find((row): row is NavigationSectionRow<Route> =>
        row.kind === "section" && row.ownerKey === key)
      if (section === undefined) return
      const toggle = this.#options.onGroupToggle === undefined ? undefined : () => {
        const current = navigationGroups(this.#options).get(section.id)
        if (current !== undefined) this.#options.onGroupToggle?.(section.id, !current.collapsed)
      }
      drawNavigationSection(this, frame, section, this.#focusVisible && this.#focusedOwnerKey === key, toggle)
      return
    }
    const id = itemIdForOwnerKey(key)
    const item = this.#options.items.find((candidate) => candidate.id === id)
    if (item === undefined) return
    if (this.#dock || !this.#usesAccordion()) {
      const active = item.route === this.#options.route
      const focused = this.#focusVisible && this.#focusedOwnerKey === key
      Button(this, 0, 0, frame.w, frame.h, {
        children: item.label,
        variant: active ? "contained" : "glass",
        color: "neutral",
        appearance: "toolbar-item",
        selected: active,
        focused,
        disabled: item.disabled,
        fontPx: uiShapeMetrics.compactFontPx,
        onClick: () => {
          const current = this.#options.items.find((candidate) => candidate.id === id)
          if (current === undefined || current.disabled) return
          if (this.#setFocus(key, true)) this.requestRender()
          this.#options.onNavigate(current.route)
        },
      })
      return
    }
    const rows = this.#focusRows()
    const rowIndex = rows.findIndex((row) => row.ownerKey === key)
    const row = rows[rowIndex]
    const parentId = row?.kind === "leaf" ? row.parentId : null
    const nested = parentId !== null
    const nextRow = rows[rowIndex + 1]
    const lastInSection = nested && (nextRow?.kind !== "leaf" || nextRow.parentId !== parentId)
    const active = item.route === this.#options.route
    const focused = this.#focusVisible && this.#focusedOwnerKey === key
    drawNavigationLeaf(this, frame, item, active, focused, nested, lastInSection, () => {
      const current = this.#options.items.find((candidate) => candidate.id === id)
      if (current === undefined || current.disabled) return
      if (this.#setFocus(key, true)) this.requestRender()
      this.#options.onNavigate(current.route)
    })
  }

  #setFocus(ownerKey: string | null, visible: boolean): boolean {
    const canToggleSection = !this.#dock && this.#options.onGroupToggle !== undefined
    const nextOwnerKey = ownerKey === null || this.#focusRows().some((row) =>
      row.ownerKey === ownerKey && navigationRowEnabled(row, canToggleSection)) ? ownerKey : null
    const previousOwnerKey = this.#focusedOwnerKey
    const previousVisual = this.#focusVisible ? previousOwnerKey : null
    const nextVisual = visible ? nextOwnerKey : null
    if (previousVisual !== nextVisual) {
      if (previousVisual !== null) this.markOwnerDirty(previousVisual)
      if (nextVisual !== null) this.markOwnerDirty(nextVisual)
    }
    this.#focusedOwnerKey = nextOwnerKey
    this.#focusVisible = visible
    return previousOwnerKey !== nextOwnerKey || previousVisual !== nextVisual
  }

  #activateFocusedRow(): void {
    const row = this.#focusRows().find(({ownerKey}) => ownerKey === this.#focusedOwnerKey)
    if (row?.kind === "section") {
      this.#options.onGroupToggle?.(row.id, !row.group.collapsed)
      return
    }
    if (row?.kind === "leaf" && !row.item.disabled) this.#options.onNavigate(row.item.route)
  }

  #handleAccordionKey(event: KeyboardEvent): boolean {
    const rows = this.#focusRows()
    const enabled = rows.filter((row) => navigationRowEnabled(row, this.#options.onGroupToggle !== undefined))
    if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Home" || event.key === "End") {
      event.preventDefault()
      let next: string | null = null
      if (event.key === "Home") next = enabled[0]?.ownerKey ?? null
      else if (event.key === "End") next = enabled.at(-1)?.ownerKey ?? null
      else if (enabled.length > 0) {
        const index = enabled.findIndex(({ownerKey}) => ownerKey === this.#focusedOwnerKey)
        const origin = index < 0 ? (event.key === "ArrowDown" ? -1 : 0) : index
        const offset = event.key === "ArrowDown" ? 1 : -1
        next = enabled[(origin + offset + enabled.length) % enabled.length]!.ownerKey
      }
      if (this.#setFocus(next, true)) this.requestRender()
      return true
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault()
      const row = rows.find(({ownerKey}) => ownerKey === this.#focusedOwnerKey)
      if (row?.kind === "section") {
        if (event.key === "ArrowLeft" && !row.group.collapsed) {
          this.#options.onGroupToggle?.(row.id, true)
        } else if (event.key === "ArrowRight" && row.group.collapsed) {
          this.#options.onGroupToggle?.(row.id, false)
        } else if (event.key === "ArrowRight") {
          const child = enabled.find((candidate) => candidate.kind === "leaf" && candidate.parentId === row.id)
          if (child !== undefined && this.#setFocus(child.ownerKey, true)) this.requestRender()
        }
      } else if (row?.kind === "leaf" && event.key === "ArrowLeft" && row.parentId !== null) {
        if (this.#setFocus(groupOwnerKey(row.parentId), true)) this.requestRender()
      }
      return true
    }
    if (!isNavigationActivationKey(event.key)) return false
    event.preventDefault()
    if (this.#setFocus(preferredNavigationRowFocus(
      rows,
      this.#options.route,
      this.#focusedOwnerKey,
      this.#options.onGroupToggle !== undefined,
    ), true)) this.requestRender()
    this.#activateFocusedRow()
    return true
  }

  #focusRows(options: NormalizedNavigationOptions<Route> = this.#options): readonly NavigationRow<Route>[] {
    if (!this.#dock && this.#usesAccordion(options)) return navigationHierarchyRows(options)
    return Object.freeze(selectNormalizedNavigationItems(options).items.map((item): NavigationLeafRow<Route> =>
      Object.freeze({
        kind: "leaf",
        id: item.id,
        ownerKey: itemOwnerKey(item.id),
        item,
        parentId: null,
      })))
  }

  #usesAccordion(options: NormalizedNavigationOptions<Route> = this.#options): boolean {
    return !this.#dock && options.onGroupToggle !== undefined &&
      navigationHierarchyRows(options).some((row) => row.kind === "section")
  }

  #visibleItems(options: NormalizedNavigationOptions<Route> = this.#options): readonly NormalizedNavigationItem<Route>[] {
    return this.#windowItems(options).filter((item) => item.group?.collapsed !== true)
  }

  #windowItems(options: NormalizedNavigationOptions<Route> = this.#options): readonly NormalizedNavigationItem<Route>[] {
    return selectNormalizedNavigationItems(options).items
  }
}

function drawNavigationSection<Route extends string>(
  surface: UiSurface,
  frame: UiSurfaceRect,
  section: NavigationSectionRow<Route>,
  focused: boolean,
  onToggle: (() => void) | undefined,
): void {
  ul(surface, 0, 0, frame.w, frame.h, {
    key: `navigation-section:${section.id}`,
    disablePadding: true,
    itemHeight: uiShapeMetrics.rowHeight,
    style: {
      background: workbenchSectionBodyFill,
      borderColor: null,
      borderRadius: 4,
      borderWidth: 0,
      overflowY: "hidden",
      padding: 0,
    },
  })
  li(surface, 0, 0, frame.w, uiShapeMetrics.rowHeight, {
    key: `navigation-section-header:${section.id}`,
    style: {
      background: null,
      borderColor: null,
      borderRadius: 0,
      borderWidth: 0,
    },
    children: (state) => {
      drawNavigationRowFill(surface, frame.w, uiShapeMetrics.rowHeight, workbenchSectionHeaderFill, {
        topLeft: true,
        topRight: true,
        bottomLeft: frame.h === uiShapeMetrics.rowHeight,
        bottomRight: frame.h === uiShapeMetrics.rowHeight,
      })
      drawNavigationRowFill(surface, frame.w, uiShapeMetrics.rowHeight, rgba8ToColor(state.colors.inner), {
        topLeft: true,
        topRight: true,
        bottomLeft: frame.h === uiShapeMetrics.rowHeight,
        bottomRight: frame.h === uiShapeMetrics.rowHeight,
      })
      flexRow({
      x: 0,
      y: 0,
      w: frame.w,
      h: uiShapeMetrics.rowHeight,
      gap: 0,
      alignItems: "stretch",
      items: [
        {width: uiShapeMetrics.iconActionSlot, height: uiShapeMetrics.rowHeight, draw: (x, y, w, h) => {
          drawNavigationDisclosure(surface, x, y, w, h, section.group.collapsed, rgba8ToColor(state.colors.text))
        }},
        {width: "grow", height: uiShapeMetrics.rowHeight, draw: (x, y, w, h) => {
          span(surface, x, y, w, h, {
            children: section.group.label,
            style: {
              color: rgba8ToColor(state.colors.text),
              fontSize: uiShapeMetrics.compactFontPx,
              textAlign: "left",
            },
          })
        }},
      ],
      })
    },
    ...(onToggle === undefined ? {} : {onClick: onToggle}),
  })
  drawNavigationFocus(surface, frame.w, uiShapeMetrics.rowHeight, focused)
}

function drawNavigationDisclosure(
  surface: UiSurface,
  x: number,
  y: number,
  width: number,
  height: number,
  collapsed: boolean,
  color: ReturnType<typeof rgba8ToColor>,
): void {
  const cx = x + width / 2
  const cy = y + height / 2
  const half = Math.min(4, Math.max(2, Math.min(width, height) * 0.18))
  const points = collapsed
    ? [{x: cx - half / 2, y: cy - half}, {x: cx + half / 2, y: cy}, {x: cx - half / 2, y: cy + half}]
    : [{x: cx - half, y: cy - half / 2}, {x: cx, y: cy + half / 2}, {x: cx + half, y: cy - half / 2}]
  surface.drawPolyline(points, color, uiShapeMetrics.separatorWidth, Z.TEXT)
}

function drawNavigationLeaf<Route extends string>(
  surface: UiSurface,
  frame: UiSurfaceRect,
  item: NormalizedNavigationItem<Route>,
  selected: boolean,
  focused: boolean,
  nested: boolean,
  lastInSection: boolean,
  onNavigate: () => void,
): void {
  li(surface, 0, 0, frame.w, frame.h, {
    key: `navigation-leaf:${item.id}`,
    selected,
    disabled: item.disabled,
    style: {
      background: null,
      borderColor: null,
      borderRadius: 0,
      borderWidth: 0,
    },
    children: (state) => {
      drawNavigationRowFill(surface, frame.w, frame.h, rgba8ToColor(state.colors.inner), {
        topLeft: false,
        topRight: false,
        bottomLeft: lastInSection,
        bottomRight: lastInSection,
      })
      flexRow({
      x: 0,
      y: 0,
      w: frame.w,
      h: frame.h,
      gap: 0,
      alignItems: "stretch",
      items: [
        nested ? {width: uiShapeMetrics.iconActionSlot, height: frame.h, draw: () => {}} : false,
        {width: "grow", height: frame.h, draw: (x, y, w, h) => {
          span(surface, x, y, w, h, {
            children: item.label,
            style: {
              color: rgba8ToColor(state.colors.text),
              fontSize: uiShapeMetrics.compactFontPx,
              textAlign: "left",
            },
          })
        }},
      ],
      })
    },
    onClick: onNavigate,
  })
  drawNavigationFocus(surface, frame.w, frame.h, focused)
}

type NavigationRowCorners = Readonly<{
  topLeft: boolean
  topRight: boolean
  bottomLeft: boolean
  bottomRight: boolean
}>

function drawNavigationRowFill(
  surface: UiSurface,
  width: number,
  height: number,
  color: ReturnType<typeof rgba8ToColor>,
  corners: NavigationRowCorners,
): void {
  if (color.a <= 0) return
  if (corners.topLeft && corners.topRight && corners.bottomLeft && corners.bottomRight) {
    drawNavigationFillPart(surface, 0, 0, width, height, 4, color)
    return
  }
  if (!corners.topLeft && !corners.topRight && !corners.bottomLeft && !corners.bottomRight) {
    drawNavigationFillPart(surface, 0, 0, width, height, 0, color)
    return
  }
  const radius = Math.min(4, width / 2, height / 2)
  drawNavigationFillPart(surface, radius, 0, width - radius * 2, height, 0, color)
  drawNavigationFillPart(surface, 0, radius, width, height - radius * 2, 0, color)
  drawNavigationFillCorner(surface, 0, 0, radius, corners.topLeft, color)
  drawNavigationFillCorner(surface, width - radius, 0, radius, corners.topRight, color, "top-right")
  drawNavigationFillCorner(surface, 0, height - radius, radius, corners.bottomLeft, color, "bottom-left")
  drawNavigationFillCorner(surface, width - radius, height - radius, radius, corners.bottomRight, color, "bottom-right")
}

function drawNavigationFillCorner(
  surface: UiSurface,
  x: number,
  y: number,
  radius: number,
  rounded: boolean,
  color: ReturnType<typeof rgba8ToColor>,
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right" = "top-left",
): void {
  if (!rounded) {
    drawNavigationFillPart(surface, x, y, radius, radius, 0, color)
    return
  }
  const patchX = corner === "top-right" || corner === "bottom-right" ? x - radius : x
  const patchY = corner === "bottom-left" || corner === "bottom-right" ? y - radius : y
  drawNavigationFillPart(surface, patchX, patchY, radius * 2, radius * 2, radius, color)
}

function drawNavigationFillPart(
  surface: UiSurface,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: ReturnType<typeof rgba8ToColor>,
): void {
  if (width <= 0 || height <= 0) return
  div(surface, x, y, width, height, {
    style: {
      background: color,
      borderColor: null,
      borderRadius: radius,
      borderWidth: 0,
      zIndex: Z.ELEMENT,
    },
  })
}

function drawNavigationFocus(surface: UiSurface, width: number, height: number, focused: boolean): void {
  if (!focused) return
  div(surface, 0, 0, width, height, {
    style: {
      background: null,
      borderColor: workbenchFocusOutline,
      borderRadius: 0,
      borderWidth: uiShapeMetrics.borderWidth,
      zIndex: Z.ELEMENT_RULE,
    },
  })
}

function drawNavigationPanel(surface: UiSurface, width: number, height: number, active: boolean): void {
  div(surface, 0, 0, width, height, {
    style: {
      background: workbenchNavigationFill,
      borderColor: workbenchEditorBorder,
      borderRadius: 6,
      borderWidth: uiShapeMetrics.borderWidth,
      zIndex: -0.12,
    },
  })
  div(surface, 0, 0, width, height, {
    style: {
      background: null,
      borderColor: rgba8ToColor(
        active ? activeUiTheme.material.editorOutlineActive : activeUiTheme.material.editorOutline,
      ),
      borderRadius: 6,
      borderWidth: uiShapeMetrics.borderWidth,
      zIndex: -0.11,
    },
  })
}

export class StorybookNavigationSurface<Route extends string> extends StorybookNavigationBaseSurface<Route> {
  constructor(options: StorybookNavigationOptions<Route>) {
    super(options, false)
  }
}

export class StorybookDockSurface<Route extends string> extends StorybookNavigationBaseSurface<Route> {
  constructor(options: StorybookNavigationOptions<Route>) {
    super(options, true)
  }
}

export class StorybookInfoSurface extends RetainedStorybookSurface {
  #options: NormalizedInfoOptions
  #layout: Readonly<{
    w: number
    h: number
    pixelScale: number
    font: unknown
    lineKeys: readonly string[]
    status: boolean
  }> | null = null

  constructor(options: StorybookInfoOptions) {
    super("StorybookInfoSurface")
    this.#options = normalizeInfoOptions(options)
  }

  setOptions(options: StorybookInfoOptions): void {
    const next = normalizeInfoOptions(options)
    const previous = this.#options
    let changed = !sameStrings(previous.lines.map(({key}) => key), next.lines.map(({key}) => key)) ||
      (previous.status === undefined) !== (next.status === undefined)

    if (previous.title !== next.title) {
      this.markOwnerDirty(TITLE_OWNER)
      changed = true
    }
    const previousLines = new Map(previous.lines.map((line) => [line.key, line] as const))
    for (const line of next.lines) {
      if (previousLines.get(line.key)?.label !== line.label) {
        this.markOwnerDirty(line.key)
        changed = true
      }
    }
    if (previous.status !== next.status && previous.status !== undefined && next.status !== undefined) {
      this.markOwnerDirty(STATUS_OWNER)
      changed = true
    }

    this.#options = next
    if (changed) this.requestRender()
  }

  protected override render(): void {
    if (this.#layoutChanged()) this.#reconcileLayout()
    this.materializeDirtyOwners((key, frame) => this.#drawOwner(key, frame))
  }

  #layoutChanged(): boolean {
    return this.#layout === null || this.#layout.w !== this.rectW || this.#layout.h !== this.rectH ||
      this.#layout.pixelScale !== this.pixelScale || this.#layout.font !== this.font ||
      this.#layout.status !== (this.#options.status !== undefined) ||
      !sameStrings(this.#layout.lineKeys, this.#options.lines.map(({key}) => key))
  }

  #reconcileLayout(): void {
    this.noteLayoutPlan()
    const forceGeometry = this.#layout !== null &&
      (this.#layout.pixelScale !== this.pixelScale || this.#layout.font !== this.font)
    const frames = new Map<string, UiSurfaceRect>()
    flexColumn({
      x: 0,
      y: 0,
      w: this.rectW,
      h: this.rectH,
      paddingX: uiShapeMetrics.tightGap * 2,
      paddingTop: uiShapeMetrics.tightGap,
      paddingBottom: uiShapeMetrics.tightGap,
      gap: uiShapeMetrics.separatorWidth,
      items: [
        {height: uiShapeMetrics.panelHeaderHeight, draw: (x, y, w, h) => { frames.set(TITLE_OWNER, {x, y, w, h}) }},
        ...this.#options.lines.map((line) => ({
          height: uiShapeMetrics.rowHeight,
          draw: (x: number, y: number, w: number, h: number) => { frames.set(line.key, {x, y, w, h}) },
        })),
        {height: "grow" as const, draw: () => {}},
        this.#options.status === undefined ? false : {
          height: uiShapeMetrics.rowHeight,
          draw: (x: number, y: number, w: number, h: number) => { frames.set(STATUS_OWNER, {x, y, w, h}) },
        },
      ],
    })

    const retainedKeys = new Set<string>([PANEL_OWNER, ...frames.keys()])
    this.removeMissingOwners(retainedKeys)
    this.reconcileOwner(
      PANEL_OWNER,
      "StorybookInfoSurface.panel",
      {x: 0, y: 0, w: this.frameWidth, h: this.frameHeight},
      forceGeometry,
    )
    for (const [key, frame] of frames) this.reconcileOwner(key, `StorybookInfoSurface.${key}`, frame, forceGeometry)
    this.setOwnerOrder([PANEL_OWNER, ...frames.keys()])
    this.#layout = {
      w: this.rectW,
      h: this.rectH,
      pixelScale: this.pixelScale,
      font: this.font,
      lineKeys: this.#options.lines.map(({key}) => key),
      status: this.#options.status !== undefined,
    }
  }

  #drawOwner(key: string, frame: UiSurfaceRect): void {
    if (key === PANEL_OWNER) {
      drawPanel(this, frame.w, frame.h, this.panelActive)
      return
    }
    if (key === TITLE_OWNER) {
      Typography(this, 0, 0, frame.w, frame.h, {
        children: this.#options.title,
        variant: "title",
        fontPx: uiShapeMetrics.compactFontPx,
        color: workbenchText,
      })
      return
    }
    if (key === STATUS_OWNER) {
      if (this.#options.status !== undefined) {
        Typography(this, 0, 0, frame.w, frame.h, {
          children: this.#options.status,
          variant: "caption",
          color: rgba8ToColor(activeUiTheme.state.info),
        })
      }
      return
    }
    const line = this.#options.lines.find((candidate) => candidate.key === key)
    if (line !== undefined) Typography(this, 0, 0, frame.w, frame.h, {children: line.label, variant: "caption", color: workbenchMuted})
  }
}

/** Retained HTML/CSS/TypeScript source and controls panel for one selected story. */
export class StorybookStoryPanelSurface extends RetainedStorybookSurface {
  #options: NormalizedStoryPanelOptions
  #query = ""
  #sectionsScrollTop = 0
  #expandedSections = new Map<string, boolean>([
    ["html", true],
    ["css", true],
    ["typescript", true],
    ["controls", true],
    ["events", true],
  ])
  #layout: Readonly<{
    w: number
    h: number
    pixelScale: number
    font: unknown
    ownerKeys: readonly string[]
    plan: InspectorPlan
  }> | null = null

  constructor(options: StorybookStoryPanelOptions) {
    super("StorybookStoryPanelSurface")
    this.#options = normalizeStoryPanelOptions(options)
  }

  /** Current position of one independently owned source editor. */
  sourceScrollPosition(kind: StorybookStorySourceKind): CodeEditorScrollPosition {
    return divScrollPosition(this, storySourceScrollKey(kind))
  }

  setOptions(options: StorybookStoryPanelOptions): void {
    const next = normalizeStoryPanelOptions(options)
    const previous = this.#options
    const changedSourceKinds = STORY_SOURCE_KINDS.filter((kind) => previous.source[kind] !== next.source[kind])
    const categoryChanged = previous.category !== next.category
    const structureChanged = categoryChanged || previous.contextLabel !== next.contextLabel ||
      !sameStrings(previous.controls.map(({descriptor}) => descriptor.key), next.controls.map(({descriptor}) => descriptor.key)) ||
      !sameStrings(previous.controls.map(({descriptor}) => descriptor.group), next.controls.map(({descriptor}) => descriptor.group)) ||
      !sameStrings(previous.events.map(({id}) => id), next.events.map(({id}) => id))
    let changed = structureChanged

    for (const kind of changedSourceKinds) {
      this.markOwnerDirty(storySourceBoxOwnerKey(kind))
      changed = true
    }
    const previousControls = new Map(previous.controls.map((control) => [control.descriptor.key, control] as const))
    for (const control of next.controls) {
      const before = previousControls.get(control.descriptor.key)
      if (before === undefined || before.descriptor.label !== control.descriptor.label ||
        before.descriptor.group !== control.descriptor.group || before.descriptor.kind !== control.descriptor.kind ||
        !Object.is(before.value, control.value)) {
        this.markOwnerDirty(storyControlOwnerKey(control.descriptor.key))
        changed = true
      }
    }
    const previousEvents = new Map(previous.events.map((event) => [event.id, event] as const))
    for (const event of next.events) {
      const before = previousEvents.get(event.id)
      if (before?.label !== event.label || before?.value !== event.value) {
        this.markOwnerDirty(storyEventOwnerKey(event.id))
        changed = true
      }
    }
    if (categoryChanged) {
      this.#query = ""
      this.#sectionsScrollTop = 0
      divScrollTo(this, STORY_INSPECTOR_SECTIONS_SCROLL_KEY, {left: 0, top: 0})
    }
    this.#options = next
    if (structureChanged) {
      this.#layout = null
      this.markOwnerDirty(PANEL_OWNER)
    }
    if (changed) this.requestRender()
  }

  protected override render(): void {
    if (this.#layoutChanged()) this.#reconcileLayout()
    this.materializeDirtyOwners((key, frame) => this.#drawOwner(key, frame))
  }

  #layoutChanged(): boolean {
    return this.#layout === null || this.#layout.w !== this.rectW || this.#layout.h !== this.rectH ||
      this.#layout.pixelScale !== this.pixelScale || this.#layout.font !== this.font
  }

  #reconcileLayout(): void {
    this.noteLayoutPlan()
    const forceGeometry = this.#layout !== null &&
      (this.#layout.pixelScale !== this.pixelScale || this.#layout.font !== this.font)
    const categories = this.#inspectorCategories()
    const sections = this.#inspectorSections()
    const plan = planInspector(
      0,
      0,
      this.rectW,
      this.rectH,
      {
        categories,
        selectedCategoryId: this.#options.category,
        sections,
        query: this.#query,
        ...(this.#options.contextLabel === undefined ? {} : {context: {label: this.#options.contextLabel}}),
      },
      this.#sectionsScrollTop,
    )
    const frames = new Map<string, UiSurfaceRect>()
    if (this.#options.category === "source") {
      for (const section of plan.sections) {
        if (!isStorySourceKind(section.id) || section.content === null) continue
        frames.set(storySourceBoxOwnerKey(section.id), section.content)
      }
    } else if (this.#options.category === "controls") {
      const content = plan.sections.find(({id}) => id === "controls")?.content
      if (content !== null && content !== undefined) {
        let y = content.y
        let group: string | undefined
        for (const control of this.#options.controls) {
          if (control.descriptor.group !== group) {
            group = control.descriptor.group
            frames.set(storyControlGroupOwnerKey(group), {
              x: content.x,
              y,
              w: content.w,
              h: uiShapeMetrics.rowHeight,
            })
            y += uiShapeMetrics.rowHeight + uiShapeMetrics.separatorWidth
          }
          frames.set(storyControlOwnerKey(control.descriptor.key), {
            x: content.x,
            y,
            w: content.w,
            h: uiShapeMetrics.rowHeight,
          })
          y += uiShapeMetrics.rowHeight + uiShapeMetrics.separatorWidth
        }
      }
    } else {
      const content = plan.sections.find(({id}) => id === "events")?.content
      if (content !== null && content !== undefined) {
        let y = content.y
        for (const event of this.#options.events) {
          frames.set(storyEventOwnerKey(event.id), {
            x: content.x,
            y,
            w: content.w,
            h: uiShapeMetrics.rowHeight,
          })
          y += uiShapeMetrics.rowHeight + uiShapeMetrics.separatorWidth
        }
      }
    }

    const retainedKeys = new Set<string>([PANEL_OWNER, ...frames.keys()])
    this.removeMissingOwners(retainedKeys)
    this.reconcileOwner(PANEL_OWNER, "StorybookStoryPanelSurface.panel", {
      x: 0,
      y: 0,
      w: this.frameWidth,
      h: this.frameHeight,
    }, forceGeometry)
    for (const [key, frame] of frames) this.reconcileOwner(key, `StorybookStoryPanelSurface.${key}`, frame, forceGeometry)
    this.setOwnerOrder([PANEL_OWNER, ...frames.keys()])
    this.#layout = {
      w: this.rectW,
      h: this.rectH,
      pixelScale: this.pixelScale,
      font: this.font,
      ownerKeys: [...frames.keys()],
      plan,
    }
  }

  #inspectorCategories(): readonly InspectorCategory[] {
    return Object.freeze([
      Object.freeze({
        id: "source",
        label: "Исходный код",
        iconSrc: uiIcons.language,
        sectionIds: STORY_SOURCE_KINDS,
      }),
      Object.freeze({
        id: "controls",
        label: "Параметры",
        iconSrc: uiIcons.settings,
        sectionIds: Object.freeze(["controls"]),
      }),
      Object.freeze({
        id: "events",
        label: "События",
        iconSrc: uiIcons.log,
        sectionIds: Object.freeze(["events"]),
      }),
    ])
  }

  #inspectorSections(): readonly InspectorSection[] {
    const sourceSections = STORY_SOURCE_KINDS.map((kind): InspectorSection => {
      const label = storySourceTitle(kind)
      return Object.freeze({
        id: kind,
        label,
        expanded: this.#expandedSections.get(kind) ?? true,
        contentHeight: uiShapeMetrics.rowHeight * 6,
        actions: Object.freeze([Object.freeze({
          id: `copy-${kind}`,
          label: `Копировать ${label}`,
          iconSrc: uiIcons.copy,
          action: () => { void this.#options.onCopy(kind, this.#options.source[kind]) },
        })]),
        render() {},
      })
    })
    const controlGroups = [...new Set(this.#options.controls.map(({descriptor}) => descriptor.group))]
    const controlsRows = this.#options.controls.length + controlGroups.length
    const controls: InspectorSection = Object.freeze({
      id: "controls",
      label: "Параметры",
      expanded: this.#expandedSections.get("controls") ?? true,
      contentHeight: controlsRows * uiShapeMetrics.rowHeight +
        Math.max(0, controlsRows - 1) * uiShapeMetrics.separatorWidth,
      render() {},
    })
    const events: InspectorSection = Object.freeze({
      id: "events",
      label: "События",
      expanded: this.#expandedSections.get("events") ?? true,
      contentHeight: this.#options.events.length * uiShapeMetrics.rowHeight +
        Math.max(0, this.#options.events.length - 1) * uiShapeMetrics.separatorWidth,
      render() {},
    })
    return Object.freeze([...sourceSections, controls, events])
  }

  #markInspectorContentsDirty(): void {
    for (const key of this.#layout?.ownerKeys ?? []) this.markOwnerDirty(key)
  }

  #drawInspector(frame: UiSurfaceRect): void {
    Inspector(this, 0, 0, frame.w, frame.h, {
      key: STORY_INSPECTOR_KEY,
      categories: this.#inspectorCategories(),
      selectedCategoryId: this.#options.category,
      sections: this.#inspectorSections(),
      query: this.#query,
      searchPlaceholder: "HTML, CSS, TypeScript, параметр или событие…",
      ...(this.#options.contextLabel === undefined ? {} : {context: {label: this.#options.contextLabel}}),
      style: {borderRadius: 6},
      onCategoryChange: (id) => {
        if (!isStoryPanelCategory(id) || id === this.#options.category) return
        this.#options.onCategoryChange(id)
      },
      onQueryChange: (query) => {
        if (query === this.#query) return
        this.#query = query
        this.#sectionsScrollTop = 0
        divScrollTo(this, STORY_INSPECTOR_SECTIONS_SCROLL_KEY, {left: 0, top: 0})
        this.#markInspectorContentsDirty()
        this.#layout = null
        this.markOwnerDirty(PANEL_OWNER)
        this.requestRender()
      },
      onSectionToggle: (id, expanded) => {
        if (this.#expandedSections.get(id) === expanded) return
        this.#expandedSections.set(id, expanded)
        this.#markInspectorContentsDirty()
        this.#layout = null
        this.markOwnerDirty(PANEL_OWNER)
        this.requestRender()
      },
      onSectionsScrollChange: ({top}) => {
        if (top === this.#sectionsScrollTop) return
        this.#sectionsScrollTop = top
        this.#markInspectorContentsDirty()
        this.#layout = null
        this.markOwnerDirty(PANEL_OWNER)
        this.requestRender()
      },
    })
  }

  #drawInSectionsViewport(frame: UiSurfaceRect, draw: () => void): void {
    const viewport = this.#layout?.plan.sectionsViewport
    if (viewport === undefined) return
    const clip = intersectSurfaceRects(frame, viewport)
    if (clip === null) return
    if (clip.x === frame.x && clip.y === frame.y && clip.w === frame.w && clip.h === frame.h) {
      draw()
      return
    }
    div(this, clip.x - frame.x, clip.y - frame.y, clip.w, clip.h, {
      style: {
        background: null,
        borderColor: null,
        borderRadius: 0,
        overflow: "hidden",
        padding: 0,
      },
      children: draw,
    })
  }

  #drawOwner(key: string, frame: UiSurfaceRect): void {
    if (key === PANEL_OWNER) {
      this.#drawInspector(frame)
      return
    }
    const boxKind = storySourceKindFromOwnerKey(key, "source-box:")
    if (boxKind !== undefined) {
      this.#drawInSectionsViewport(frame, () => {
        CodeEditor(this, 0, 0, frame.w, frame.h, {
          key: storySourceScrollKey(boxKind),
          value: this.#options.source[boxKind],
          readOnly: true,
          languageId: boxKind,
          showLineNumbers: true,
          fontPx: uiShapeMetrics.compactFontPx,
          linePx: uiShapeMetrics.compactFontPx + uiShapeMetrics.tightGap + uiShapeMetrics.separatorWidth,
          ...(this.#options.onSourceScrollChange === undefined ? {} : {
            onScrollChange: (position) => this.#options.onSourceScrollChange?.(boxKind, position),
          }),
          ...(this.#options.onSourceSelectionChange === undefined ? {} : {
            onSelectionChange: (selection) => this.#options.onSourceSelectionChange?.(boxKind, selection),
          }),
        })
      })
      return
    }
    if (key.startsWith("source-control-group:")) {
      this.#drawInSectionsViewport(frame, () => Typography(this, 0, 0, frame.w, frame.h, {
        children: controlGroupForOwnerKey(key),
        variant: "caption",
        color: workbenchMuted,
      }))
      return
    }
    if (key.startsWith("source-control:")) {
      const controlKey = key.slice("source-control:".length)
      const control = this.#options.controls.find(({descriptor}) => descriptor.key === controlKey)
      if (control === undefined) return
      const next = nextStoryControlValue(control.descriptor, control.value)
      this.#drawInSectionsViewport(frame, () => Button(this, 0, 0, frame.w, frame.h, {
        children: `${control.descriptor.label}: ${formatStoryValue(control.value)}`,
        variant: "glass",
        color: "neutral",
        appearance: "tool",
        fontPx: uiShapeMetrics.compactFontPx,
        disabled: next === undefined,
        onClick: () => {
          const current = this.#options.controls.find(({descriptor}) => descriptor.key === controlKey)
          if (current === undefined) return
          const nextValue = nextStoryControlValue(current.descriptor, current.value)
          if (nextValue !== undefined) this.#options.onControlChange(controlKey, nextValue)
        },
      }))
      return
    }
    if (key.startsWith("source-event:")) {
      const id = key.slice("source-event:".length)
      const event = this.#options.events.find((candidate) => candidate.id === id)
      if (event !== undefined) this.#drawInSectionsViewport(frame, () => Typography(this, 0, 0, frame.w, frame.h, {
        children: `${event.label}: ${event.value}`,
        variant: "caption",
        color: workbenchMuted,
      }))
    }
  }
}

/** Shared compact preview panel/header chrome; the selected story remains consumer-owned. */
export function drawStorybookPreviewChrome(
  surface: UiSurface,
  width: number,
  height: number,
  options: StorybookPreviewChromeOptions = {},
): void {
  Pane(surface, 0, 0, width, height, {
    appearance: "panel",
    style: {
      padding: 0,
    },
  })
  const {title, description} = options
  if (title === undefined && description === undefined) return
  const {contentInset, chromeHeight} = storybookPreviewChromeMetrics(options)
  flexColumn({
    x: contentInset,
    y: uiShapeMetrics.tightGap,
    w: Math.max(0, width - contentInset * 2),
    h: chromeHeight,
    gap: uiShapeMetrics.panelSectionGap,
    items: [
      title === undefined ? false : {
        height: uiShapeMetrics.panelHeaderHeight,
        draw: (x, y, w, h) => Typography(surface, x, y, w, h, {
          children: title,
          variant: "title",
          fontPx: uiShapeMetrics.compactFontPx,
          color: workbenchText,
        }),
      },
      description === undefined ? false : {
        height: uiShapeMetrics.rowHeight,
        draw: (x, y, w, h) => Typography(surface, x, y, w, h, {
          children: description,
          variant: "caption",
          color: workbenchMuted,
          fontPx: uiShapeMetrics.compactFontPx,
        }),
      },
    ],
  })
}

/** Content rect below the optional shared preview title and description. */
export function planStorybookPreviewContent(
  width: number,
  height: number,
  options: StorybookPreviewChromeOptions = {},
): UiSurfaceRect {
  const {contentInset, chromeHeight, rowCount} = storybookPreviewChromeMetrics(options)
  const y = rowCount === 0
    ? contentInset
    : uiShapeMetrics.tightGap + chromeHeight + uiShapeMetrics.panelSectionGap
  return {
    x: contentInset,
    y,
    w: Math.max(0, width - contentInset * 2),
    h: Math.max(0, height - y - contentInset),
  }
}

function storybookPreviewChromeMetrics(options: StorybookPreviewChromeOptions): Readonly<{
  contentInset: number
  chromeHeight: number
  rowCount: number
}> {
  const rowHeights = [
    ...(options.title === undefined ? [] : [uiShapeMetrics.panelHeaderHeight]),
    ...(options.description === undefined ? [] : [uiShapeMetrics.rowHeight]),
  ]
  return {
    contentInset: uiShapeMetrics.tightGap * 2,
    chromeHeight: rowHeights.reduce((sum, value) => sum + value, 0) +
      uiShapeMetrics.panelSectionGap * Math.max(0, rowHeights.length - 1),
    rowCount: rowHeights.length,
  }
}

export class StorybookBackdropSurface extends UiSurface {
  constructor() {
    super({bgColor: null, borderColor: null})
    this.node.name = "StorybookBackdropSurface"
  }

  protected override render(): void {
    this.drawRect(
      0,
      0,
      this.rectW,
      this.rectH,
      rgba8ToColor(STORYBOOK_SHELL_BACKGROUND_RGBA),
      -0.18,
    )
  }
}

/** Shared passive Workbench footer rendered by the exact Elements StatusBar owner. */
export class StorybookStatusBarSurface extends UiSurface {
  readonly #items: readonly StatusBarItem[]

  constructor(options: StorybookStatusBarOptions = readInjectedStorybookStatusBar()) {
    super({bgColor: null, borderColor: null})
    this.node.name = "StorybookStatusBarSurface"
    this.#items = storybookStatusBarItems(options)
  }

  protected override render(): void {
    statusBar(this, 0, 0, this.rectW, this.rectH, {
      start: this.#items,
      separator: "",
    })
  }
}

/** Maps one owner manifest descriptor to stable StatusBar items without copying the primitive. */
export function storybookStatusBarItems(options: StorybookStatusBarOptions): readonly StatusBarItem[] {
  const lead = requiredStatusBarText(options.lead, "lead")
  const owner = requiredStatusBarText(options.owner, "owner")
  const detail = requiredStatusBarText(options.detail, "detail")
  return Object.freeze([
    Object.freeze({id: "lead", text: `${lead} `}),
    Object.freeze({id: "owner", text: owner, highlighted: true}),
    Object.freeze({id: "detail", text: ` · ${detail}`}),
  ])
}

function requiredStatusBarText(value: string, field: keyof StorybookStatusBarOptions): string {
  const normalized = value.trim()
  if (normalized.length === 0) throw new Error(`Storybook status bar ${field} must not be empty`)
  return normalized
}

function normalizeNavigationOptions<Route extends string>(
  options: StorybookNavigationOptions<Route>,
): NormalizedNavigationOptions<Route> {
  const ids = new Set<string>()
  const groups = new Map<string, Readonly<{label: string; collapsed: boolean}>>()
  const items = options.items.map((item) => {
    if (item.id.length === 0) throw new Error("Storybook navigation item id must not be empty")
    if (ids.has(item.id)) throw new Error(`Duplicate storybook navigation item id: ${item.id}`)
    ids.add(item.id)
    let group: NormalizedNavigationGroup | undefined
    if (item.group !== undefined) {
      if (item.group.id.length === 0) throw new Error("Storybook navigation group id must not be empty")
      if (item.group.label.trim().length === 0) throw new Error("Storybook navigation group label must not be empty")
      const collapsed = item.group.collapsed === true
      const previous = groups.get(item.group.id)
      if (previous !== undefined && previous.label !== item.group.label) {
        throw new Error(`Storybook navigation group label changed for id: ${item.group.id}`)
      }
      if (previous !== undefined && previous.collapsed !== collapsed) {
        throw new Error(`Storybook navigation group collapsed state changed within id: ${item.group.id}`)
      }
      groups.set(item.group.id, Object.freeze({label: item.group.label, collapsed}))
      group = Object.freeze({id: item.group.id, label: item.group.label, collapsed})
    }
    return Object.freeze({
      id: item.id,
      label: item.label,
      route: item.route,
      disabled: item.disabled === true,
      group,
      searchText: item.searchText?.trim() ?? "",
    })
  })
  let window: StorybookNavigationWindow | undefined
  if (options.window !== undefined) {
    if (!Number.isInteger(options.window.offset) || options.window.offset < 0) {
      throw new Error("Storybook navigation window offset must be a non-negative integer")
    }
    if (!Number.isInteger(options.window.limit) || options.window.limit < 1) {
      throw new Error("Storybook navigation window limit must be a positive integer")
    }
    window = Object.freeze({offset: options.window.offset, limit: options.window.limit})
  }
  return Object.freeze({
    title: options.title,
    items: Object.freeze(items),
    route: options.route,
    onNavigate: options.onNavigate,
    query: normalizeNavigationSearch(options.query ?? ""),
    window,
    searchPlaceholder: options.searchPlaceholder,
    onQueryChange: options.onQueryChange,
    onGroupToggle: options.onGroupToggle,
  })
}

/** Pure filtered and bounded navigation view used by large package catalogs. */
export function selectStorybookNavigationItems<Route extends string>(
  options: StorybookNavigationOptions<Route>,
): StorybookNavigationView<Route> {
  const view = selectNormalizedNavigationItems(normalizeNavigationOptions(options))
  const items: StorybookNavigationItem<Route>[] = view.items.map((item) => Object.freeze({
    id: item.id,
    label: item.label,
    route: item.route,
    ...(item.disabled ? {disabled: true} : {}),
    ...(item.group === undefined ? {} : {group: Object.freeze({
      id: item.group.id,
      label: item.group.label,
      ...(item.group.collapsed ? {collapsed: true} : {}),
    })}),
    ...(item.searchText.length === 0 ? {} : {searchText: item.searchText}),
  }))
  return Object.freeze({total: view.total, offset: view.offset, items: Object.freeze(items)})
}

function normalizeStoryPanelOptions(options: StorybookStoryPanelOptions): NormalizedStoryPanelOptions {
  if (!isStoryPanelCategory(options.category)) {
    throw new Error(`Unknown Storybook story panel category: ${options.category}`)
  }
  for (const kind of STORY_SOURCE_KINDS) {
    if (options.source[kind].trim().length === 0) {
      throw new Error(`Storybook story panel source ${kind} must not be empty`)
    }
  }
  const controlKeys = new Set<string>()
  const controls = options.controls.map((descriptor): NormalizedStoryControl => {
    if (controlKeys.has(descriptor.key)) throw new Error(`Duplicate storybook story panel control: ${descriptor.key}`)
    controlKeys.add(descriptor.key)
    if (!(descriptor.key in options.args)) throw new Error(`Storybook story panel args missing control: ${descriptor.key}`)
    return Object.freeze({descriptor, value: options.args[descriptor.key]})
  })
  const eventIds = new Set<string>()
  const events = (options.events ?? []).map((event) => {
    if (event.id.length === 0) throw new Error("Storybook story event id must not be empty")
    if (eventIds.has(event.id)) throw new Error(`Duplicate storybook story event: ${event.id}`)
    eventIds.add(event.id)
    return Object.freeze({...event})
  })
  return Object.freeze({
    source: Object.freeze({...options.source}),
    controls: Object.freeze(controls),
    events: Object.freeze(events),
    contextLabel: options.contextLabel?.trim() || undefined,
    category: options.category,
    onCategoryChange: options.onCategoryChange,
    onControlChange: options.onControlChange,
    onCopy: options.onCopy,
    onSourceScrollChange: options.onSourceScrollChange,
    onSourceSelectionChange: options.onSourceSelectionChange,
  })
}

function normalizeInfoOptions(options: StorybookInfoOptions): NormalizedInfoOptions {
  const explicitIds = new Set<string>()
  const stringOccurrences = new Map<string, number>()
  const lines = options.lines.map((line): NormalizedInfoLine => {
    if (typeof line !== "string") {
      if (line.id.length === 0) throw new Error("Storybook info line id must not be empty")
      if (explicitIds.has(line.id)) throw new Error(`Duplicate storybook info line id: ${line.id}`)
      explicitIds.add(line.id)
      return {key: `line:id:${line.id}`, label: line.label}
    }
    const occurrence = stringOccurrences.get(line) ?? 0
    stringOccurrences.set(line, occurrence + 1)
    return {key: `line:text:${line}:${occurrence}`, label: line}
  })
  return {title: options.title, lines, status: options.status}
}

function itemOwnerKey(id: string): string {
  return `item:${id}`
}

function storySourceBoxOwnerKey(kind: StorybookStorySourceKind): string {
  return `source-box:${kind}`
}

function storySourceScrollKey(kind: StorybookStorySourceKind): string {
  return `story-source-scroll:${kind}`
}

function storySourceKindFromOwnerKey(
  key: string,
  prefix: "source-box:",
): StorybookStorySourceKind | undefined {
  if (!key.startsWith(prefix)) return undefined
  const kind = key.slice(prefix.length)
  return STORY_SOURCE_KINDS.find((candidate) => candidate === kind)
}

function isStorySourceKind(value: string): value is StorybookStorySourceKind {
  return STORY_SOURCE_KINDS.some((kind) => kind === value)
}

function isStoryPanelCategory(value: string): value is StorybookStoryPanelCategory {
  return value === "source" || value === "controls" || value === "events"
}

function intersectSurfaceRects(left: UiSurfaceRect, right: UiSurfaceRect): UiSurfaceRect | null {
  const x = Math.max(left.x, right.x)
  const y = Math.max(left.y, right.y)
  const rightEdge = Math.min(left.x + left.w, right.x + right.w)
  const bottomEdge = Math.min(left.y + left.h, right.y + right.h)
  if (rightEdge <= x || bottomEdge <= y) return null
  return {x, y, w: rightEdge - x, h: bottomEdge - y}
}

function storySourceTitle(kind: StorybookStorySourceKind): string {
  if (kind === "html") return "HTML"
  if (kind === "css") return "CSS"
  return "TypeScript"
}

function storyControlOwnerKey(key: string): string {
  return `source-control:${key}`
}

function storyControlGroupOwnerKey(group: string): string {
  return `source-control-group:${group}`
}

function controlGroupForOwnerKey(key: string): string {
  return key.slice("source-control-group:".length)
}

function storyEventOwnerKey(id: string): string {
  return `source-event:${id}`
}

function groupOwnerKey(id: string): string {
  return `group:${id}`
}

function itemIdForOwnerKey(key: string): string {
  return key.slice("item:".length)
}

function sameIds<Route extends string>(
  left: readonly NormalizedNavigationItem<Route>[],
  right: readonly NormalizedNavigationItem<Route>[],
): boolean {
  return sameStrings(left.map(({id}) => id), right.map(({id}) => id))
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function navigationHierarchyRows<Route extends string>(
  options: NormalizedNavigationOptions<Route>,
): readonly NavigationRow<Route>[] {
  const selected = selectNormalizedNavigationItems(options).items
  const ordered: Array<NavigationSectionRow<Route> | NavigationLeafRow<Route>> = []
  const sections = new Map<string, {row: NavigationSectionRow<Route>; leaves: NormalizedNavigationItem<Route>[]}>()

  for (const item of selected) {
    if (item.group === undefined) {
      ordered.push(Object.freeze({
        kind: "leaf",
        id: item.id,
        ownerKey: itemOwnerKey(item.id),
        item,
        parentId: null,
      }))
      continue
    }
    let section = sections.get(item.group.id)
    if (section === undefined) {
      const leaves: NormalizedNavigationItem<Route>[] = []
      const row: NavigationSectionRow<Route> = {
        kind: "section",
        id: item.group.id,
        ownerKey: groupOwnerKey(item.group.id),
        group: item.group,
        leaves,
      }
      section = {row, leaves}
      sections.set(item.group.id, section)
      ordered.push(row)
    }
    section.leaves.push(item)
  }

  const rows: NavigationRow<Route>[] = []
  for (const row of ordered) {
    if (row.kind === "leaf") {
      rows.push(row)
      continue
    }
    rows.push(Object.freeze({...row, leaves: Object.freeze([...row.leaves])}))
    if (row.group.collapsed) continue
    for (const item of row.leaves) {
      rows.push(Object.freeze({
        kind: "leaf",
        id: item.id,
        ownerKey: itemOwnerKey(item.id),
        item,
        parentId: row.id,
      }))
    }
  }
  return Object.freeze(rows)
}

function preferredNavigationRowFocus<Route extends string>(
  rows: readonly NavigationRow<Route>[],
  route: Route,
  currentOwnerKey: string | null,
  canToggleSection: boolean,
): string | null {
  const enabled = rows.filter((row) => navigationRowEnabled(row, canToggleSection))
  if (currentOwnerKey !== null && enabled.some(({ownerKey}) => ownerKey === currentOwnerKey)) return currentOwnerKey
  return enabled.find((row) => row.kind === "leaf" && row.item.route === route)?.ownerKey ??
    enabled[0]?.ownerKey ?? null
}

function navigationRowEnabled<Route extends string>(
  row: NavigationRow<Route>,
  canToggleSection: boolean,
): boolean {
  return row.kind === "section" ? canToggleSection : !row.item.disabled
}

function navigationRowId<Route extends string>(row: NavigationRow<Route> | undefined): string | null {
  return row?.id ?? null
}

function selectNormalizedNavigationItems<Route extends string>(
  options: NormalizedNavigationOptions<Route>,
): Readonly<{total: number; offset: number; items: readonly NormalizedNavigationItem<Route>[]}> {
  const filtered = options.query.length === 0
    ? options.items
    : options.items.filter((item) => normalizeNavigationSearch([
      item.label,
      item.searchText,
      item.group?.label ?? "",
    ].join(" ")).includes(options.query))
  const offset = Math.min(options.window?.offset ?? 0, filtered.length)
  const limit = options.window?.limit ?? filtered.length
  return Object.freeze({total: filtered.length, offset, items: Object.freeze(filtered.slice(offset, offset + limit))})
}

function navigationOwnerKeys<Route extends string>(
  options: NormalizedNavigationOptions<Route>,
  dock: boolean,
): string[] {
  const keys: string[] = dock ? [] : [TITLE_OWNER]
  if (!dock && options.onQueryChange !== undefined) keys.push(SEARCH_OWNER)
  if (dock) {
    for (const item of selectNormalizedNavigationItems(options).items) keys.push(itemOwnerKey(item.id))
  } else if (options.onGroupToggle === undefined) {
    for (const item of selectNormalizedNavigationItems(options).items) keys.push(itemOwnerKey(item.id))
  } else {
    for (const row of navigationHierarchyRows(options)) keys.push(row.ownerKey)
  }
  return keys
}

function navigationAccordionItems<Route extends string>(
  options: NormalizedNavigationOptions<Route>,
  frames: Map<string, UiSurfaceRect>,
): Array<{height: number; draw: (x: number, y: number, w: number, h: number) => void}> {
  if (options.onGroupToggle === undefined) {
    return selectNormalizedNavigationItems(options).items.map((item) => ({
      height: uiShapeMetrics.rowHeight,
      draw: (x, y, w, h) => { frames.set(itemOwnerKey(item.id), {x, y, w, h}) },
    }))
  }
  const hierarchy = navigationHierarchyRows(options)
  const topLevel = hierarchy.filter((row) => row.kind === "section" || row.parentId === null)
  const items: Array<{height: number; draw: (x: number, y: number, w: number, h: number) => void}> = []
  for (const row of topLevel) {
    if (row.kind === "leaf") {
      items.push({
        height: uiShapeMetrics.rowHeight,
        draw: (x, y, w, h) => { frames.set(row.ownerKey, {x, y, w, h}) },
      })
      continue
    }
    const leaves = hierarchy.filter((candidate) => candidate.kind === "leaf" && candidate.parentId === row.id)
    const height = uiShapeMetrics.rowHeight * (1 + leaves.length)
    items.push({
      height,
      draw: (x, y, w, h) => {
        frames.set(row.ownerKey, {x, y, w, h})
        flexColumn({
          x,
          y: y + uiShapeMetrics.rowHeight,
          w,
          h: Math.max(0, h - uiShapeMetrics.rowHeight),
          gap: 0,
          items: leaves.map((leaf) => ({
            height: uiShapeMetrics.rowHeight,
            draw: (leafX: number, leafY: number, leafW: number, leafH: number) => {
              frames.set(leaf.ownerKey, {x: leafX, y: leafY, w: leafW, h: leafH})
            },
          })),
        })
      },
    })
  }
  return items
}

function normalizeNavigationSearch(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU")
}

function sameNavigationWindow(left: StorybookNavigationWindow | undefined, right: StorybookNavigationWindow | undefined): boolean {
  return left?.offset === right?.offset && left?.limit === right?.limit
}

function sameNavigationGroup(left: StorybookNavigationGroup | undefined, right: StorybookNavigationGroup | undefined): boolean {
  return left?.id === right?.id && left?.label === right?.label
}

function navigationGroups<Route extends string>(
  options: NormalizedNavigationOptions<Route>,
): ReadonlyMap<string, NormalizedNavigationGroup> {
  const groups = new Map<string, NormalizedNavigationGroup>()
  for (const item of selectNormalizedNavigationItems(options).items) {
    if (item.group !== undefined && !groups.has(item.group.id)) groups.set(item.group.id, item.group)
  }
  return groups
}

function nextStoryControlValue(control: StorybookStoryControl, value: unknown): unknown {
  if (control.interactive !== true) return undefined
  if (control.kind === "boolean" && typeof value === "boolean") return !value
  if (control.kind === "select" && control.options.length > 0) {
    const currentIndex = control.options.findIndex((option) => option.value === value)
    return control.options[(currentIndex + 1 + control.options.length) % control.options.length]!.value
  }
  return undefined
}

function formatStoryValue(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value)
  if (value === null) return "null"
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function navigationDirection(key: string): "previous" | "next" | "home" | "end" | null {
  if (key === "ArrowUp" || key === "ArrowLeft") return "previous"
  if (key === "ArrowDown" || key === "ArrowRight") return "next"
  if (key === "Home") return "home"
  if (key === "End") return "end"
  return null
}

function isNavigationActivationKey(key: string): boolean {
  return key === "Enter" || key === " " || key === "Space" || key === "Spacebar"
}

function drawPanel(surface: UiSurface, width: number, height: number, active: boolean): void {
  Pane(surface, 0, 0, width, height, {
    appearance: "panel",
    active,
    style: {
      padding: 0,
      zIndex: -0.12,
    },
  })
}
