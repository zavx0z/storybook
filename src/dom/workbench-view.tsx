import {Button} from "@ui/components/button"
import {CodeEditor} from "@ui/components/code-editor"
import {Field, type FieldDefinition} from "@ui/components/field"
import {
  Inspector,
  InspectorSection,
  InspectorSections,
  type InspectorCategory,
} from "@ui/components/inspector"
import {TextField} from "@ui/components/text-field"
import {Typography} from "@ui/components/typography"
import type {Document, Event, HTMLElement} from "@zavx0z/dom"
import type {JsxSourceElement} from "@zavx0z/template/jsx-runtime"
import {
  StorybookNavigationTree,
} from "./navigation-tree-view.tsx"
import type {
  StorybookDomNavigationGroup,
  StorybookDomNavigationItem,
} from "./navigation-tree.ts"
import type {
  StorybookDomInspectorWidgetRegistration,
  StorybookDomScenarioItem,
  StorybookDomWorkbenchViewState,
} from "./workbench.ts"

export type StorybookWorkbenchViewProps = Readonly<{
  document: Document
  state: StorybookDomWorkbenchViewState
  inspectorSelectedId: string
  inspectorQuery: string
  onCatalogNavigate(item: StorybookDomNavigationItem, source: HTMLElement): void
  onCatalogSearch(value: string, source: HTMLElement): void
  onGroupToggle(group: StorybookDomNavigationGroup, collapsed: boolean, source: HTMLElement): void
  onSecondaryNavigate(item: StorybookDomNavigationItem, source: HTMLElement): void
  onScenario(item: StorybookDomScenarioItem, source: HTMLElement): void
  onInspectorCategoryChange(id: string): void
  onInspectorQueryChange(query: string): void
  children: readonly JsxSourceElement[]
}>

type NavigationListItemProps = Readonly<{
  item: StorybookDomNavigationItem
  selected: boolean
  onNavigate(item: StorybookDomNavigationItem, source: HTMLElement): void
}>

type ScenarioButtonProps = Readonly<{
  item: StorybookDomScenarioItem
  selected: boolean
  onScenario(item: StorybookDomScenarioItem, source: HTMLElement): void
}>

type WidgetSectionProps = Readonly<{
  widget: StorybookDomInspectorWidgetRegistration
  value: unknown
  expanded: boolean
  hidden: boolean
  onToggle(id: string, expanded: boolean): void
}>

type SourceDocument = Readonly<{
  key: string
  label: string
  languageId: "css" | "html" | "typescript"
  value: string
}>

type SourceDocumentProps = Readonly<{
  document: SourceDocument
}>

const regionPaneStyle: CssStyle = css`
  & {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    gap: 2px;
    padding: 4px;
    overflow: clip;
    border: var(--border-width-control) solid var(--widget-box-outline);
    border-radius: 6px;
    background: var(--widget-box-background);
    color: var(--widget-box-content);
  }
`

const headingStyle: CssStyle = css`
  & { display: block; min-height: 20px; padding: 2px 4px; }
`

const searchStyle: CssStyle = css`
  & { width: 100%; height: 24px; padding: 2px 6px; }
`

const navigationButtonStyle: CssStyle = css`
  & {
    width: 100%;
    min-width: 0;
    height: 24px;
    padding: 3px 6px;
    justify-content: flex-start;
    font-size: 11px;
  }
`

const scenarioButtonStyle: CssStyle = css`
  & { width: auto; min-width: 72px; height: 22px; padding: 2px 8px; font-size: 10px; }
`

const inspectorStyle: CssStyle = css`
  & { width: 100%; height: 100%; }
`

const inspectorSectionsStyle: CssStyle = css`
  & { min-height: 0; }
`

const editorStyle: CssStyle = css`
  & { width: 100%; height: 180px; min-height: 120px; }
`

function NavigationListItemView(props: NavigationListItemProps) {
  const onClick = (event: Event) => {
    if (!props.item.disabled) props.onNavigate(props.item, event.currentTarget as HTMLElement)
  }
  return <div
    role="listitem"
    aria-current={props.selected ? "page" : undefined}
    aria-disabled={String(props.item.disabled === true)}
    data-id={props.item.id}
    data-route={props.item.route}
    style={css`
      & { display: flex; width: 100%; min-height: 24px; }
      &[aria-disabled="true"] { opacity: 0.5; }
    `}
  >
    <Button
      label={props.item.label}
      title={props.item.title ?? props.item.label}
      aria-label={props.item.label}
      disabled={props.item.disabled === true}
      selected={props.selected}
      style={navigationButtonStyle}
      onClick={onClick}
    />
  </div>
}

function NavigationList(props: Readonly<{
  items: readonly StorybookDomNavigationItem[]
  activeId: string | null
  onNavigate(item: StorybookDomNavigationItem, source: HTMLElement): void
}>) {
  return <div role="list" style={css`
    & { display: flex; flex-direction: column; min-height: 0; flex-grow: 1; gap: 1px; overflow-y: auto; }
  `}>
    {props.items.map(item => <NavigationListItemView
      key={item.id}
      item={item}
      selected={item.id === props.activeId}
      onNavigate={props.onNavigate}
    />)}
  </div>
}

function ScenarioButton(props: ScenarioButtonProps) {
  const onClick = (event: Event) => {
    if (!props.item.disabled) props.onScenario(props.item, event.currentTarget as HTMLElement)
  }
  return <Button
    label={props.item.label}
    title={props.item.title ?? props.item.label}
    aria-label={props.item.label}
    disabled={props.item.disabled === true}
    selected={props.selected}
    style={scenarioButtonStyle}
    onClick={onClick}
  />
}

function SourceDocumentView(props: SourceDocumentProps) {
  return <section
    data-source-document={props.document.key}
    style={css`& { display: flex; flex-direction: column; width: 100%; gap: 2px; }`}
  >
    <Typography text={props.document.label} variant="caption" />
    <CodeEditor
      value={props.document.value}
      readOnly={true}
      languageId={props.document.languageId}
      title={props.document.label}
      style={editorStyle}
    />
  </section>
}

function SourceWidget(props: Readonly<{value: unknown}>) {
  const documents = sourceDocuments(props.value)
  return <div style={css`
    & { display: flex; flex-direction: column; width: 100%; min-height: 0; gap: 6px; }
  `}>
    {documents.map(document => <SourceDocumentView key={document.key} document={document} />)}
  </div>
}

function ValueFields(props: Readonly<{value: unknown}>) {
  const fields = fieldsFromValue(props.value)
  return <div style={css`
    & { display: flex; flex-direction: column; width: 100%; gap: 4px; }
  `}>
    {fields.map(definition => <Field key={definition.id} definition={definition} />)}
  </div>
}

function StandardWidgetSectionContent(props: WidgetSectionProps) {
  const source = props.widget.kind === "source"
  return <div data-widget-kind={props.widget.kind} style={css`
    & { display: flex; flex-direction: column; width: 100%; min-height: 0; }
  `}>
    {source ? <SourceWidget value={props.value} /> : null}
    {!source ? <ValueFields value={props.value} /> : null}
  </div>
}

export function StandardWidgetSection(props: WidgetSectionProps) {
  const onToggle = (id: string, expanded: boolean) => props.onToggle(id, expanded)
  return <InspectorSection
    id={props.widget.id}
    label={props.widget.title}
    title={props.widget.title}
    expanded={props.expanded}
    hidden={props.hidden}
    onToggle={onToggle}
  >
    <StandardWidgetSectionContent widget={props.widget} value={props.value} expanded={props.expanded} hidden={props.hidden} onToggle={props.onToggle} />
  </InspectorSection>
}

export function CustomWidgetSection(props: WidgetSectionProps & Readonly<{
  children: JsxSourceElement
}>) {
  const onToggle = (id: string, expanded: boolean) => props.onToggle(id, expanded)
  return <InspectorSection
    id={props.widget.id}
    label={props.widget.title}
    title={props.widget.title}
    expanded={props.expanded}
    hidden={props.hidden}
    onToggle={onToggle}
  >{props.children}</InspectorSection>
}

function WorkbenchInspector(props: Readonly<{
  registry: readonly StorybookDomInspectorWidgetRegistration[]
  subject: StorybookDomWorkbenchViewState["inspector.subject"]
  selectedId: string
  query: string
  onCategoryChange(id: string): void
  onQueryChange(query: string): void
  children: readonly JsxSourceElement[]
}>) {
  const registrations = props.subject === null
    ? Object.freeze([]) as readonly StorybookDomInspectorWidgetRegistration[]
    : Object.freeze(props.subject.widgetIds.map(id => props.registry.find(widget => widget.id === id)!))
  const categories: readonly InspectorCategory[] = Object.freeze(registrations.map(widget => Object.freeze({
    id: widget.id,
    label: widget.label,
    title: widget.title,
    sectionIds: Object.freeze([widget.id]),
  })))
  return <Inspector
    ariaLabel="Inspector"
    categoriesLabel="Widgets"
    categories={categories}
    selectedCategoryId={props.selectedId}
    query={props.query}
    searchLabel="Search Inspector"
    searchPlaceholder="Search…"
    context={props.subject === null ? undefined : {
      label: `${props.subject.packageId} · ${props.subject.subjectId}`,
      title: `${props.subject.packageId}/${props.subject.subjectId}`,
    }}
    style={inspectorStyle}
    onCategoryChange={props.onCategoryChange}
    onQueryChange={props.onQueryChange}
  >
    <InspectorSections style={inspectorSectionsStyle}>{props.children}</InspectorSections>
  </Inspector>
}

/** One compiled six-region shell and exactly one production Inspector. */
export function StorybookWorkbenchView(props: StorybookWorkbenchViewProps) {
  const state = props.state
  const onSearch = (value: string, event: Event) => {
    props.onCatalogSearch(value, event.currentTarget as HTMLElement)
  }
  const world = state.presentation.projection === "world"
  return <div
    role="application"
    aria-label={state.title}
    data-storybook-workbench=""
    data-storybook-world-preview={world ? "true" : undefined}
    style={css`
      & {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        overflow: clip;
        background: rgb(var(--surface-925));
        color: var(--widget-regular-content);
        font-size: 11px;
        line-height: 16px;
      }
      &[data-storybook-world-preview="true"] { background: transparent; }
    `}
  >
    <div
      data-storybook-workbench-part="body"
      data-world={world ? "true" : undefined}
      style={css`
        & {
          box-sizing: border-box;
          display: flex;
          flex-direction: row;
          min-height: 0;
          flex-grow: 1;
          gap: 4px;
          padding: 4px;
          overflow: clip;
          background: rgb(var(--surface-950));
        }
        &[data-world="true"] { background: transparent; }
      `}
    >
      <nav
        data-storybook-region="catalog"
        aria-label={state["catalog.label"]}
        style={css`& { display: flex; flex: 0 0 196px; width: 196px; min-height: 0; }`}
      >
        <div style={regionPaneStyle}>
          <div style={css`& { display: flex; flex-direction: column; width: 100%; min-height: 0; flex-grow: 1; gap: 2px; }`}>
            <Typography text={state["catalog.label"]} variant="caption" style={headingStyle} />
            <div data-storybook-part="catalog-search" style={css`& { display: block; width: 100%; }`}>
              <TextField
                type="search"
                value={state["catalog.search"]}
                placeholder="Поиск…"
                title="Поиск по каталогу"
                aria-label="Поиск по каталогу"
                style={searchStyle}
                onInput={onSearch}
              />
            </div>
            <div data-storybook-part="catalog-items" style={css`
              & { display: flex; flex-direction: column; min-height: 0; flex-grow: 1; }
            `}>
              <StorybookNavigationTree
                document={props.document}
                items={state["catalog.items"]}
                activeId={state["catalog.active"]}
                query={state["catalog.search"]}
                onNavigate={props.onCatalogNavigate}
                onGroupToggle={props.onGroupToggle}
              />
            </div>
          </div>
        </div>
      </nav>
      <nav
        data-storybook-region="secondary"
        aria-label={state["secondary.label"]}
        style={css`& { display: flex; flex: 0 0 152px; width: 152px; min-height: 0; }`}
      >
        <div style={regionPaneStyle}>
          <div style={css`& { display: flex; flex-direction: column; width: 100%; min-height: 0; flex-grow: 1; gap: 2px; }`}>
            <Typography text={state["secondary.label"]} variant="caption" style={headingStyle} />
            <div data-storybook-part="secondary-items" style={css`
              & { display: flex; flex-direction: column; min-height: 0; flex-grow: 1; }
            `}>
              <NavigationList
                items={state["secondary.items"]}
                activeId={state["secondary.active"]}
                onNavigate={props.onSecondaryNavigate}
              />
            </div>
          </div>
        </div>
      </nav>
      <div style={css`
        & { display: flex; flex-direction: column; min-width: 0; min-height: 0; flex-grow: 1; gap: 4px; }
      `}>
        <main
          data-storybook-region="preview"
          aria-label={state["preview.label"]}
          style={css`& { display: flex; min-width: 0; min-height: 0; flex-grow: 1; }`}
        >
          <div style={css`
            ${regionPaneStyle}
            & { background: ${world ? "transparent" : "var(--widget-box-background)"}; }
          `}>
            <div style={css`& { position: relative; display: flex; flex-direction: column; width: 100%; min-height: 0; flex-grow: 1; gap: 2px; }`}>
              <Typography text={state["preview.label"]} variant="caption" style={headingStyle} />
              <section
                role="region"
                aria-label={state["preview.label"]}
                aria-live="polite"
                data-storybook-part="preview-host"
                data-active-projection={state.presentation.projection}
                style={css`
                  & { position: relative; display: flex; flex-direction: column; min-height: 0; flex-grow: 1; align-items: center; justify-content: center; }
                `}
              >
                <div
                  data-storybook-projection="display"
                  hidden={state.presentation.projection !== "display"}
                  style={css`
                    & { display: flex; flex-direction: column; width: 100%; height: 100%; align-items: center; justify-content: center; }
                    &[hidden] { display: none; }
                  `}
                ></div>
                <div
                  data-storybook-projection="world"
                  aria-label="World semantic anchor"
                  hidden={state.presentation.projection !== "world"}
                  style={css`
                    & { display: flex; flex-direction: column; width: 100%; height: 100%; align-items: center; justify-content: center; background: transparent; }
                    &[hidden] { display: none; }
                  `}
                ></div>
                <div
                  data-storybook-projection="hud"
                  aria-label="HUD projection"
                  hidden={state.presentation.projection !== "hud"}
                  style={css`
                    & { position: absolute; left: 0; top: 0; display: flex; flex-direction: column; width: 100%; height: 100%; align-items: center; justify-content: center; }
                    &[hidden] { display: none; }
                  `}
                ></div>
              </section>
            </div>
          </div>
        </main>
        <section
          role="toolbar"
          data-storybook-region="scenarios"
          aria-label={state["scenarios.label"]}
          style={css`& { display: flex; width: 100%; height: 28px; min-height: 28px; }`}
        >
          <div style={css`
            & { display: flex; flex-direction: row; width: 100%; height: 28px; gap: 4px; padding: 2px 4px; overflow: clip; }
          `}>
            <div style={css`& { display: flex; flex-direction: row; width: 100%; min-width: 0; gap: 4px; }`}>
              <Typography text={state["scenarios.label"]} variant="caption" style={headingStyle} />
              <div data-storybook-part="scenario-items" style={css`
                & { display: flex; flex-direction: row; min-width: 0; flex-grow: 1; gap: 2px; }
              `}>
                {state["scenarios.items"].map(item => <ScenarioButton
                  key={item.id}
                  item={item}
                  selected={item.id === state["scenarios.active"]}
                  onScenario={props.onScenario}
                />)}
              </div>
            </div>
          </div>
        </section>
      </div>
      <div
        data-storybook-region="inspector"
        style={css`& { display: flex; flex: 0 0 400px; width: 400px; min-height: 0; overflow: clip; }`}
      >
        <WorkbenchInspector
          registry={state["inspector.registry"]}
          subject={state["inspector.subject"]}
          selectedId={props.inspectorSelectedId}
          query={props.inspectorQuery}
          onCategoryChange={props.onInspectorCategoryChange}
          onQueryChange={props.onInspectorQueryChange}
        >{props.children}</WorkbenchInspector>
      </div>
    </div>
    <footer
      role="status"
      aria-live="polite"
      aria-label={`${state.status.lead}${state.status.owner}${state.status.detail}`}
      data-storybook-region="status"
      style={css`
        & {
          box-sizing: border-box;
          display: flex;
          flex-direction: row;
          align-items: center;
          width: 100%;
          height: 24px;
          min-height: 24px;
          gap: 0;
          padding: 0 12px 0 8px;
          border-top: 2px solid var(--material-editor-border);
          background: rgb(var(--surface-950));
          overflow: clip;
        }
      `}
    >
      <Typography text={state.status.lead} variant="caption" />
      <Typography text={state.status.owner} variant="caption" title={state.status.owner} style={css`
        & { color: var(--widget-regular-content); }
      `} />
      <Typography text={state.status.detail} variant="caption" />
    </footer>
  </div>
}

function sourceDocuments(value: unknown): readonly SourceDocument[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze([
      Object.freeze({key: "html", label: "HTML", languageId: "html", value: ""}),
      Object.freeze({key: "typescript", label: "TypeScript", languageId: "typescript", value: ""}),
    ])
  }
  const source = value as Readonly<{
    html?: unknown
    css?: Readonly<{
      authorStyleSheets?: readonly Readonly<{specifier?: unknown; cssText?: unknown}>[]
      componentStyleSheets?: readonly Readonly<{moduleId?: unknown; componentName?: unknown; cssText?: unknown}>[]
    }>
    typescript?: unknown
  }>
  const documents: SourceDocument[] = [Object.freeze({
    key: "html",
    label: "HTML",
    languageId: "html",
    value: typeof source.html === "string" ? source.html : "",
  })]
  for (const [index, sheet] of (source.css?.authorStyleSheets ?? []).entries()) {
    documents.push(Object.freeze({
      key: `author:${index}`,
      label: typeof sheet.specifier === "string" ? sheet.specifier : `Author CSS ${index + 1}`,
      languageId: "css",
      value: typeof sheet.cssText === "string" ? sheet.cssText : "",
    }))
  }
  for (const [index, sheet] of (source.css?.componentStyleSheets ?? []).entries()) {
    const moduleId = typeof sheet.moduleId === "string" ? sheet.moduleId : `Component ${index + 1}`
    const componentName = typeof sheet.componentName === "string" ? sheet.componentName : "CSS"
    documents.push(Object.freeze({
      key: `component:${index}`,
      label: `${moduleId} · ${componentName}`,
      languageId: "css",
      value: typeof sheet.cssText === "string" ? sheet.cssText : "",
    }))
  }
  documents.push(Object.freeze({
    key: "typescript",
    label: "TypeScript",
    languageId: "typescript",
    value: typeof source.typescript === "string" ? source.typescript : "",
  }))
  return Object.freeze(documents)
}

function fieldsFromValue(value: unknown): readonly FieldDefinition[] {
  const entries = value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value)
    : [["value", value]] as const
  if (entries.length === 0) {
    return Object.freeze([Object.freeze({
      id: "widget-empty",
      label: "Value",
      kind: "readonly",
      value: "—",
      readOnly: true,
    })])
  }
  return Object.freeze(entries.map(([key, entry]) => fieldFromEntry(key, entry)))
}

function fieldFromEntry(key: string, value: unknown): FieldDefinition {
  const base = {id: `widget-${key}`, label: key, readOnly: true} as const
  if (typeof value === "boolean") {
    return Object.freeze({...base, kind: "boolean", value, presentation: "checkbox"})
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Object.freeze({...base, kind: Number.isInteger(value) ? "integer" : "number", value})
  }
  if (typeof value === "string") return Object.freeze({...base, kind: "text", value})
  return Object.freeze({...base, kind: "readonly", value: printable(value)})
}

function printable(value: unknown): string {
  if (value === undefined) return "undefined"
  if (value === null) return "null"
  if (typeof value === "bigint") return `${value}n`
  if (typeof value === "function") return `ƒ ${value.name || "anonymous"}`
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}
