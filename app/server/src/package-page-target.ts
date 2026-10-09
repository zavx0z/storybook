
/**
Причина, по которой cold page получает выбранную revision.

`navigation-candidate` остаётся server-selected кандидатом: browser может
проверить его для навигации, но не получает права применить произвольную revision.
`preview` принадлежит явному URL пользователя и никогда не становится autoapply.
*/
import {type StorybookPackageSession as PackageSessionContract} from "@zavx0z/storybook-package-session"
import {type StorybookPackageRevision as PackageRevisionContract} from "@zavx0z/storybook-package-revision"
type StorybookPackageSession = PackageSessionContract.Output
type StorybookPackageSessionSnapshot = ReturnType<PackageSessionContract.Output["snapshot"]>
type StorybookPackageRevisionGraphSnapshot = ReturnType<PackageRevisionContract.Output["create"]>
type StorybookPackageRevisionRoute = ReturnType<PackageRevisionContract.Output["create"]>["routes"][number]
export type StorybookPackageBootstrapIntent = "reader" | "navigation-candidate" | "preview"

/**
Серверное чтение immutable revision перед построением HTML target.

@property graphSnapshot - Canonical navigation и presentation graph именно этой revision.
Он не заменяется current session graph при preview или candidate navigation.

@property entryRelativePath - Путь entry внутри revision directory, уже проверенный владельцем artifact.

@property status - Lifecycle record, по которому {@link resolveStorybookPackagePageTarget}
отделяет применимые revision от failed preview.
*/
export type StorybookPackagePageRevision = Readonly<{
  graphSnapshot: StorybookPackageRevisionGraphSnapshot
  entryRelativePath: string
  /** Точная платформа payload; отсутствие означает сборку прежнего формата. */
  sharedModuleEpoch?: string | undefined
  status: "built" | "activating" | "working" | "failed"
}>

/**
Единственный server-owned результат выбора cold page.

Revision variant несёт только URL внутри exact package revision. Fallback не
придумывает revision и ждёт подтверждённое `package.applied-state`; redirect
вариант не создаёт executable bootstrap payload.

@property payloadUrl - Same-origin `revision-payload.js` для bounded prepare transport.
Payload остаётся в page realm и сверяется browser entry до применения.

@property initialAppliedRevision - Последняя server-confirmed working revision на момент HTML response.
Она служит fallback только при неудаче candidate application и совпадении платформы.
Ревизия другой платформы сохраняется в session, но не загружается в общий workspace.
*/
export type StorybookPackagePageTarget = Readonly<{
  kind: "revision"
  packageId: string
  revision: string
  revisionUrl: string
  payloadUrl: string
  entryRelativePath: string
  route: StorybookPackageRevisionRoute
  intent: StorybookPackageBootstrapIntent
  preview: boolean
  initialAppliedRevision: string | null
  fallbackRevision: string | null
  graphSnapshot: StorybookPackageRevisionGraphSnapshot
}> | Readonly<{
  kind: "fallback"
  packageId: string
  revision: null
  intent: "reader"
  preview: false
  initialAppliedRevision: string | null
}> | Readonly<{
  kind: "redirect-preview"
  packageId: string
}>

/**
Выбирает один server-owned target для cold HTML и same-page prepare transport.

Обычный переход предпочитает только current-generation built candidate. Явный
preview сохраняет requested revision и никогда не получает право autoapply.
Ревизия прежнего формата без точной платформы, а также несовместимая с
опубликованной платформой обычного перехода, открывает текущую оболочку
без executable payload; сохранённые active и lastWorking остаются у сессии.

@param input - Согласованный session snapshot, маршрут текущей страницы и resolver
immutable revision records. `currentRoute` передаёт node identity, поэтому тот же
route name из другой revision не выбирается по совпадению строки.

@returns Exact revision, fallback либо redirect target без filesystem paths.

@throws {@link Error}, если selected revision отсутствует, failed preview требует
redirect или route не входит в revision graph.

@example
```ts
const target = resolveStorybookPackagePageTarget({
  packageId: "@scope/package",
  routePath: "controls/default",
  previewRevision: null,
  currentRoute: {nodeId: "variant:@scope/package/controls/default", kind: "variant"},
  snapshot,
  readRevision,
})
```
*/
export function resolveStorybookPackagePageTarget(input: Readonly<{
  packageId: string
  routePath: string
  previewRevision: string | null
  /** Опубликованная платформа обычной навигации; exact preview выбирает собственную. */
  platformEpoch?: string
  currentRoute: Pick<StorybookPackageRevisionRoute, "nodeId" | "kind"> | null
  snapshot: StorybookPackageSessionSnapshot
  readRevision(revision: string): StorybookPackagePageRevision | null
}>): StorybookPackagePageTarget {
  const builtRevision = currentBuiltRevision(input.snapshot, input.readRevision)
  const revision = input.previewRevision ?? builtRevision ??
    input.snapshot.activeRevision ?? input.snapshot.lastWorkingRevision ?? null
  if (revision === null) {
    return Object.freeze({
      kind: "fallback",
      packageId: input.packageId,
      revision: null,
      intent: "reader",
      preview: false,
      initialAppliedRevision: input.snapshot.activeRevision,
    })
  }
  const selected = input.readRevision(revision)
  if (selected === null) throw new Error(`Storybook revision target is missing: ${input.packageId}:${revision}`)
  if (input.previewRevision !== null && selected.status === "failed") {
    return Object.freeze({kind: "redirect-preview", packageId: input.packageId})
  }
  if (selected.sharedModuleEpoch === undefined || input.previewRevision === null && input.platformEpoch !== undefined && selected.sharedModuleEpoch !== input.platformEpoch) {
    return Object.freeze({
      kind: "fallback",
      packageId: input.packageId,
      revision: null,
      intent: "reader",
      preview: false,
      initialAppliedRevision: null,
    })
  }
  let route = selected.graphSnapshot.routes.find(candidate =>
    candidate.nodeId === input.currentRoute?.nodeId && candidate.kind === input.currentRoute?.kind) ??
    selected.graphSnapshot.routes.find(candidate => candidate.path === input.routePath)
  if (route === undefined && input.previewRevision === null && input.currentRoute !== null) {
    route = selected.graphSnapshot.routes.find(candidate => candidate.path === "")
  }
  if (route === undefined) {
    throw new Error(`Unknown Storybook revision route: ${input.packageId}:${input.routePath}`)
  }
  const preview = input.previewRevision !== null
  const intent: StorybookPackageBootstrapIntent = preview
    ? "preview"
    : revision === builtRevision && revision !== input.snapshot.activeRevision
      ? "navigation-candidate"
      : "reader"
  const compatible = (candidate: string | null | undefined): candidate is string => candidate != null &&
    input.readRevision(candidate)?.sharedModuleEpoch === selected.sharedModuleEpoch
  const fallbackRevision = revision === builtRevision
    ? [input.snapshot.activeRevision, input.snapshot.lastWorkingRevision, input.snapshot.lastGoodRevision].find(compatible) ?? null
    : null
  const initialAppliedRevision = compatible(input.snapshot.activeRevision) ? input.snapshot.activeRevision : null
  const revisionUrl = `/__storybook/revisions/${encodeURIComponent(input.packageId)}/${revision}/`
  return Object.freeze({
    kind: "revision",
    packageId: input.packageId,
    revision,
    revisionUrl,
    payloadUrl: `${revisionUrl}revision-payload.js`,
    entryRelativePath: selected.entryRelativePath,
    route,
    intent,
    preview,
    initialAppliedRevision,
    fallbackRevision,
    graphSnapshot: selected.graphSnapshot,
  })
}

/**
Подготавливает обычный переход при отсутствии ревизии или несовпадении её
платформы с опубликованной. Та же платформа переиспользует payload без проверки
редактируемых исходников. Строится только выбранный пакет через его session.
Preview читает точную запрошенную ревизию и никогда не создаёт новую сборку.
Общая session объединяет одновременные запросы; отмена одного ожидания не
отменяет её полезную работу. Ошибка подготовки сохраняет прежние artifacts.
Если первая сборка не удалась и рабочей ревизии нет, страница получает fallback;
состояние `failed` и diagnostics остаются у session. Отмена и неверный route
не превращаются в fallback.
*/
export async function prepareStorybookPackagePageTarget(input: Readonly<{
  session: StorybookPackageSession
  routePath: string
  previewRevision: string | null
  /** Опубликованная платформа обычной навигации; exact preview выбирает собственную. */
  platformEpoch?: string
  currentRoute: Pick<StorybookPackageRevisionRoute, "nodeId" | "kind"> | null
  signal: AbortSignal
}>): Promise<StorybookPackagePageTarget> {
  const read = (alignPlatform = true): StorybookPackagePageTarget => {
    const snapshot = input.session.snapshot()
    return resolveStorybookPackagePageTarget({
      packageId: input.session.packageId,
      routePath: input.routePath,
      previewRevision: input.previewRevision,
      ...(alignPlatform && input.platformEpoch !== undefined ? {platformEpoch: input.platformEpoch} : {}),
      currentRoute: input.currentRoute,
      snapshot,
      readRevision(revision) {
        const record = snapshot.revisions?.find(candidate => candidate.revision === revision)
        const graphSnapshot = input.session.revisionGraphSnapshot(revision)
        if (record === undefined || graphSnapshot === null || input.session.revisionDirectory(revision) === null) return null
        return {graphSnapshot, entryRelativePath: record.entryRelativePath, status: record.status, sharedModuleEpoch: record.sharedModuleEpoch}
      },
    })
  }
  input.signal.throwIfAborted()
  const available = read(false)
  if (input.previewRevision !== null) return available
  const snapshot = input.session.snapshot()
  const existing = available.kind === "revision" ? available.revision
    : snapshot.builtRevision ?? snapshot.activeRevision ?? snapshot.lastWorkingRevision ?? null
  const epoch = existing === null ? undefined : snapshot.revisions?.find(record => record.revision === existing)?.sharedModuleEpoch
  if (existing !== null && input.platformEpoch !== undefined && epoch !== input.platformEpoch) {
    await input.session.build({owner: "open", reason: "toolchain-changed"})
  } else if (available.kind === "fallback") {
    await input.session.ensureBuilt({owner: "open"})
  } else return read()
  input.signal.throwIfAborted()
  return read()
}

function currentBuiltRevision(
  snapshot: StorybookPackageSessionSnapshot,
  readRevision: (revision: string) => StorybookPackagePageRevision | null,
): string | null {
  const revision = snapshot.builtRevision ?? null
  if (revision === null) return null
  const record = readRevision(revision)
  if (record === null || record.status !== "built" && record.status !== "activating") return null
  const snapshotRecord = snapshot.revisions?.find(candidate => candidate.revision === revision)
  if (snapshotRecord === undefined || snapshot.generation !== undefined &&
    snapshotRecord.generation !== snapshot.generation) return null
  return revision
}
