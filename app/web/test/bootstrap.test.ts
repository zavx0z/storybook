/**
Bootstrap не подключает платформу, пока сервер не подтвердил совместимую оболочку.
Варианты покрывают корректную цель с отказом transport, неподтверждённую эпоху,
недопустимый адрес host и несовпадение его платформы.
*/
import {describe, expect, mock, test} from "bun:test"
import bootstrapStorybookPage from "../src/bootstrap"

const requestedEpoch = "a".repeat(64)
const validHost = {
  protocol: "storybook-shared-host/1",
  sharedModuleEpoch: requestedEpoch,
  hostModuleEpoch: "c".repeat(64),
  pageEntryUrl: "/__storybook/shared/host/page.js",
  authorStyleSheets: [],
}

describe.each([
  {name: "Неподтверждённая платформа ревизии", props: {kind: "revision", epoch: null, failure: "missing-epoch", message: "не содержит подтверждённой платформы", requests: 0}},
  {name: "Совместимая цель без доступной оболочки", props: {kind: "revision", epoch: requestedEpoch, failure: "unavailable", message: "409", requests: 1}},
  {name: "Landing с недопустимым адресом host", props: {kind: "landing", epoch: null, failure: "invalid-url", message: "Некорректное описание оболочки", requests: 1}},
  {name: "Сервер вернул другую платформу", props: {kind: "revision", epoch: requestedEpoch, failure: "wrong-epoch", message: "другую платформу", requests: 1}},
])("$name", async ({props}) => {
  const target = props.kind === "landing"
    ? {kind: "landing", pathname: "/", readerToken: "reader"}
    : {
      kind: "revision", packageId: "@fixture/bootstrap", revision: "candidate",
      revisionUrl: "/__storybook/revisions/fixture/candidate/", route: "", urlPath: "/fixture/bootstrap",
      intent: "reader", preview: false, initialAppliedRevision: "candidate", fallbackRevision: "candidate", readerToken: "reader",
    }
  const document = {
    getElementById(id: string) {
      return id === "external-storybook-page-target" ? {localName: "script", textContent: JSON.stringify(target)} : null
    },
    querySelector() {
      return props.epoch === null ? null : {content: props.epoch}
    },
  } as unknown as Document
  const transport = mock(async (_url: RequestInfo | URL, _options?: RequestInit): Promise<Response> => {
    if (props.failure === "unavailable") return new Response("missing", {status: 409})
    return Response.json({...validHost,
      ...(props.failure === "invalid-url" ? {pageEntryUrl: "/outside-shared-page.js"} : {}),
      ...(props.failure === "wrong-epoch" ? {sharedModuleEpoch: "b".repeat(64)} : {}),
    })
  })
  const fetcher = transport as unknown as typeof fetch
  const outcome = await bootstrapStorybookPage(document, fetcher).then(
    () => ({ok: true as const}),
    error => ({ok: false as const, error}),
  )

  test("Отказ до подключения страницы", () => {
    expect(outcome.ok, "Неподтверждённый host не запускает страницу").toBeFalse()
    if (outcome.ok) throw new Error("Bootstrap неожиданно подключил страницу")
    expect(outcome.error, "Bootstrap сохраняет причину отказа транспорта или проверки host").toBeInstanceOf(Error)
    expect(outcome.error.message, "Причина отказа соответствует неподтверждённому условию варианта").toContain(props.message)
  })

  test("Запрос оболочки", () => {
    expect(transport.mock.calls, "Неверная эпоха отклоняется до HTTP; подтверждённая цель запрашивает host один раз")
      .toHaveLength(props.requests)
  })

  /** @remarks Без подтверждённой эпохи HTTP не выполняется; у этого варианта нет адреса и параметров transport. */
  describe.skipIf(props.requests === 0)("Транспорт подтверждённой цели", () => {
    test("Exact host", () => {
      const [url, options] = transport.mock.calls[0]!
      expect(url, "Landing выбирает текущий host; ревизия требует exact epoch своей платформы")
        .toBe(props.kind === "landing" ? "/api/browser/shared" : `/api/browser/shared?sharedModuleEpoch=${requestedEpoch}`)
      expect(options?.headers, "Reader token связывает запрос с серверной целью страницы")
        .toEqual({"x-storybook-session": "reader"})
      expect(options?.signal, "Transport получает собственный сигнал Bootstrap").toBeInstanceOf(AbortSignal)
    })
  })
})
