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
  {name: "Проверка доступности", props: {path: "/api/health"}},
  {name: "Состояние каталога", props: {path: "/api/status"}},
])("$name", async ({props}) => {
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
  const response = await fetch(new URL(props.path, server.origin))
  const body = await response.json() as Record<string, unknown>

  test("Loopback listener", () => {
    expect(new URL(server.origin).hostname, "Проверочный instance слушает только локальный сетевой интерфейс").toBe("127.0.0.1")
    expect(response.status, "Доступный экземпляр возвращает успешный HTTP ответ").toBe(200)
  })
  test("Идентичность", () => {
    expect(body, "Публичная диагностика относится к созданному instance и пустому каталогу").toMatchObject({
      ok: true,
      origin: server.origin,
      instanceId: server.record.instanceId,
      registryRevision: server.registry.snapshot().revision,
    })
  })
})
