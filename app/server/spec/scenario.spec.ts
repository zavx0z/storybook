import createWeb from "@app/web"
/** Отдельный loopback instance публикует identity и состояние пустого каталога. */
import {afterAll, describe, expect, test} from "bun:test"
import {mkdtempSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import startExternalStorybookServer from "@app/server"
import createStorybookBrowserLifecycle, {type Zavx0zStorybookBrowserLifecycle} from "@zavx0z/storybook-browser-lifecycle"

describe.each([
  {name: "Проверка доступности", props: {path: "/api/health"}},
  {name: "Состояние каталога", props: {path: "/api/status"}},
])("$name", async ({props}) => {
  const root = mkdtempSync(join(tmpdir(), "storybook-server-scenario-"))
  const chrome = {targets: async () => []} as unknown as NonNullable<Zavx0zStorybookBrowserLifecycle.Input["chrome"]>
  const browserLifecycle = createStorybookBrowserLifecycle({
    chrome,
    stateRoot: join(root, "browser"),
    captureRoot: join(root, "captures"),
  })
  const server = await startExternalStorybookServer({createWeb,
    implementationDigest: "a".repeat(64),
    declarations: [],
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
