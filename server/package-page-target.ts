import type {StorybookPackageSessionSnapshot} from "../sessions/package-session.ts"
import type {
  StorybookPackageRevisionGraphSnapshot,
  StorybookPackageRevisionRoute,
} from "../sessions/package-revision.ts"

/**
Причина, по которой cold page получает выбранную revision.

`navigation-candidate` остаётся server-selected кандидатом: browser может
проверить его для навигации, но не получает права применить произвольную revision.
`preview` принадлежит явному URL пользователя и никогда не становится autoapply.
*/
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
Она служит fallback только при неудаче candidate application.
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
    initialAppliedRevision: input.snapshot.activeRevision,
    fallbackRevision: revision === builtRevision
      ? input.snapshot.activeRevision ?? input.snapshot.lastWorkingRevision ?? input.snapshot.lastGoodRevision
      : null,
    graphSnapshot: selected.graphSnapshot,
  })
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
