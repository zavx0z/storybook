/** Browser сохраняет одно пространство при выборе пакета и корня Project. */
import {afterAll, describe, expect, test} from "bun:test"
import {mkdtempSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createStorybookBrowserLifecycle, {type StorybookAppServerBrowser} from "@zavx0z/storybook-app-server-browser"

describe.each([
  {name: "Нет вкладок", props: {targets: []}},
  {name: "Чужая страница", props: {targets: [{targetId: "foreign", type: "page", title: "Other", url: "https://example.com/"}]}},
  {name: "Общее пространство разных предметов", props: {targets: []}},
])("$name", async ({name, props}) => {
  const root = mkdtempSync(join(tmpdir(), "storybook-browser-scenario-"))
  afterAll(() => rmSync(root, {recursive: true, force: true}))
  const origin = "http://127.0.0.1:43123"
  let created = 0
  let navigated = 0
  let current: {targetId: string; type: string; title: string; url: string} | null = null
  const identity = () => {
    const pathname = new URL(current!.url).pathname
    const packageId = pathname === "/" ? null : pathname.slice("/pkg-".length).replace(/\/$/u, "")
    return {protocol: "external-storybook-agent-bridge/1", packageId, route: "", revision: packageId === null ? null : "revision",
      graphDigest: null, ready: true, presented: true, timeOrigin: 42,
      viewName: "storybook:workspace",
      markers: {package: "ready", packageId, route: "", revision: packageId === null ? null : "revision"},
      capabilities: {inPageNavigation: true}}
  }
  const chrome = {
    ensure: async () => {},
    targets: async () => current === null ? props.targets : [...props.targets, current],
    cdpOrigin: async () => "http://127.0.0.1:9222",
    browserIdentity: async () => "a".repeat(64),
    createTarget: async (url: string) => {created += 1; current = {targetId: "SPACE", type: "page", title: "Storybook", url}; return current},
    waitReady: async () => {},
    callBridge: async (_targetId: string, method: string, params: {url: string}) => {
      if (method === "navigate") {navigated += 1; current = {...current!, url: new URL(params.url, origin).href}}
      return identity()
    },
  } as unknown as NonNullable<StorybookAppServerBrowser.Input["chrome"]>
  const lifecycle = createStorybookBrowserLifecycle({chrome, stateRoot: join(root, "state"), captureRoot: join(root, "captures")})
  const views = await lifecycle.listViews(origin)

  test("Публичный инвентарь", () => {
    expect(views, "Пустой набор и посторонняя страница не становятся представлениями Storybook").toEqual([])
  })

  /** @remarks Только вариант переходов открывает предметы; наблюдение инвентаря страниц не создаёт. */
  describe.skipIf(name !== "Общее пространство разных предметов")("Выбор адресов", async () => {
    const first = await lifecycle.openPackage({origin, packageId: "a", route: "", url: `${origin}/pkg-a/`})
    const second = await lifecycle.openPackage({origin, packageId: "b", route: "", url: `${origin}/pkg-b/`})
    const landing = await lifecycle.openPackage({origin, packageId: null, route: "", url: `${origin}/`})

    test("Одна рабочая страница", () => {
      expect(created, "Первое открытие создаёт единственную рабочую страницу").toBe(1)
      expect(navigated, "Следующие адреса выбираются внутри этой страницы").toBe(2)
      expect(second.identity.timeOrigin, "Выбор другого пакета сохраняет browser realm").toBe(first.identity.timeOrigin)
      expect(landing.identity.timeOrigin, "Возврат к Project сохраняет тот же browser realm").toBe(first.identity.timeOrigin)
      expect(landing.view.packageId, "Корень Project не получает фиктивное имя пакета").toBeNull()
      expect(() => lifecycle.getView(first.view.viewId), "Handle прежнего адреса не управляет новым выбором").toThrow("Unknown")
    })
  })
})
