# @zavx0z/storybook agent rules

## Workspace boundary

- The canonical primary checkout is
  `/Users/zavx0z/repozitarium/storybook`.
- Related canonical checkouts are
  `/Users/zavx0z/repozitarium/webxr-space`,
  `/Users/zavx0z/repozitarium/renderer`, and
  `/Users/zavx0z/repozitarium/metafor`.
- Never use `/Users/zavx0z/production` or another archival checkout.
- Preserve every supplied branch, dirty worktree, listener, browser target, and
  unrelated file. Do not create branches, clones, or worktrees without a new
  explicit owner request.

## Architecture process

- Production owners are grouped in `discovery`, `catalog`, `build`, `sessions`,
  `runtime`, `workbench` and `server`. `src/shared` contains private shared
  mechanisms. Keep direct imports to the current owner; do not restore aliases
  or forwarding files under the retired `src/external` tree.
- `catalog/catalog.t.ts` owns the normalized discovery result. JSON discovery
  remains the default resolver composed by the server. Registry and graph must
  not import the JSON reader; additional discovery mechanisms use this same
  catalog boundary and do not create parallel registries or UI/MCP models.

- Start read-only. Before implementation, audit every existing Storybook and
  present one evidence-backed owner law and a staged migration plan.
- Node is a comparison candidate, not an assumed reference implementation.
- `@zavx0z/storybook` is an external dev tool. It does not become a central
  owner of other repositories' stories.
- Every selected repository root is itself one package, with identity equal to
  package.json#name. Path locates it; label names it in UI. Never create a second
  project/repository owner or derive identity from the folder name. Workspaces
  recursively discover child packages and preserve each package's own session.
- Packages must own a README.md beside package.json as their
  overview. Discovery reads it by default with or without a manifest; an explicit
  manifest readme keeps priority. Missing documentation does not hide the owner.
  Обзоры обычных директорий читаются из TSDoc index.tsx или index.ts.
  README contents belong to the package's authors; this workflow specifies
  placement only and does not rewrite or prescribe their contents.
  Do not repeat the standard root README in manifests or generated declarations.
  Packages with no supplemental catalog, runtime, stylesheets, widgets or custom
  overview need no metadata-only manifest. Remove it after verifying owner and
  navigation parity; retain nonstandard declarations until separately migrated.
- Package manifests omit kind, id and packageJson; these fields are rejected.
  Ownership comes only from the package.json beside the .storybook directory.
  Init emits the same minimal manifest. Legacy project/workspace composition
  remains a separate input format until its own migration.
- A real package owns package.json metadata, optional JSON declarations,
  semantic order, stories/resources, optional structural runtime and acceptance.
  Structural projects discover packages through package.json workspaces using
  Bun.Glob; manifest.packages remains for projects without workspaces. Packages
  without manifests stay visible. Never combine both composition sources.
  Every selected root is one package node, with its workspace packages
  discovered by the same rule. Navigation
  ancestry never becomes executable ownership or a build dependency.
  Вторичная навигация рекурсивно раскрывает категории до собственного публичного
  index.tsx или собственного src. index.tsx содержит реализацию компонента и не
  требует src; src допустим для внутренних помощников и существующих модулей.
  Общие помощники находятся в shared. Внутренности модуля не обходятся.
  Обычный index.ts, включая barrel, сам по себе не завершает обход. Содержимое
  exports и re-exports не классифицирует узлы; package exports задают публичный API.
  Начальный @packageDocumentation читается из допустимого index.tsx, затем index.ts.
  index.tsx имеет приоритет даже без TSDoc; игнорируемые файлы и symlink исключены.
  Модули не исполняются, README не используется как fallback для директорий.
  Existing README files and their authored content remain untouched. Exclude src,
  shared, .git, node_modules, .storybook, tests and test at every depth, plus
  Git-ignored paths using native Git ignore semantics.
  Do not infer a build-output exclusion from a directory name. Discovery stops
  at package.json boundaries and never changes package composition.
  Опциональный subject.directory — путь от корня пакета к обнаруженному модулю
  с index.tsx или src. A single bound subject subsumes the structural row, inheriting its
  filesystem name and TSDoc while retaining authored routes and variants. Multiple
  subjects, such as Socket preset views, remain under that module row. Remove an
  emptied legacy category after binding; unbound subjects keep their placement.
  The one global `$storybook` process owns registry,
  canonical graph, Workbench, PackageSessions, revisions, diagnostics and
  browser mechanics for exact production package identities.
- Consumer repositories and packages never depend on or import Storybook,
  including type-only imports. They own no Storybook process, port, server,
  build wrapper, launcher or private `@scope/storybook` package.
- Import exact owners directly. Do not add compatibility aliases, `paths`,
  wrappers, root barrels, generated copies, or compatibility re-exports.
- В сборке каждой страницы сохраняется по одной resolved identity для
  `@zavx0z/browser`, `@zavx0z/component`, `@zavx0z/devtools`, `@zavx0z/dom`, `@zavx0z/engine`,
  `@nodes/layout`, `@webxr/nodes`, `@nodes/tree`, `@nodes/parameters`,
  `@nodes/sockets`, `@zavx0z/renderer`, `@webxr/markdown`,
  `@zavx0z/space`, `@zavx0z/template`, `@zavx0z/ui` и `@zavx0z/webgpu`.
  Исторические package identities, compatibility aliases и
  generic Layout preview owners не возвращаются.
- Число пакетов WebXR не фиксировано: состав следует самостоятельным
  ответственностям и принятым решениям. Диагностика использует
  `@zavx0z/devtools` из монорепозитория, без зависимости от исходного Renderer checkout.
- Landing и каждая package page владеют ровно одним
  `@zavx0z/browser` Root. Browser владеет его semantic Document, native
  Canvas, циклом кадров и вводом. Root содержит exact
  `@zavx0z/dom/space` `SpaceElement` и `@zavx0z/dom/viewpoint` `ViewPointElement`; package runtime не
  создаёт второй Root или owner.
- Весь Workbench монтируется в одну HUD projection. Subject с
  `projection: "display"` монтируется в настоящий `DisplayElement`, subject с
  `projection: "hud"` — в `HUDElement`, а трёхмерный subject с
  `projection: "space"` — непосредственно в тот же `SpaceElement`. Допустимы
  только `display | hud | space`.
- Служебный Display Storybook заполняет фактическую область preview в HUD.
  Host явно пересчитывает физические атрибуты `width` и `height` как размеры
  этой области, умноженные на `25.4 / 96` мм на логический пиксель; CSS-разрешение
  равно округлённым размерам той же области в px. Авторский `scale` равен `1`.
  Дистанция и параллельный сдвиг общего ViewPoint с целью совмещают поверхность
  с границами preview. Resize окна и панелей обновляет размеры, разрешение и
  раскладку без замены DOM и состояния компонентов. Не фиксировать габариты
  или пропорции служебной поверхности и не брать размеры/PPI монитора устройства.
  Не уменьшать шрифт для подгонки; сохранять стандартную прямую отрисовку.
  Физические дисплеи с явно заданными характеристиками внутри демонстраций
  сохраняют собственный авторский контракт.
- Исполняемый package runtime использует exact marker `storybook-runtime/4`.
  Spatial runtime получает только `context.space` и `mountSpacePreview`;
  implementation objects Renderer и Browser остаются private.
- Шрифт страницы загружается через exact `@zavx0z/engine/default-font` и asset
  `@zavx0z/engine/fonts/inter-regular.ttf`; копии шрифта и запасные owner paths
  запрещены.
- This repository owns its own declaration-driven documentation. Every public contract,
  visible shared behavior, route rule, or example change updates the matching
  self-documentation page and executable example in the same slice. A change is
  not complete while `bun run check` leaves that documentation stale.
- Storybook MCP is the only agent control surface. Agents use `storybook_*`
  tools for lifecycle, search, views, wait, inspection, interaction and capture;
  they never call the Storybook CLI, browser scripts, ports or CDP identities.
- CLI remains a human/diagnostic adapter to the same
  `ExternalStorybookController`; MCP must never spawn or parse it.

## Self documentation lifecycle

- Self documentation is the ordinary root `.storybook/manifest.json` package
  declaration `@zavx0z/storybook`. It is attached to the same single external
  automatic-port server and does not compose stories owned by UI, Node, Engine,
  Renderer, or MetaFor.
- The root page is the same six-region WebGPU Workbench supplied to consumers.
  Every public subpath is a normal typed story in its catalog; live examples
  are variants inside that same route tree. Do not create a second DOM docs
  layout beside the shared Workbench.
- Package catalog JSON, current contracts and executable examples must remain
  aligned. A shared implementation change updates the matching self page.
- After a stable source checkpoint, build with `storybook_check(live:false)`,
  inspect the candidate with `storybook_open`/`storybook_inspect`, then explicitly
  apply with `storybook_check(live:true)` and wait for active. Build alone never
  updates user views. Failed checks preserve the applied revision.
- Public package URLs use /pkg-scope-name for @scope/name. Structural paths encode
  each directory segment: numeric/number becomes /dir-numeric/dir-number.
  Accept only discovered directory chains, never arbitrary mixed directory/story
  paths. Authored subject and variant routes remain unchanged by directory binding.
  Exact production package identities stay unchanged; reject slug collisions
  instead of guessing an identity. Retain old applied URLs until a verified
  revision migrates them.
- User navigation stays in the current tab. Agent open reuses a view currently
  showing its package or creates a background view; never retarget a view the
  user moved to another package. Multiple views per package are valid and all
  follow successful application. Do not restart unrelated package views.

## Delivery safety

- Storybook browser lifecycle is implemented inside Storybook MCP through its
  private direct-CDP controller. Never use `ai-macos`, `@meta/chrome`, a browser
  CLI/script or OS focus as a Storybook dependency or fallback.
- Do not push, create a pull request, deploy Pages, dispatch workflows, or
  create a GitHub repository without a separate explicit owner request.
- Do not stop the one existing external Storybook merely to inspect it. Use
  status/attach/check and preserve its registry, listener and package tabs.
- Automated captures are evidence candidates, not owner acceptance.
- TypeScript and JavaScript changes use no trailing semicolons unless syntax
  requires one.
