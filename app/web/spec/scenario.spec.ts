/**
Web хранит одну опубликованную оболочку и готовит её только по явному запросу.
Варианты показывают предварительную проверку и публикацию одной среды.
*/
import {afterAll, describe, expect, mock, test} from "bun:test"
import createWeb from "@zavx0z/storybook-app-web"
import {createWebArtifacts} from "./fixture/web-artifacts"

describe.each([
  {name: "Предварительная проверка", props: {apply: false}},
  {name: "Публикация среды", props: {apply: true}},
])("$name", async ({props}) => {
  const fixture = createWebArtifacts()
  const candidate = fixture.assets("platform-a", "web-a")
  const build = mock(async () => candidate)
  const events: string[] = []
  const web = createWeb(fixture.input(build, event => events.push(event.type)))
  afterAll(async () => {
    await web.dispose()
    fixture.dispose()
  })
  const before = web.read()
  const buildsBeforeCheck = build.mock.calls.length
  const checked = await web.check({apply: props.apply}, new AbortController().signal)

  test("Создание и чтение", () => {
    expect(before.phase, "При создании выпуск ещё не готов и не начинает подготовку")
      .toBe("idle")
    expect(buildsBeforeCheck, "Чтение состояния не вызывает компилятор")
      .toBe(0)
  })

  test("Явная проверка среды", () => {
    expect(build.mock.calls, "Проверка подготавливает среду один раз через общую очередь")
      .toHaveLength(1)
    expect(checked, "Результат связывает готовую оболочку с точной платформой")
      .toMatchObject({ok: true, published: props.apply, applied: false, packages: [],
        shared: {sharedModuleEpoch: candidate.browserIdentity!.epoch,
          hostModuleEpoch: candidate.browserIdentity!.hostModuleEpoch}})
    expect(fixture.scheduler.snapshot().recent.map(job => job.owner),
      "Подготовка принадлежит shared-работе общей очереди").toEqual(["shared"])
  })

  test("Наблюдаемая публикация", () => {
    expect(web.platform?.epoch, "Опубликованная платформа появляется только после apply")
      .toBe(props.apply ? candidate.browserIdentity!.epoch : undefined)
    expect(events.filter(type => type === "shared.updated"),
      "Подписчики получают обновление только после публикации")
      .toHaveLength(props.apply ? 1 : 0)
  })

  /** @remarks Доступно только при проверке без apply: опубликованного host ещё нет. */
  describe.skipIf(props.apply)("Кандидат без применения", () => {
    test("Изоляция текущего host", () => {
      expect(() => web.host(), "Предварительная проверка не меняет host открытой страницы")
        .toThrow()
      expect(web.assets(true), "Готовый кандидат доступен для явного просмотра")
        .toEqual(candidate)
    })
  })

  /** @remarks Доступно только после apply: текущая оболочка уже опубликована. */
  describe.skipIf(!props.apply)("Опубликованный host", () => {
    test("Чтение версии", () => {
      expect(web.host().pageEntryUrl, "Страница получает вход опубликованной оболочки")
        .toBe(candidate.browserIdentity!.packageEntryUrl)
      expect(fixture.readPublished()?.browserIdentity?.epoch,
        "Публикация сохраняет проверенный receipt для следующего владельца")
        .toBe(candidate.browserIdentity!.epoch)
    })
  })
})
