import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, rm, readFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createSettings, {type StorybookAppSettings} from "@zavx0z/storybook-app-settings"

describe.each((["Project", "Repo", "Domain", "Cluster", "Container", "Component"] as const).map(type => ({name: type, props: {type}})))("$name", async ({props}) => {
  const {type} = props
  const project = await mkdtemp(join(tmpdir(), "execution-settings-"))
  afterAll(() => rm(project, {recursive: true, force: true}))
  const settings = createSettings({project})
  const subject = {address: "/example", label: "Предмет", cwd: join(project, "subject"), type}
  const executorId = "исполнитель"
  const initial = await settings.read()
  const updated = await settings.update({...initial, general: {connectionId: "codex", model: "general", thoughtLevel: "low"},
    types: {[type]: {model: "type"}}})
  await settings.updateExecutor({subject, executorId, selection: {thoughtLevel: "high"}})
  const execution = await settings.resolve({subject, executorId, selection: {model: "session"}})

  test("Наследование по каждому полю", () => {
    expect(execution.effective, "Явная беседа задаёт модель, агент — мышление, среда — подключение")
      .toEqual({connectionId: "codex", model: "session", thoughtLevel: "high"})
    expect(execution.sources, "Источники сохраняются независимо по каждому полю")
      .toEqual({connectionId: "general", model: "session", thoughtLevel: "executor"})
  })
  test("Подтверждённый тип", async () => {
    expect((await settings.resolve({subject, executorId, selection: {}})).effective.model,
      "При отсутствии override беседы модель определяется правилом подтверждённого типа").toBe("type")
    expect((await settings.resolve({subject: {...subject, type: "неподтверждённый" as NonNullable<Parameters<StorybookAppSettings.Output["resolve"]>[0]["subject"]["type"]>}, executorId, selection: {}})).effective.model,
      "Неизвестный тип не получает правило по имени или пути").toBe("general")
  })
  test("Сохранение у владельцев", async () => {
    expect(JSON.parse(await readFile(join(project, "meta/settings/execution.json"), "utf8")), "Записанный документ Project соответствует подтверждённой revision").toEqual(updated)
    expect(await settings.readExecutor({subject, executorId}), "Выбор агента сохраняется у предмета независимо от его бесед").toEqual({thoughtLevel: "high"})
    expect(JSON.parse(await readFile(join(project, "meta/settings/execution.json"), "utf8")).connections,
      "Каталог содержит только реально установленное подключение").toEqual([{id: "codex", provider: "codex", label: "Codex", enabled: true}])
  })
  test("Устаревшая запись", async () => {
    await expect(settings.update({...initial, general: {}}),
      "Старый HUD снимок не затирает новую revision").rejects.toThrow("Настройки изменились")
  })
  test("Возврат наследования", async () => {
    const other = "проверяющий"
    await settings.updateExecutor({subject, executorId: other, selection: {model: "override"}})
    await settings.updateExecutor({subject, executorId: other, selection: {}})
    expect((await settings.resolve({subject, executorId: other, selection: {}})).effective.model,
      "Пустой выбор агента удаляет override и возвращает правило типа").toBe("type")
  })
})
