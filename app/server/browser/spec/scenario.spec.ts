/** Browser lifecycle инвентаризирует только вкладки своего loopback origin. */
import {afterAll, describe, expect, test} from "bun:test"
import {mkdtempSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createStorybookBrowserLifecycle, {type StorybookAppServerBrowser} from "@storybook-app-server/browser"

describe.each([
  {name: "Нет вкладок", props: {targets: []}},
  {name: "Чужая страница", props: {targets: [{targetId: "foreign", type: "page", title: "Other", url: "https://example.com/"}]}},
])("$name", async ({props}) => {
  const root = mkdtempSync(join(tmpdir(), "storybook-browser-scenario-"))
  afterAll(() => rmSync(root, {recursive: true, force: true}))
  const chrome = {targets: async () => props.targets} as unknown as NonNullable<StorybookAppServerBrowser.Input["chrome"]>
  const lifecycle = createStorybookBrowserLifecycle({
    chrome,
    stateRoot: join(root, "state"),
    captureRoot: join(root, "captures"),
  })
  const views = await lifecycle.listViews("http://127.0.0.1:43123")

  test("Публичный инвентарь", () => {
    expect(views, "Пустой набор и посторонняя страница не становятся представлениями Storybook").toEqual([])
  })
})
