import {Pane} from "@zavx0z/ui/surfaces/pane"
import {Typography} from "@zavx0z/ui/typography"
import type {Document, Element} from "@zavx0z/dom"
import type {RenderFrame} from "@zavx0z/renderer"
import type {
  StorybookRuntimePresentationInput,
} from "./runtime-protocol.ts"
import type {StorybookRuntimeStyleSheetRoot} from "./source-projection.ts"
import {
  createStorybookComponentPresentation,
  type StorybookComponentPresentation,
} from "./component-presentation.ts"

export type StorybookAggregatePresentationItem = Readonly<{
  id: string
  label: string
  route: string
}>

type PublishedStorybookAggregatePresentationItem = StorybookAggregatePresentationItem & Readonly<{
  presentation: StorybookRuntimePresentationInput
}>

export type StorybookAggregatePresentation = Readonly<{
  element: StorybookComponentPresentation["element"]
  componentRoot: StorybookRuntimeStyleSheetRoot
  source: Readonly<{html: string; typescript: string}>
  present(id: string, presentation: StorybookRuntimePresentationInput): () => void
  fitToFrame(frame: RenderFrame): boolean
  dispose(): void
}>

type StorybookAggregateOverviewViewProps = Readonly<{
  title: string
  items: readonly StorybookAggregateOverviewViewItem[]
}>

type StorybookAggregateOverviewViewItem = Readonly<{
  id: string
  label: string
  route: string
  fit?: Readonly<{scale: number; x: number; y: number}>
}>

function StorybookAggregateTileContent(props: Readonly<{
  item: StorybookAggregateOverviewViewItem
}>) {
  const item = props.item
  const fit = item.fit ?? {scale: 1, x: 0, y: 0}
  return <div style={css`
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 120px;
    flex-grow: 1;
    gap: 4px;
  `}>
    <Typography text={item.label} variant="caption" />
    <div
      data-storybook-aggregate-item={item.id}
      data-storybook-aggregate-route={item.route}
      style={css`
        display: flex;
        min-width: 0;
        min-height: 120px;
        flex-grow: 1;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      `}
    >
      <div
        data-storybook-aggregate-stage={item.id}
        style={css`
          box-sizing: border-box;
          display: block;
          width: 100%;
          height: 100%;
          min-width: 0;
          min-height: 0;
          flex-shrink: 0;

          --storybook-fit-scale: ${fit.scale};
          --storybook-fit-x: ${fit.x}px;
          --storybook-fit-y: ${fit.y}px;

          transform-origin: 0 0;
          transform: translate(var(--storybook-fit-x, 0px), var(--storybook-fit-y, 0px)) scale(var(--storybook-fit-scale, 1));
        `}
      ></div>
    </div>
  </div>
}

/** One same-Document aggregate of real owner story roots. */
export function StorybookAggregateOverviewView(props: StorybookAggregateOverviewViewProps) {
  return <section
    data-storybook-aggregate-overview=""
    aria-label={`Обзор компонентов: ${props.title}`}
    style={css`
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 0;
      gap: 4px;
      overflow: hidden;
    `}
  >
    <Typography text={props.title} variant="title" />
    <div
      data-storybook-aggregate-grid=""
      style={css`
        box-sizing: border-box;
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        align-content: flex-start;
        align-items: stretch;
        width: 100%;
        min-height: 0;
        flex-grow: 1;
        gap: 8px;
        overflow-y: auto;
        padding: 4px;
      `}
    >
      {props.items.map(item => <Pane
        key={item.id}
        variant="outlined"
        title={item.label}
        style={css`
          display: flex;
          flex: 0 0 280px;
          flex-direction: column;
          width: 280px;
          height: 180px;
          min-width: 0;
          min-height: 160px;
          max-width: 100%;
          max-height: 180px;
          gap: 4px;

          ${props.items.length === 1 && css`
            flex-basis: 100%;
            width: 100%;
            height: 100%;
            min-width: 0;
            max-height: none;
          `}
        `}
      >
        <StorybookAggregateTileContent item={item} />
      </Pane>)}
    </div>
  </section>
}

export function createStorybookAggregatePresentation(
  document: Document,
  title: string,
  items: readonly StorybookAggregatePresentationItem[],
): StorybookAggregatePresentation {
  if (items.length === 0) throw new Error(`Storybook aggregate has no children: ${title}`)
  const view = createStorybookComponentPresentation(
    document,
    StorybookAggregateOverviewView as any,
    Object.freeze({
      title,
      items: Object.freeze(items.map(({id, label, route}) => Object.freeze({
        id,
        label,
        route,
      }))),
    }),
    "[data-storybook-aggregate-overview]",
  )
  const hostsById = new Map<string, Element>()
  const stagesById = new Map<string, Element>()
  for (const item of items) {
    const hosts = [...view.element.querySelectorAll(
      `[data-storybook-aggregate-item="${cssAttributeValue(item.id)}"]`,
    )]
    if (hosts.length !== 1 || hostsById.has(item.id)) {
      view.dispose()
      throw new Error(`Storybook aggregate requires one child host: ${item.id}`)
    }
    hostsById.set(item.id, hosts[0]!)
    const stage = hosts[0]!.querySelector("[data-storybook-aggregate-stage]")
    if (stage === null) {
      view.dispose()
      throw new Error(`Storybook aggregate requires one fit stage: ${item.id}`)
    }
    stagesById.set(item.id, stage)
  }
  const published = new Map<string, StorybookRuntimePresentationInput>()
  const fits = new Map<string, Readonly<{signature: string; scale: number; x: number; y: number}>>()
  const publishedItems = (): readonly PublishedStorybookAggregatePresentationItem[] =>
    items.flatMap(item => {
      const presentation = published.get(item.id)
      return presentation === undefined ? [] : [Object.freeze({...item, presentation})]
    })
  let disposed = false
  return Object.freeze({
    element: view.element,
    componentRoot: compositeStyleSheetRoot(() => [
      view.componentRoot as StorybookRuntimeStyleSheetRoot,
      ...publishedItems().map(({presentation}) => presentation.componentRoot),
    ]),
    get source() {
      return aggregateSource(title, publishedItems())
    },
    present(id, presentation) {
      if (disposed) throw new Error("Storybook aggregate presentation is disposed")
      const host = hostsById.get(id)
      if (host === undefined) throw new Error(`Storybook aggregate has no child host: ${id}`)
      if (!host.isConnected) throw new Error(`Storybook aggregate child host is detached: ${id}`)
      if (presentation.node.ownerDocument !== document) {
        throw new Error(`Storybook aggregate child belongs to a different Document: ${id}`)
      }
      if (published.has(id) || [...published.values()].some(value => value.node === presentation.node)) {
        throw new Error(`Storybook aggregate child is already published: ${id}`)
      }
      const stage = stagesById.get(id)!
      stage.appendChild(presentation.node)
      published.set(id, presentation)
      return () => {
        if (published.get(id) !== presentation) return
        published.delete(id)
        fits.delete(id)
        if (presentation.node.parentNode === stage) stage.removeChild(presentation.node)
      }
    },
    fitToFrame(frame) {
      if (disposed) return false
      let changed = false
      for (const [id, presentation] of published) {
        const host = hostsById.get(id)!
        const stage = stagesById.get(id)!
        const viewport = frame.boxByNode.get(host)
        const stageBox = frame.boxByNode.get(stage)
        const owner = frame.boxByNode.get(presentation.node)
        if (viewport === undefined || stageBox === undefined || owner === undefined ||
          viewport.contentWidth <= 0 || viewport.contentHeight <= 0 ||
          stageBox.transform.scaleX === 0 || stageBox.transform.scaleY === 0) continue
        // Remove the stage's previous fit and ancestor transforms, retaining
        // the owner's own transform and authored production dimensions.
        const left = (owner.x * owner.transform.scaleX + owner.transform.translateX -
          stageBox.transform.translateX) / stageBox.transform.scaleX - stageBox.x
        const top = (owner.y * owner.transform.scaleY + owner.transform.translateY -
          stageBox.transform.translateY) / stageBox.transform.scaleY - stageBox.y
        const width = owner.width * owner.transform.scaleX / stageBox.transform.scaleX
        const height = owner.height * owner.transform.scaleY / stageBox.transform.scaleY
        if (![left, top, width, height].every(Number.isFinite) || width === 0 || height === 0) continue
        const scale = Math.min(1, viewport.contentWidth / Math.abs(width), viewport.contentHeight / Math.abs(height))
        const x = viewport.contentX - stageBox.x +
          (viewport.contentWidth - Math.abs(width) * scale) / 2 - Math.min(left, left + width) * scale
        const y = viewport.contentY - stageBox.y +
          (viewport.contentHeight - Math.abs(height) * scale) / 2 - Math.min(top, top + height) * scale
        const values = [scale, x, y].map(value => String(Number(value.toFixed(8))))
        const signature = values.join(":")
        if (fits.get(id)?.signature === signature) continue
        fits.set(id, {signature, scale: Number(values[0]), x: Number(values[1]), y: Number(values[2])})
        changed = true
      }
      if (changed) {
        view.componentRoot.render(StorybookAggregateOverviewView as any, {
          title,
          items: items.map(item => ({...item, fit: fits.get(item.id)})),
        })
      }
      return changed
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const [id, presentation] of published) {
        const stage = stagesById.get(id)!
        if (presentation.node.parentNode === stage) stage.removeChild(presentation.node)
      }
      published.clear()
      fits.clear()
      view.dispose()
    },
  })
}

function compositeStyleSheetRoot(
  readRoots: () => readonly StorybookRuntimeStyleSheetRoot[],
): StorybookRuntimeStyleSheetRoot {
  return Object.freeze({
    readStyleSheets() {
      let revision = 0
      const styleSheets: unknown[] = []
      for (const [index, root] of readRoots().entries()) {
        const snapshot = root.readStyleSheets() as Readonly<{
          revision?: unknown
          styleSheets?: unknown
        }>
        if (!Number.isSafeInteger(snapshot.revision) || (snapshot.revision as number) < 0 ||
          !Array.isArray(snapshot.styleSheets)) {
          throw new TypeError(`Storybook aggregate component root ${index} returned an invalid snapshot`)
        }
        revision = (revision + (snapshot.revision as number)) % Number.MAX_SAFE_INTEGER
        styleSheets.push(...snapshot.styleSheets)
      }
      return Object.freeze({revision, styleSheets: Object.freeze(styleSheets)})
    },
  })
}

function aggregateSource(
  title: string,
  items: readonly PublishedStorybookAggregatePresentationItem[],
): Readonly<{html: string; typescript: string}> {
  const html = [
    `<section data-storybook-aggregate-overview="" aria-label="${escapeHtml(`Обзор компонентов: ${title}`)}">`,
    `  <h2>${escapeHtml(title)}</h2>`,
    ...items.flatMap(({label, route, presentation}) => [
      `  <article data-storybook-aggregate-route="${escapeHtml(route)}">`,
      `    <h3>${escapeHtml(label)}</h3>`,
      indent(presentation.source.html, 4),
      "  </article>",
    ]),
    "</section>",
  ].join("\n")
  const typescript = items.map(({label, route, presentation}) => [
    `// ${label} · ${route}`,
    presentation.source.typescript,
  ].join("\n")).join("\n\n")
  return Object.freeze({html, typescript})
}

function indent(value: string, depth: number): string {
  const prefix = "  ".repeat(depth)
  return value.split("\n").map(line => `${prefix}${line}`).join("\n")
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function cssAttributeValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
}
