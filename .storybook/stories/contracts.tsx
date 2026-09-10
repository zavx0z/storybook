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
    "Versioned standalone package, project and optional workspace declarations resolve atomically into one immutable graph. Public package URLs use readable slugs: @zavx0z/dom becomes /pkg-zavx0z-dom/. Exact package identities are preserved, slug collisions fail closed, and old applied URLs remain usable until the next verified application. Package, category and subject overviews remain real states; unknown routes fail closed. Category and subject overviews render real immediate child stories without selecting their representative routes. A single-child overview retains that representative subject's Inspector contract and values.",
    "Owners provide ordered JSON. External Storybook derives landing, navigation, search, URLs, build lookup and the current MCP viewport from the same identities; a failed attach leaves the current registry unchanged. One compiled aggregate contains separate runtime/4 child sessions in the same Document and owns a CSS row with flex-wrap, align-content: flex-start and gap: 8px; Renderer packs bounded tiles into compact cross-start rows, one child fills preview, and vertical overflow is only a small-height fallback. Single-child Inspector inheritance does not change navigation selection; multi-child aggregates choose no arbitrary Inspector owner. Storybook never computes packing coordinates. " +
    "Tile hosts connect to the existing declared Display/HUD projection before child mount; context.present validates and attaches the owner synchronously. Each tile independently scales its real owner to fit using the existing projection frames, preserving aspect ratio, authored dimensions and node identity through resize. Abort and failure release every session, owner node, fit subscription and aggregate wrapper. Subjects without variants remain documentation overviews. Mixed-projection categories remain README/navigation overviews without remapping children.",
    "// @zavx0z/dom → /pkg-zavx0z-dom/\n// @internal/visual → /pkg-internal-visual/\n// workbench → /pkg-zavx0z-storybook/dir-workbench\n// numeric/number → /pkg-nodes-parameters/dir-numeric/dir-number\n// Категории раскрываются до компонента с index.tsx или модуля с src\n// Bound stories retain their authored subject/variant routes\n// packageId remains the exact npm name\ncontext.present(owner)\n// Owner is synchronously attached to its existing Display/HUD projection.\n// Each tile: scale = min(1, availableWidth / ownerWidth, availableHeight / ownerHeight).\n// Viewport and owner resize refit the same production node.\n// Abort or failure releases every child, frame subscription and wrapper.",
  ),
  stories: contract(
    "Owner story modules",
    "A catalog stores one static module path and export name for each executable variant. Story modules import production owners, never Storybook.",
    "The external PackageSession validates exports and emits literal lazy imports before browser delivery.",
    "export const contained = createContainedButtonStory()",
  ),
  catalog: contract(
    "Структура и манифест",
    "Репозиторий и самостоятельный пакет должны иметь корневой README.md рядом с package.json. Он обнаруживается автоматически с манифестом и без него; явный manifest.readme сохраняется только для нестандартного обзора. Стандартный README не дублируется в манифесте. Пакет без дополнительных деклараций обходится без metadata-only манифеста. Пакетный manifest не содержит kind, id и packageJson: эти поля запрещены, владелец читается из package.json рядом с .storybook. Генератор также не создаёт эти поля. Отсутствующий обзор не скрывает узел. Identity каждого владельца равна package.json#name, включая корень репозитория. Корень представлен одним пакетом без project/repository оболочки. Workspaces раскрываются у любого пакета. Содержание README определяют авторы пакета. Главная панель — дерево корневой пакет → вложенные пакеты; вторая — категории и предметы выбранного пакета. Предметная панель раскрывает структурные категории выбранного пакета рекурсивно до директории компонента с публичным index.tsx или существующего модуля с src. Реализация компонента находится прямо в index.tsx без обязательного src; крупные внутренние помощники допустимы в src, общие — в shared. Обычный index.ts, включая barrel, сам по себе не останавливает обход. На ней обход останавливается; exports и re-exports не определяют роль узла или навигацию. Имя берётся с диска, выбор открывает начальный TSDoc @packageDocumentation из index.tsx компонента или index.ts категории и невизуального модуля. Допустимый index.tsx имеет приоритет над index.ts даже без TSDoc; игнорируемые файлы и symlink исключены. Содержимое JSX или экспортов не анализируется. Корневой index.ts также содержит модульный TSDoc; пакетный обзор остаётся авторским README. README не используется как fallback и остаётся на диске. Модуль не исполняется, описание публикуется из проверенного исходника в immutable revision; отсутствие блока даёт явный пустой обзор. Промежуточные категории обходятся до границы index.tsx, src или package.json. Каждый структурный сегмент URL имеет префикс dir-: /pkg-nodes-parameters/dir-numeric/dir-number. Принимаются только обнаруженные цепочки директорий, без произвольных смешанных directory/story маршрутов. src, shared, .git, node_modules, .storybook, tests и test скрыты на любой глубине; остальные исключения задаются Git через git check-ignore --no-index, включая вложенные .gitignore и правила с !. Директории с package.json сохраняют отдельное владение и не обходятся как обычные папки. Вложенность не объединяет сборки и ревизии. Выбор пакета открывает содержимое в текущей вкладке по /pkg-имя; старые адреса перенаправляются после применения новой ревизии. Сборки и ревизии остаются изолированными по packageId. Структура определяет состав пакетов через package.json#workspaces и Bun.Glob, включая звёздочки и исключения. Пакет без манифеста тоже видим и выбираем; его страница без исполняемых модулей использует только общие compiler owners Storybook. Манифест дополняет пакет содержимым; manifest.packages остаётся только для проектов без workspaces. JSON reader в discovery/declarations.ts передаёт нормализованный StorybookCatalog из catalog/catalog.t.ts. ExternalStorybookRegistry принимает StorybookCatalogResolver при создании; граф и подготовка сборки не импортируют JSON reader. Структура и манифест дают один граф. Состав структурного проекта больше не дублируется в манифесте. " +
    "The catalog model is category → subject → variant with optional presentation groups and explicit migration routes. Опциональный subject.directory указывает от корня пакета на обнаруженный модуль с index.tsx или src. A single bound subject subsumes its directory row and uses that filesystem name and TSDoc; multiple subjects such as Socket presets stay beneath one module. Empty legacy categories disappear after binding. Authored subject/variant routes, API identities and presentation stay intact. Root @webxr/nodes contains independent @nodes/tree, @nodes/layout, @nodes/parameters and @nodes/sockets packages. README uses @webxr/markdown and the shared @webxr/markdown/parser parser (markdown-it CommonMark plus inert parse5 HTML projection). Resource discovery uses that same parser, including code-labelled links and admitted HTML images. Code blocks reuse CodeEditor.",
    "Нормализованный каталог сохраняет точные source references, порядок владельца и существующие маршруты. Ошибка декларации изолирована у её владельца: сохраняются проверенный каталог и рабочая ревизия пакета, соседние пакеты продолжают обновляться. При холодном старте проблемный пакет остаётся с диагностикой resolve. Landing и MCP доступны, после исправления пакет восстанавливается. catalog/registry.spec.ts проверяет эту границу на невизуальном пакете без .storybook. Владельцы реализации разделены на discovery, catalog, build, sessions, runtime, workbench и server; MCP и browser-lifecycle сохраняют свои границы. " +
    "The package owns semantic order, typed category identity and resources. Storybook owns the surrounding viewport and current-tab navigation. Markdown wrap defaults to true; fenced code retains its scrolling. Browser loads declared Engine-owned Inter and JetBrains Mono faces, and Renderer/WebGPU share face selection and exact metrics. Image dimensions and GIF animation reuse the WebGPU texture loader. GIF decoding pauses when all image consumers leave their viewport/clips and resumes from the saved frame position. GIF playback requires browser ImageDecoder support; otherwise a static frame remains with a diagnostic. Script, executable URLs and HTML event attributes are not materialized. List markers and table layout retain platform limitations.",
    "const project = {workspaces: [\"packages/*\", \"!packages/excluded\"]}\n// Пакет доступен без .storybook/manifest.json\n// numeric/index.ts: TSDoc категории, barrel не завершает обход\n// numeric/number/index.tsx: реализация и @packageDocumentation компонента\n// numeric/number/src/helper.ts: необязательный внутренний помощник\n// numeric/shared/: общие помощники скрыты\n// exports и re-exports не классифицируют категории и компоненты\nconst subject = {\n  id: \"number\",\n  kind: \"component\",\n  label: \"Number\",\n  apiName: \"NumberParameter\",\n  directory: \"numeric/number\",\n  route: \"parameters/number\",\n  presentation: {\n    protocol: \"story-presentation/1\",\n    projection: \"display\",\n    widgets: [\"source\", \"diagnostics\"],\n  },\n  variants: [{\n    id: \"field\",\n    label: \"Field\",\n    route: \"parameters/number/field\",\n    module: {path: \"./stories/number.ts\", export: \"field\"},\n  }],\n}\n// Привязанный number сохраняет одну строку, TSDoc и авторские сценарии\n// Несколько предметов одного модуля остаются под общей строкой\n// src/, shared/, .storybook/, tests/ и test/ скрыты на любой глубине\n// .gitignore исключает dist/; build/ виден, если не игнорируется",
  ),
  workbench: contract(
    "Workbench из шести областей",
    "`catalog`, `secondary`, `scenarios`, `preview`, `inspector` и `status` являются шестью compiled TSX components одного `workbench-layout/2`. Весь Workbench монтируется в exact `HUDElement` `external-storybook-workbench`. Status композирует production Breadcrumbs с полным путём `package → nested package → category → subject → variant`; scenario toolbar расположен непосредственно над preview.",
    "Страница владеет одним `@zavx0z/browser` Root: Browser владеет Document, Canvas, циклом кадров и вводом, а Root содержит exact `@zavx0z/dom/space` `SpaceElement` и `@zavx0z/dom/viewpoint` `ViewPointElement`. Workbench использует `@zavx0z/ui/widgets/inspector`, `@zavx0z/ui/navigation/breadcrumbs` и exact `@zavx0z/ui/feedback/status-bar`. Первый сегмент Breadcrumbs — иконка дома с доступным именем «Главная», ведущая в общий каталог `/`; далее сохраняется реальная иерархия workspace/project/package. Переход к предку использует ту же вкладку. Display story монтируется в actual `DisplayElement`, HUD story — в `HUDElement`, а трёхмерная story — непосредственно в `SpaceElement`. " +
    "Авторский TSX использует обычный document со стандартными DOM-типами: Template привязывает его к Document компонента при сборке и сохраняет ссылку в callbacks. Native document страницы не заменяется. Пространственные компоненты используют общий контракт Space: position и target целиком, rotation в градусах XYZ. У базового DisplayElement атрибуты width/height задают физические размеры в мм, а CSS width/height — разрешение в px; dpi вычисляется по обеим осям. Служебный Display заполняет всю фактическую область preview в HUD. Её отдельная рамка Preview отсутствует: border, border-radius и overflow принадлежат самому display. " +
    "Для границ preview W × H host задаёт физические размеры W × 25.4 / 96 и H × 25.4 / 96 мм, CSS-разрешение round(W) × round(H) px и scale: 1. Shell совмещает поверхность с границами preview дистанцией и параллельным сдвигом ViewPoint с целью. Resize окна или HUD обновляет физические размеры, viewport, матрицу и раскладку на тех же DOM-узлах, сохраняя фокус и состояние компонентов. Прокрутка следует ограничениям нового viewport. Постоянные размеры, пропорции и параметры монитора устройства не используются; шрифт не уменьшается ради подгонки, стандартная прямая отрисовка сохраняется. Дисплеи физического оборудования внутри демонстраций сохраняют авторские характеристики. README и story остаются прямым содержимым Display без декоративной обёртки. " +
    "Содержимое стандартной панели Inspector создаётся при первом выборе и раскрытии: скрытая панель «Исходники» не строит подсвеченную копию примера заранее. После первого раскрытия её nodes сохраняются при переключении и сворачивании, новые values продолжают обновляться. Исполняемая проверка этой последовательности находится в workbench/controller.test.ts. " +
    "В том же HUD один production ClipboardMenu показывает «Копировать» и «Вставить» для всей страницы. Он получает существующий clipboard controller Browser Root, а не создаёт новый ввод или буфер. Контекстное меню и клавиатура сохраняют цель и выделение; read-only текст нельзя изменить вставкой. Обычный текст, Markdown и code blocks используют Document.Selection, редактор — ту же геометрию плюс собственную модель нескольких диапазонов. Ошибка системного clipboard не изменяет целевой текст.",
    "createRoot(canvas).render(<StorybookApp />) → presentation.getProjection(workbenchHud) → external-storybook-workbench",
  ),
  authorStyles: contract(
    "Связанные стили автора и исходный текст root",
    "Пакет объявляет упорядоченные exact public CSS exports собственного владельца или достижимой через manifest локальной зависимости. Каждая immutable revision создаёт одну native link на ресурс до загрузки module entry; все обязательные links должны быть ready до `createRoot(canvas).render(<StorybookApp />)`. Landing и fallback до активации ревизии также передают уже объявленные сервером Workbench links; относительный theme.css у страницы пакета не запрашивается.",
    "Зависимости собранного кандидата отслеживаются вместе с зависимостями активной ревизии, чтобы исправление нового файла инициировало пересборку до активации. При сбое запуска до agent bridge inspect возвращает bootstrap markers и native console только для подтверждённой вкладки пакета; готовность при этом остаётся false. Global Source CSS берётся из объявленного author registry. Component Source CSS берётся только из authored provenance одного active ComponentRoot и показывается как исходный CSS с подсветкой. Dynamic declarations остаются inline в HTML. Cleanup освобождает Root раньше связанных ресурсов; Workbench chrome и generated selectors не входят в Source.",
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
    "Browser владеет Document, Canvas, циклом кадров и вводом страницы. App монтируется в semantic body; Workbench получает Space по принадлежности своего Display, а documentElement остаётся html. Диагностика того же Root предоставляет exact `@zavx0z/dom/space` `SpaceElement` и `@zavx0z/dom/viewpoint` `ViewPointElement`. Projection допускает только `display | hud | space`: display использует настоящий `DisplayElement`, hud — `HUDElement`, а space получает `context.space` и `mountSpacePreview`. Child Root, Document, Canvas, Space или ViewPoint не создаются.",
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
    "The private browser-lifecycle/ workspace package owns StorybookBrowserLifecycle. Package reservations serialize agent opens: reuse a tab currently showing the exact package, otherwise create a background tab. Multiple tabs may show the same package; listing preserves them all. Readiness uses the full bounded open budget for a busy page. Inventory применяется атомарно после полного наблюдения: abort и неопределённый транспорт сохраняют прежние handles. Scoped status(includeViews:true) и live-check проверяют только выбранный packageId; записи остальных пакетов сохраняются без повторной проверки. Подтверждённо закрытый или сменивший пакет target теряет прежний handle, preflight перед действием сохраняется. Dispatch-aware клиент отмечает createSent у native send boundary после preflight и abort checks; только явный unsent допускает очистку reservation и один retry. Возможная отправка без receipt, старые записи без маркера и ошибки клиента без dispatch-контракта остаются консервативными: blind duplicate create запрещён, прежнее восстановление receipt/наблюдаемого target сохраняется. Indeterminate error возвращает bounded evidence reservation/inventory и read-only attestation до трёх matching targets своего пакета: verified, not-ready, bootstrap-owned либо неопределённость. Query tokens и native IDs скрыты; отсутствие receipt или matching наблюдения не доказывает отсутствие отправки. Диагностика не создаёт targets и не очищает записи. Подтверждённый existing baseline peer можно переиспользовать с обычными readiness/expectedRevision проверками, сохраняя unknown reservation побайтно: peer не считается receipt. Новый не-baseline peer не используется для такого обхода, чтобы navigation не превратила его в ложный late receipt. Без подходящего peer создание остаётся запрещено; настоящий unique late target по исходному URL восстанавливается прежним путём.",
    "User navigation stays in the current tab. Agent opens remain background-only. A tab the user moved to another package is preserved, and its old viewId cannot inspect or control the new package. Only explicit successful live-check application updates all tabs of the package; building or previewing a candidate does not publish it.",
    'await browserLifecycle.openPackage({packageId: "@zavx0z/ui", route})\n// reuse a matching tab or create a background tab; preserve all peers\n// scoped inventory A не проверяет B; abort сохраняет оба handles\n// Полный inventory → reconcile выбранного scope; перед действием снова проверить owner\n// reserved unsent → durable beforeSend → native send → receipt owned\n// Ошибка до send очищает unsent; возможная отправка без receipt остаётся indeterminate\n// indeterminate evidence: phase/createSent/receipt, completed inventory, bounded own-target attestation\n// attested baseline peer → reuse/readiness/revision; unknown reservation остаётся прежней\n// storybook_check({schemaVersion: 1, scope: "@zavx0z/ui", live: true}) applies after inspection',
  ),
  launcher: contract(
    "MCP and human adapters",
    "На landing кнопка + справа от поиска вызывает native showDirectoryPicker. Одноразовая метка с browser readwrite permission подтверждает точную папку локальному серверу и удаляется после запроса; путь не угадывается по имени. При наведении внутри общей подсветки строки появляется крестик удаления из каталога. Место под него зарезервировано; нажатие не открывает проект. Те же операции выполняют storybook_attach и storybook_detach. В ~/.storybook/projects.json сохраняется только массив абсолютных путей; состав не восстанавливается из истории запусков. Названия читаются только из обязательного непустого package.json#label; label в manifest отклоняется. Правила находятся в archetypes/README.md. Пустой состав сохраняется; файлы проектов не удаляются. Вложенный проект исключается без удаления соседей, повторное добавление восстанавливает его. " +
    "`ensure`, `attach`, `search`, `open`, `wait`, `inspect`, `interact`, `capture`, `check`, `close` и явное администрирование вызывают один typed controller. Browser open делегируется private lifecycle owner через `openPackage`; MCP владеет только bounded schemas и opaque transport projections. Inspection показывает Canvas единственного Root. State и inspect дополнительно читают nativePage.visibilityState и nativePage.hasFocus из native browserDocument рядом с frameSequence и revision; недоступные значения равны null. Это не canvas.hidden и не semantic Document; чтение не создаёт кадр и не меняет фокус. Pointer и wheel interaction проходят через `root.input` с общим hit/occlusion/capture; центр target берётся из hit текущего кадра или box без hit, преобразуется CSS scale/translate и затем ровно одним Browser.projectPoint. Path presentationOwner учитывает текущий frame.presentationTransforms; нечисловые точки отклоняются до ввода. getBoundingClientRect уже клиентский и повторно не проецируется; Key interaction использует `root.dispatchKey(...)`.",
    "Диагностику Document предоставляет @zavx0z/devtools из WebXR: createDomInspector сохраняет идентификаторы, снимки дерева и состояния, размеры и записи рисования. Storybook передаёт readFrame(node) из существующего Root. CLI и MCP не содержат target records, reservation state, discovery или reconciliation. Canvas capture направлен в тот же exact Root Canvas без поиска множества native Canvas. Bridge не создаёт semantic keyboard events или второй input owner, поэтому Browser-owned defaults Escape, Range и Select остаются authoritative. Команда key не выполняет скрытый клик и не сбрасывает выделение; type передаёт текст через Root.dispatchText и общий beforeinput/input, включая contenteditable и многовыделение CodeEditor.",
    [
      "storybook attach ./project",
      "storybook detach project-id",
      "storybook open @zavx0z/ui components/foundation/button/basic/contained",
      "// inspect state: nativePage {visibilityState, hasFocus}, revision, frameSequence",
      "// Видимость читается без нового кадра; null означает недоступное native значение",
      "// Центр hit/box → CSS transform → один Browser.projectPoint → root.input",
      "// scale .43 сохраняет target; getBoundingClientRect повторно не проецируется",
      "storybook status",
      "storybook check @zavx0z/ui",
      "storybook stop",
      "User navigation stays in the current tab; agent opens stay background and preserve other packages",
    ].join("\n"),
  ),
  scaffold: contract(
    "Declaration initialization",
    "storybook init reads the required non-empty package.json#label and creates .storybook data without kind, id, packageJson, a manifest label or redundant root README reference, plus optional runtime/story owner directories. Projects with workspaces need no --declaration list; legacy project/workspace compositions use explicit --declaration paths.",
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
