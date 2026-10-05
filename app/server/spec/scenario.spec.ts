import createWeb from "@zavx0z/storybook-app-web"
import {createProjectFixture} from "../test/project.fixture"
/** Отдельный loopback instance публикует identity и состояние пустого каталога. */
import {afterAll, describe, expect, test} from "bun:test"
import {mkdtempSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import startExternalStorybookServer from "@zavx0z/storybook-app-server"
import createStorybookBrowserLifecycle, {type StorybookAppServerBrowser} from "@zavx0z/storybook-app-server-browser"

describe.each([
  {name: "Проверка доступности", props: {path: "/api/health"}, environment: false},
  {name: "Состояние каталога", props: {path: "/api/status"}, environment: false},
  {name: "Окружение разработчика Project", props: {path: "/api/environment"}, environment: true},
])("$name", async ({props, environment}) => {
  const root = mkdtempSync(join(tmpdir(), "storybook-server-scenario-"))
  const chrome = {targets: async () => []} as unknown as NonNullable<StorybookAppServerBrowser.Input["chrome"]>
  const browserLifecycle = createStorybookBrowserLifecycle({
    chrome,
    stateRoot: join(root, "browser"),
    captureRoot: join(root, "captures"),
  })
  const server = await startExternalStorybookServer({createWeb,

    project: createProjectFixture(root, []),
    port: 0,
    statePath: join(root, "state", "server.json"),
    artifactRoot: join(root, "artifacts"),
    browserLifecycle,
  })
  afterAll(async () => { await server.stop(); rmSync(root, {recursive: true, force: true}) })
  const response = await fetch(new URL(props.path, server.origin), {
    ...(environment ? {headers: {authorization: `Bearer ${server.record.controlToken}`}} : {}),
  })
  const body = await response.json() as Record<string, unknown>

  test("Loopback listener", () => {
    expect(new URL(server.origin).hostname, "Проверочный instance слушает только локальный сетевой интерфейс").toBe("127.0.0.1")
    expect(response.status, "Доступный экземпляр возвращает успешный HTTP ответ").toBe(200)
  })
  /** @remarks Диагностические ответы публикуют identity процесса и версию каталога. */
  describe.skipIf(environment)("Диагностика сервера", () => {
    test("Идентичность", () => {
      expect(body, "Публичная диагностика относится к созданному instance и пустому каталогу").toMatchObject({
        ok: true,
        origin: server.origin,
        instanceId: server.record.instanceId,
        registryRevision: server.registry.snapshot().revision,
      })
    })
  })

  /** @remarks Общий вход окружения раскрывает предмет и команды авторизованного разработчика. */
  describe.skipIf(!environment)("Окружение Project", () => {
    test("Стартовый предмет", () => {
      expect(body.result, "Штатный controlToken предоставляет общий контекст Project до подключения модели")
        .toMatchObject({executorId: "developer:project", subject: {address: "/", type: "Project"}})
    })
    test("Подробности по обращению", () => {
      expect((body.result as {tools: {name: string}[]}).tools.map(tool => tool.name),
        "Стартовое описание включает действительную команду отложенного чтения предметных знаний")
        .toContain("knowledge.read")
    })
    test("Приватные полномочия", () => {
      expect(JSON.stringify(body), "Bootstrap не раскрывает bearer управляющего канала")
        .not.toContain(server.record.controlToken)
    })
    test("Заметки и нормы", async () => {
      const response = await fetch(new URL("/api/environment", server.origin), {
        method: "POST",
        headers: {authorization: `Bearer ${server.record.controlToken}`},
        body: JSON.stringify({name: "knowledge.read", arguments: {}}),
      })
      expect((await response.json()).result.children.map((item: {path: string}) => item.path),
        "Начальное знание даёт точные переходы к заметкам выбранного владельца и нормативным источникам Storybook")
        .toEqual(["./meta/notes", "./rules/documents", "./instructions"])
    })
  })
})
