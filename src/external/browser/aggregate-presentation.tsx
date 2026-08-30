import {Pane} from "@ui/components/pane"
import {Typography} from "@ui/components/typography"
import type {Document, Node} from "@zavx0z/dom"
import type {
  StorybookRuntimePresentationInput,
} from "../runtime-protocol.ts"
import type {StorybookRuntimeStyleSheetRoot} from "./source-projection.ts"
import {
  createStorybookComponentPresentation,
  type StorybookComponentPresentation,
} from "./component-presentation.ts"

export type StorybookAggregatePresentationItem = Readonly<{
  id: string
  label: string
  route: string
  presentation: StorybookRuntimePresentationInput
}>

export type StorybookAggregatePresentation = Readonly<{
  element: StorybookComponentPresentation["element"]
  componentRoot: StorybookRuntimeStyleSheetRoot
  source: Readonly<{html: string; typescript: string}>
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
}>

function StorybookAggregateTileContent(props: Readonly<{
  item: StorybookAggregateOverviewViewItem
}>) {
  const item = props.item
  return <div style={css`
      & {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 120px;
        flex-grow: 1;
        gap: 4px;
      }
    `}>
    <Typography text={item.label} variant="caption" />
    <div
      data-storybook-aggregate-item={item.id}
      data-storybook-aggregate-route={item.route}
      style={css`
        & {
          display: flex;
          min-width: 0;
          min-height: 120px;
          flex-grow: 1;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }
      `}
    ></div>
  </div>
}

/** One same-Document aggregate of real owner story roots. */
export function StorybookAggregateOverviewView(props: StorybookAggregateOverviewViewProps) {
  return <section
    data-storybook-aggregate-overview=""
    aria-label={`Обзор компонентов: ${props.title}`}
    style={css`
      & {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-height: 0;
        gap: 4px;
        overflow: hidden;
      }
    `}
  >
    <Typography text={props.title} variant="title" />
    <div
      data-storybook-aggregate-grid=""
      style={css`
        & {
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
        }
      `}
    >
      {props.items.map(item => <Pane
        key={item.id}
        variant="outlined"
        title={item.label}
        style={css`
          & {
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
          }
          ${props.items.length === 1 && css`
            & {
              flex-basis: 100%;
              width: 100%;
              height: 100%;
              min-width: 0;
              max-height: none;
            }
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
  for (const item of items) {
    const hosts = [...view.element.querySelectorAll(
      `[data-storybook-aggregate-item="${cssAttributeValue(item.id)}"]`,
    )]
    if (hosts.length !== 1) {
      view.dispose()
      throw new Error(`Storybook aggregate requires one child host: ${item.id}`)
    }
    hosts[0]!.appendChild(item.presentation.node as Node)
  }
  const roots = Object.freeze([
    view.componentRoot as StorybookRuntimeStyleSheetRoot,
    ...items.map(({presentation}) => presentation.componentRoot),
  ])
  return Object.freeze({
    element: view.element,
    componentRoot: compositeStyleSheetRoot(roots),
    source: aggregateSource(title, items),
    dispose: () => view.dispose(),
  })
}

function compositeStyleSheetRoot(
  roots: readonly StorybookRuntimeStyleSheetRoot[],
): StorybookRuntimeStyleSheetRoot {
  return Object.freeze({
    readStyleSheets() {
      let revision = 0
      const styleSheets: unknown[] = []
      for (const [index, root] of roots.entries()) {
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
  items: readonly StorybookAggregatePresentationItem[],
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
