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
    "Owners provide ordered JSON. External Storybook derives landing, navigation, search, URLs, build lookup and the current MCP viewport from the same identities; a failed attach leaves the current registry unchanged. One compiled aggregate contains separate runtime/4 child sessions in the same Document and owns a CSS row with flex-wrap, align-content: flex-start and gap: 8px; Renderer packs bounded tiles into compact cross-start rows, one child fills preview, and vertical overflow is only a small-height fallback. Single-child Inspector inheritance does not change navigation selection; multi-child aggregates choose no arbitrary Inspector owner. Storybook never computes packing coordinates. " +
    "Tile hosts connect to the existing declared Display/HUD projection before child mount; context.present validates and attaches the owner synchronously. Each tile independently scales its real owner to fit using the existing projection frames, preserving aspect ratio, authored dimensions and node identity through resize. Abort and failure release every session, owner node, fit subscription and aggregate wrapper. Subjects without variants remain documentation overviews. Mixed-projection categories remain README/navigation overviews without remapping children.",
    "context.present(owner)\n// Owner is synchronously attached to its existing Display/HUD projection.\n// Each tile: scale = min(1, availableWidth / ownerWidth, availableHeight / ownerHeight).\n// Viewport and owner resize refit the same production node.\n// Abort or failure releases every child, frame subscription and wrapper.",
  ),
  stories: contract(
    "Owner story modules",
    "A catalog stores one static module path and export name for each executable variant. Story modules import production owners, never Storybook.",
    "The external PackageSession validates exports and emits literal lazy imports before browser delivery.",
    "export const contained = createContainedButtonStory()",
  ),
  catalog: contract(
    "Структура и манифест",
    "Главная панель — дерево репозиторий → пакет → вложенный пакет; вторая — категории и предметы выбранного пакета. Вложенность не объединяет сборки и ревизии. Выбор пакета открывает содержимое в текущей вкладке по /packages; старый /browse перенаправляет туда. Сборки и ревизии остаются изолированными по packageId. Структура определяет состав пакетов через package.json#workspaces и Bun.Glob, включая звёздочки и исключения. Пакет без манифеста тоже видим и выбираем; его страница без исполняемых модулей использует только общие compiler owners Storybook. Манифест дополняет пакет содержимым; manifest.packages остаётся только для проектов без workspaces. JSON reader в discovery/declarations.ts передаёт нормализованный StorybookCatalog из catalog/catalog.t.ts. ExternalStorybookRegistry принимает StorybookCatalogResolver при создании; граф и подготовка сборки не импортируют JSON reader. Структура и манифест дают один граф. Состав структурного проекта больше не дублируется в манифесте. " +
    "The catalog model is category → subject → variant with optional presentation groups and explicit migration routes. README uses @zavx0z/ui/views/markdown and the shared @zavx0z/ui/markdown parser (markdown-it CommonMark plus inert parse5 HTML projection). Resource discovery uses that same parser, including code-labelled links and admitted HTML images. Code blocks reuse CodeEditor.",
    "Нормализованный каталог сохраняет точные source references, порядок владельца и существующие маршруты. Ошибка декларации изолирована у её владельца: сохраняются проверенный каталог и рабочая ревизия пакета, соседние пакеты продолжают обновляться. При холодном старте проблемный пакет остаётся с диагностикой resolve. Landing и MCP доступны, после исправления пакет восстанавливается. catalog/registry.spec.ts проверяет эту границу на невизуальном пакете без .storybook. Владельцы реализации разделены на discovery, catalog, build, sessions, runtime, workbench и server; MCP и browser-lifecycle сохраняют свои границы. " +
    "The package owns semantic order, typed category identity and resources. Storybook owns the surrounding viewport and current-tab navigation. Markdown wrap defaults to true; fenced code retains its scrolling. Browser loads declared Engine-owned Inter and JetBrains Mono faces, and Renderer/WebGPU share face selection and exact metrics. Image dimensions and GIF animation reuse the WebGPU texture loader. GIF decoding pauses when all image consumers leave their viewport/clips and resumes from the saved frame position. GIF playback requires browser ImageDecoder support; otherwise a static frame remains with a diagnostic. Script, executable URLs and HTML event attributes are not materialized. List markers and table layout retain platform limitations.",
    'const project = {workspaces: ["packages/*", "!packages/excluded"]}\n// packages/parser/package.json: {name: "@example/parser", label: "Parser"}\n// Parser is selectable even without .storybook/manifest.json\n// Optional manifest adds its catalog, stories and resources',
  ),
  workbench: contract(
    "Workbench из шести областей",
    "`catalog`, `secondary`, `scenarios`, `preview`, `inspector` и `status` являются шестью compiled TSX components одного `workbench-layout/2`. Весь Workbench монтируется в exact `XRHUDElement` `external-storybook-workbench`. Status композирует production Breadcrumbs с полным путём `workspace → project → package → category → subject → variant`; scenario toolbar расположен непосредственно над preview.",
    "Страница владеет одним `@zavx0z/browser` Root: Browser владеет Document, Canvas, циклом кадров и вводом, а Root содержит exact `@zavx0z/space` `XRSpaceElement` и `XRViewPointElement`. Workbench использует `@zavx0z/ui/widgets/inspector`, `@zavx0z/ui/navigation/breadcrumbs` и exact `@zavx0z/ui/feedback/status-bar`. Первый сегмент Breadcrumbs — иконка дома с доступным именем «Главная», ведущая в общий каталог `/`; далее сохраняется реальная иерархия workspace/project/package. Переход к предку использует ту же вкладку. Display story монтируется в actual `XRDisplayElement`, HUD story — в `XRHUDElement`, а трёхмерная story — непосредственно в `XRSpaceElement`. " +
    "Авторский TSX использует обычный document со стандартными DOM-типами: Template привязывает его к Document компонента при сборке и сохраняет ссылку в callbacks. Native document страницы не заменяется. Центральная область HUD задаёт только layout bounds. Её отдельная рамка Preview отсутствует: border, border-radius и overflow принадлежат самому xr-display. Shell переводит границы центральной области из CSS pixels в положение и масштаб Display через текущую камеру; viewport Display изменяется вместе с областью. README и story остаются прямым содержимым Display без декоративной обёртки. " +
    "Содержимое стандартной панели Inspector создаётся при первом выборе и раскрытии: скрытая панель «Исходники» не строит подсвеченную копию примера заранее. После первого раскрытия её nodes сохраняются при переключении и сворачивании, новые values продолжают обновляться. Исполняемая проверка этой последовательности находится в workbench/controller.test.ts. " +
    "В том же HUD один production ClipboardMenu показывает «Копировать» и «Вставить» для всей страницы. Он получает существующий clipboard controller Browser Root, а не создаёт новый ввод или буфер. Контекстное меню и клавиатура сохраняют цель и выделение; read-only текст нельзя изменить вставкой. Обычный текст, Markdown и code blocks используют Document.Selection, редактор — ту же геометрию плюс собственную модель нескольких диапазонов. Ошибка системного clipboard не изменяет целевой текст.",
    "attach({canvas, app: <StorybookApp />}) → root.getProjection(workbenchHud) → external-storybook-workbench",
  ),
  authorStyles: contract(
    "Связанные стили автора и исходный текст root",
    "Пакет объявляет упорядоченные exact public CSS exports собственного владельца или достижимой через manifest локальной зависимости. Каждая immutable revision создаёт одну native link на ресурс до загрузки module entry; все обязательные links должны быть ready до `attach({canvas, app: <StorybookApp />})`.",
    "Global Source CSS берётся из объявленного author registry. Component Source CSS берётся только из authored provenance одного active ComponentRoot и показывается как исходный CSS с подсветкой. Dynamic declarations остаются inline в HTML. Cleanup освобождает Root раньше связанных ресурсов; Workbench chrome и generated selectors не входят в Source.",
    "stylesheets: [{id, link}]\nroot.unmount() → release links",
  ),
  references: contract(
    "Owner evidence resources",
    "Reference metadata and media remain linked owner resources for a later acceptance stage.",
    "MCP may create bounded evidence captures, but this stage does not create accepted baselines, visual diffs or owner acceptance state.",
    "resources.references: [\"./reference.png\"]",
  ),
  app: contract(
    "Одна package tab — один Root",
    "Один пакет можно открыть в нескольких вкладках. Пользователь переключает пакеты в текущей вкладке, агент переиспользует вкладку своего пакета или открывает фоновую. Каждая страница загружает один generated entry, один runtime adapter с marker `storybook-runtime/4` и только выбранные lazy story chunks в один `@zavx0z/browser` Root.",
    "Browser владеет Document, Canvas, циклом кадров и вводом страницы. Root предоставляет exact `@zavx0z/space` `XRSpaceElement` и `XRViewPointElement`. Projection допускает только `display | hud | space`: display использует настоящий `XRDisplayElement`, hud — `XRHUDElement`, а space получает `context.space` и `mountSpacePreview`. Child Root, Document, Canvas, Space или ViewPoint не создаются.",
    "each page = one Root → Display | HUD | Space; many tabs may show one package",
  ),
  server: contract(
    "One server and origin",
    "One daemon owns automatic-port HTTP/WebSocket state for every attached root and package tab; MCP connection lifetime is independent.",
    "The shared controller migrates verified legacy TMPDIR state, rejects foreign checkouts and fences daemon publication with one atomic startup lease; no consumer owns a listener or port.",
    "storybook serve ./workspace\nstorybook_ensure({roots})",
  ),
  browserLifecycle: contract(
    "Current-tab navigation and background agent views",
    "The private browser-lifecycle/ workspace package owns StorybookBrowserLifecycle. Package reservations serialize agent opens: reuse a tab currently showing the exact package, otherwise create a background tab. Multiple tabs may show the same package; listing preserves them all. Readiness uses the full bounded open budget for a busy page.",
    "User navigation stays in the current tab. Agent opens remain background-only. A tab the user moved to another package is preserved, and its old viewId cannot inspect or control the new package. Only explicit successful live-check application updates all tabs of the package; building or previewing a candidate does not publish it.",
    'await browserLifecycle.openPackage({packageId: "@zavx0z/ui", route})\n// reuse a matching tab or create a background tab; preserve all peers\n// storybook_check({schemaVersion: 1, scope: "@zavx0z/ui", live: true}) applies after inspection',
  ),
  launcher: contract(
    "MCP and human adapters",
    "На landing кнопка + справа от поиска вызывает native showDirectoryPicker. Одноразовая метка с browser readwrite permission подтверждает точную папку локальному серверу и удаляется после запроса; путь не угадывается по имени. При наведении внутри общей подсветки строки появляется крестик удаления из каталога. Место под него зарезервировано; нажатие не открывает проект. Те же операции выполняют storybook_attach и storybook_detach. В ~/.storybook/projects.json сохраняется только массив абсолютных путей; состав не восстанавливается из истории запусков. Названия читаются только из обязательного непустого package.json#label; label в manifest отклоняется. Правила находятся в archetypes/README.md. Пустой состав сохраняется; файлы проектов не удаляются. Вложенный проект исключается без удаления соседей, повторное добавление восстанавливает его. " +
    "`ensure`, `attach`, `search`, `open`, `wait`, `inspect`, `interact`, `capture`, `check`, `close` и явное администрирование вызывают один typed controller. Browser open делегируется private lifecycle owner через `openPackage`; MCP владеет только bounded schemas и opaque transport projections. Inspection показывает Canvas единственного Root. Pointer и wheel interaction проходят через `root.input` с общим hit/occlusion/capture; Key interaction использует `root.dispatchKey(...)`.",
    "Диагностику Document предоставляет @zavx0z/devtools из WebXR: createDomInspector сохраняет идентификаторы, снимки дерева и состояния, размеры и записи рисования. Storybook передаёт readFrame(node) из существующего Root. CLI и MCP не содержат target records, reservation state, discovery или reconciliation. Canvas capture направлен в тот же exact Root Canvas без поиска множества native Canvas. Bridge не создаёт semantic keyboard events или второй input owner, поэтому Browser-owned defaults Escape, Range и Select остаются authoritative. Команда key не выполняет скрытый клик и не сбрасывает выделение; type передаёт текст через Root.dispatchText и общий beforeinput/input, включая contenteditable и многовыделение CodeEditor.",
    [
      "storybook attach ./project",
      "storybook detach project-id",
      "storybook open @zavx0z/ui components/foundation/button/basic/contained",
      "storybook status",
      "storybook check @zavx0z/ui",
      "storybook stop",
      "User navigation stays in the current tab; agent opens stay background and preserve other packages",
    ].join("\n"),
  ),
  scaffold: contract(
    "Declaration initialization",
    "storybook init reads the required non-empty package.json#label and creates .storybook data without a manifest label, plus optional runtime/story owner directories. Projects with workspaces need no --declaration list; legacy project/workspace compositions use explicit --declaration paths.",
    "No package.json, bunfig, server, build wrapper, port or dependency is introduced.",
    "storybook init packages/components --kind package --executable --stories",
  ),
  build: contract(
    "Independent PackageSession",
    "Each package has a serial queue, isolated candidate, immutable built revision, exact graph snapshot and lastWorking diagnostics. Automatic rebuild runs only while the package has a live subscriber. Build success never replaces the applied revision.",
    "The agent previews a candidate, then explicitly calls check(live:true). Exact revision and graph, ready/presented frame and console are checked before application. All matching tabs update together; failed checks preserve lastWorking. The applied artifact survives server restart, and reconnecting readers synchronize the applied revision. An ordinary page with no applied version shows that state explicitly.",
    "candidate → built → agent preview → check(live:true) → persisted active/lastWorking → all package tabs",
  ),
  environment: contract(
    "Package-scoped updates",
    "Dependency watchers сохраняют канонический путь обычного файла при hardlink-копиях Bun и замене inode. Разрешаются только настоящие symlinks; конфликт сменившей цель ссылки с прежним подписчиком отклоняется атомарно. " +
    "Metafile identities and typed declaration/code/metadata/resource watchers invalidate only their owning sessions. Project and workspace README changes emit registry.readme-updated with exact nodeIds: only the selected document is fetched again and its existing Markdown article is updated in the same Root, without reloading the page or building packages.",
    "Shared browser code uses the existing dependency watcher and canonical metafile inputs. Changed shared dependencies rebuild the landing/fallback entries on the same server; shared.updated reloads only registry pages. Hashed assets remain available to older documents. A failed build preserves the previous working assets and retries after repair. If bootstrap left an owned package page without its bridge, open reloads that same target once after repair. Package pages retain their independent revisions and lastWorking behavior.",
    "registry.readme-updated {nodeIds} → existing Markdown.update\nshared.updated {entry} → registry page reload\npackage.built → candidate only\npackage.updated → all matching package views\npackage.applied-state → recover missed application after reconnect",
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
