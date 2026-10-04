/** Начальный жизненный цикл сессии пакета без запроса компиляции или сервера. */
import {afterAll, describe, expect, mock, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import Revision, {type StorybookPackageRevision} from "@zavx0z/storybook-package-revision"
import StorybookPackageSession from "@zavx0z/storybook-package-session"

describe.each([
  {name: "Новая сессия", props: {subscriber: false, resolutionError: null}},
  {name: "Подписчик новой сессии", props: {subscriber: true, resolutionError: null}},
  {name: "Неразрешённая декларация", props: {subscriber: false, resolutionError: "Вход пакета не найден"}},
])("$name", async ({props}) => {
  const root = mkdtempSync(join(tmpdir(), "storybook-session-scenario-"))
  const packageId = "@example/session"
  const sourcePath = join(root, "package.json")
  writeFileSync(sourcePath, JSON.stringify({name: packageId}))
  const declarationDigest = "example-declaration"
  const graphSnapshot = packageGraph(packageId, declarationDigest)
  const buildRevision = mock(async () => {
    throw new Error("Начальный снимок не заказывает компиляцию")
  })
  const session = new StorybookPackageSession({
    packageId,
    packageRoot: root,
    repo: root,
    sourcePath,
    declarationDigest,
    graphSnapshot,
  }, {
    artifactRoot: join(root, "artifacts"),
    buildRevision,
  })
  const unsubscribe = props.subscriber ? session.subscribe() : null
  if (props.resolutionError !== null) session.setResolutionError(props.resolutionError)
  const result = session.snapshot()

  afterAll(async () => {
    unsubscribe?.()
    await session.dispose()
    rmSync(root, {recursive: true, force: true})
  })

  test("Идентичность и отсутствие ревизии", () => {
    expect(result.packageId, "Новый владелец сохраняет identity переданного пакета").toBe(packageId)
    expect(result.activeRevision, "До проверки и применения пакет не имеет активной ревизии").toBeNull()
    expect(result.builds, "Чтение начального снимка не заказывает сборку").toBe(0)
    expect(buildRevision.mock.calls, "Подготовка ревизии начинается только по явному запросу").toEqual([])
  })

  test("Состояние допуска", () => {
    expect(result.pendingOperationId, "Начальный жизненный цикл не удерживает место в общей очереди").toBeNull()
    expect(result.subscribers, "Подписка учитывается отдельно от запроса сборки")
      .toBe(props.subscriber ? 1 : 0)
  })

  /** @remarks Наблюдение проверяется у варианта с подключённым подписчиком. */
  describe.skipIf(!props.subscriber)("Подписка", () => {
    test("Наблюдение без сборки", () => {
      expect(result.buildState, "Подписчик может наблюдать пакет до первой компиляции").toBe("idle")
      expect(result.diagnostics, "Подписка сама по себе не создаёт ошибку пакета").toEqual([])
    })
  })

  /** @remarks Диагностика отказа применима к варианту неразрешённой декларации. */
  describe.skipIf(props.resolutionError === null)("Ошибка декларации", () => {
    test("Отказ до компиляции", () => {
      expect(result.buildState, "Ошибка разрешения видна без запуска компилятора").toBe("failed")
      expect(result.diagnostics, "Снимок указывает причину и фазу отказа")
        .toEqual([{phase: "resolve", message: props.resolutionError!, path: realpathSync(sourcePath)}])
    })
  })
})

/** Готовит точный граф одного пакета как вход, не создавая сессию или сборку. */
function packageGraph(packageId: string, declarationDigest: string): ReturnType<StorybookPackageRevision.Output["create"]> {
  const rootId = `package:${packageId}`
  const urlPath = `/packages/${encodeURIComponent(packageId)}/`
  const withoutDigest = {
    protocol: Revision.protocol,
    packageId,
    declarationDigest,
    metadata: {parentId: null, label: packageId, ownerId: packageId, urlPath},
    ancestors: [],
    rootId,
    nodes: [{
      id: rootId, kind: "package" as const, ownerId: packageId, packageId, label: packageId,
      parentId: null, childIds: [], urlPath, routePath: "", searchTerms: [packageId],
      resourceUrl: `resources/nodes/${encodeURIComponent(rootId)}/`,
    }],
    routes: [{path: "", urlPath, kind: "overview" as const, nodeId: rootId}],
    resources: [],
    workbenchAuthorStyleSheets: [],
  }
  return Object.freeze({
    ...withoutDigest,
    packageGraphDigest: createHash("sha256").update(JSON.stringify(withoutDigest)).digest("hex"),
  })
}
