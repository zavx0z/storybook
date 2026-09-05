import type {HTMLElement} from "@zavx0z/dom"
import {createRoot} from "@zavx0z/component"
import {
  ContractDocument,
  type ContractDocumentProps,
} from "./contract-document.tsx"
import {
  defineSelfStory,
  serializeSelfElement,
} from "./story-types.ts"

type Contract = ContractDocumentProps

const contracts = Object.freeze({
  routeTree: contract(
    "Canonical graph and routes",
    "Versioned standalone package, project and optional workspace declarations resolve atomically into one immutable graph. Package, category and subject overviews remain real states; unknown routes fail closed. Category and subject overviews render real immediate child stories without selecting their representative routes. A single-child overview retains that representative subject's Inspector contract and values.",
    "Owners provide ordered JSON. External Storybook derives landing, navigation, search, URLs, build lookup and the current MCP viewport from the same identities; a failed attach leaves the current registry unchanged. One compiled aggregate contains separate runtime/4 child sessions in the same Document and owns a CSS row with flex-wrap, align-content: flex-start and gap: 8px; Renderer packs bounded tiles into compact cross-start rows, one child fills preview, and vertical overflow is only a small-height fallback. Single-child Inspector inheritance does not change navigation selection; multi-child aggregates choose no arbitrary Inspector owner. Storybook never computes packing coordinates.",
    "storybook check ./packages/components",
  ),
  stories: contract(
    "Owner story modules",
    "A catalog stores one static module path and export name for each executable variant. Story modules import production owners, never Storybook.",
    "The external PackageSession validates exports and emits literal lazy imports before browser delivery.",
    "export const contained = createContainedButtonStory()",
  ),
  catalog: contract(
    "JSON catalog",
    "The catalog model is category → subject → variant with optional presentation groups and explicit migration routes. README uses @zavx0z/ui/views/markdown and the shared @zavx0z/ui/markdown parser (markdown-it CommonMark plus inert parse5 HTML projection). Resource discovery uses that same parser, including code-labelled links and admitted HTML images. Code blocks reuse CodeEditor.",
    "The package owns semantic order, typed category identity and resources. Storybook owns the surrounding viewport and optional overview action. Markdown wrap defaults to true; fenced code retains its scrolling. Browser loads declared Engine-owned Inter and JetBrains Mono faces, and Renderer/WebGPU share face selection and exact metrics. Image dimensions and GIF animation reuse the WebGPU texture loader. GIF decoding pauses when all image consumers leave their viewport/clips and resumes from the saved frame position. GIF playback requires browser ImageDecoder support; otherwise a static frame remains with a diagnostic. Script, executable URLs and HTML event attributes are not materialized. List markers and table layout retain platform limitations.",
    ".storybook/catalog.json",
  ),
  workbench: contract(
    "Workbench из шести областей",
    "`catalog`, `secondary`, `scenarios`, `preview`, `inspector` и `status` являются шестью compiled TSX components одного `workbench-layout/2`. Весь Workbench монтируется в exact `XRHUDElement` `external-storybook-workbench`. Status композирует production Breadcrumbs с полным путём `workspace → project → package → category → subject → variant`; scenario toolbar расположен непосредственно над preview.",
    "Страница владеет одним `@zavx0z/browser` Experience: Browser владеет Document, Canvas, циклом кадров и вводом, а Experience содержит exact `@zavx0z/space` `XRSpaceElement` и `XRViewPointElement`. Workbench использует `@zavx0z/ui/widgets/inspector`, `@zavx0z/ui/navigation/breadcrumbs` и exact `@zavx0z/ui/feedback/status-bar`. Переход по Breadcrumbs к предку сохраняет тот же package target. Display story монтируется в actual `XRDisplayElement`, HUD story — в `XRHUDElement`, а трёхмерная story — непосредственно в `XRSpaceElement`. " +
    "Центральная область HUD задаёт только layout bounds. Её отдельная рамка Preview отсутствует: border, border-radius и overflow принадлежат самому xr-display. Shell переводит границы центральной области из CSS pixels в положение и масштаб Display через текущую камеру; viewport Display изменяется вместе с областью. README и story остаются прямым содержимым Display без декоративной обёртки.",
    "createExperience(...) → experience.getProjection(workbenchHud) → external-storybook-workbench",
  ),
  authorStyles: contract(
    "Связанные стили автора и исходный текст root",
    "Пакет объявляет упорядоченные exact public CSS exports собственного владельца или достижимой через manifest локальной зависимости. Каждая immutable revision создаёт одну native link на ресурс до загрузки module entry; все обязательные links должны быть ready до `createExperience(...)`.",
    "Global Source CSS берётся из объявленного author registry. Component Source CSS берётся только из authored provenance одного active ComponentRoot и показывается как исходный CSS с подсветкой. Dynamic declarations остаются inline в HTML. Cleanup освобождает Experience раньше связанных ресурсов; Workbench chrome и generated selectors не входят в Source.",
    "linkedAuthorStyleSheets: [{id, link}]\nexperience.dispose() → release links",
  ),
  references: contract(
    "Owner evidence resources",
    "Reference metadata and media remain linked owner resources for a later acceptance stage.",
    "MCP may create bounded evidence captures, but this stage does not create accepted baselines, visual diffs or owner acceptance state.",
    "resources.references: [\"./reference.png\"]",
  ),
  app: contract(
    "Одна package tab — один Experience",
    "Одна exact package identity через private browser lifecycle owner соответствует одному повторно используемому package target. Вкладка загружает один generated entry, один runtime adapter с marker `storybook-runtime/4` и только выбранные lazy story chunks в один `@zavx0z/browser` Experience.",
    "Browser владеет Document, Canvas, циклом кадров и вводом страницы. Experience предоставляет exact `@zavx0z/space` `XRSpaceElement` и `XRViewPointElement`. Projection допускает только `display | hud | space`: display использует настоящий `XRDisplayElement`, hud — `XRHUDElement`, а space получает `context.space` и `mountSpacePreview`. Child Experience, Document, Canvas, Space или ViewPoint не создаются.",
    "one package = one tab = one Experience → Display | HUD | Space",
  ),
  server: contract(
    "One server and origin",
    "One daemon owns automatic-port HTTP/WebSocket state for every attached root and package tab; MCP connection lifetime is independent.",
    "The shared controller migrates verified legacy TMPDIR state, rejects foreign checkouts and fences daemon publication with one atomic startup lease; no consumer owns a listener or port.",
    "storybook serve ./workspace\nstorybook_ensure({roots})",
  ),
  browserLifecycle: contract(
    "One logical target per package",
    "The private StorybookBrowserLifecycle package owner holds one tagged absent | reserved | owned target state for each exact packageId. Reservation precedes target creation, so repeated, concurrent and recovered opens reuse one operation and one opaque view identity; route and server origin only navigate that target.",
    "Landing, CLI and MCP call the same openPackage application command and never open a tab independently. Duplicate logical state is unrepresentable. Only an authenticated human action in landing may pass `foreground: true` after exact target re-attestation; CLI and MCP remain background-only. Foreign or navigated-away user targets remain untouched.",
    "await browserLifecycle.openPackage({packageId: \"@zavx0z/ui\", route, foreground: true})\n// human landing action only; CLI and MCP omit foreground",
  ),
  launcher: contract(
    "MCP and human adapters",
    "`ensure`, `attach`, `search`, `open`, `wait`, `inspect`, `interact`, `capture`, `check`, `close` и явное администрирование вызывают один typed controller. Browser open делегируется private lifecycle owner через `openPackage`; MCP владеет только bounded schemas и opaque transport projections. Inspection показывает Canvas единственного Experience. Key interaction проверяет exact Workbench HUD owner и вызывает `experience.dispatchKey(...)`.",
    "Диагностику Document предоставляет @zavx0z/devtools из WebXR: createDomInspector сохраняет идентификаторы, снимки дерева и состояния, размеры и записи рисования. Storybook передаёт readFrame(node) из существующего Experience. CLI и MCP не содержат target records, reservation state, discovery или reconciliation. Canvas capture направлен в тот же exact Experience Canvas без поиска множества native Canvas. Bridge не создаёт semantic keyboard events или второй input owner, поэтому Browser-owned defaults Escape, Range и Select остаются authoritative.",
    [
      "storybook attach ./project",
      "storybook detach project-id",
      "storybook open @zavx0z/ui components/foundation/button/basic/contained",
      "storybook status",
      "storybook check @zavx0z/ui",
      "storybook stop",
      "MCP and CLI stay background; only authenticated landing may request foreground",
    ].join("\n"),
  ),
  scaffold: contract(
    "Declaration initialization",
    "storybook init creates .storybook data and optional runtime/story owner directories, not a private npm package.",
    "No package.json, bunfig, server, build wrapper, port or dependency is introduced.",
    "storybook init packages/components --kind package --executable --stories",
  ),
  build: contract(
    "Independent PackageSession",
    "Each package has a serial queue, isolated candidate, immutable built revision, exact graph snapshot, activation lease and lastWorking diagnostics. Automatic rebuild runs only while the package has a live view subscriber.",
    "An inactive package records its latest generation without compiling and catches up when its first view subscribes. Only browser-acknowledged create → mount → presented frame promotes active/lastWorking; a failed candidate never cancels successful peers.",
    "candidate → built → activating → active/lastWorking",
  ),
  environment: contract(
    "Package-scoped updates",
    "Metafile identities and typed declaration/code/metadata/resource watchers invalidate only their owning sessions. Project and workspace README changes emit registry.readme-updated with exact nodeIds: only the selected document is fetched again and its existing Markdown article is updated in the same Experience, without reloading the page or building packages.",
    "Shared browser code uses the existing dependency watcher and canonical metafile inputs. Changed shared dependencies rebuild the landing/fallback entries on the same server; shared.updated reloads only registry pages. Hashed assets remain available to older documents. A failed build preserves the previous working assets and retries after repair. Package pages retain their independent revisions and lastWorking behavior.",
    "registry.readme-updated {nodeIds} → existing Markdown.update\nshared.updated {entry} → registry page reload\npackage.updated → matching package view",
  ),
})

export const routeTree = contracts.routeTree
export const stories = contracts.stories
export const catalog = contracts.catalog
export const workbench = contracts.workbench
export const authorStyles = contracts.authorStyles
export const references = contracts.references
export const app = contracts.app
export const server = contracts.server
export const browserLifecycle = contracts.browserLifecycle
export const launcher = contracts.launcher
export const scaffold = contracts.scaffold
export const build = contracts.build
export const environment = contracts.environment

function contract(
  title: string,
  summary: string,
  ownership: string,
  example: string,
) {
  const props = Object.freeze({title, summary, ownership, example})
  return defineSelfStory((document) => {
    const staging = document.createElement("div")
    const root = createRoot(staging)
    root.render(<ContractDocument
      title={props.title}
      summary={props.summary}
      ownership={props.ownership}
      example={props.example}
    />)
    const element = staging.firstElementChild as HTMLElement | null
    if (element === null) {
      root.unmount()
      throw new Error("Self Storybook Contract mounted no document")
    }
    staging.removeChild(element)
    return Object.freeze({
      element,
      root,
      source: Object.freeze({
        html: serializeSelfElement(element),
        typescript: example,
      }),
      props: Object.freeze({title}),
      dispose: () => root.unmount(),
    })
  })
}
