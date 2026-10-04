/** Управляющий запрос допускается только с точной capability текущего сервера. */
import {describe, expect, test} from "bun:test"
import State from "@zavx0z/storybook-app-server-state"

const origin = "http://127.0.0.1:43123"
const controlToken = "a".repeat(43)

describe.each([
  {name: "Чтение состояния", props: {path: "/api/status"}},
  {name: "Управление сборкой", props: {path: "/api/check"}},
])("$name", ({props}) => {
  const authorization = State.externalStorybookControlAuthorization(controlToken)
  const request = new Request(`${origin}${props.path}`, {headers: {authorization}})

  test("Точная авторизация", () => {
    expect(State.externalStorybookControlTokenMatches(authorization, controlToken),
      "Bearer capability совпадает с токеном единственного server instance"
    ).toBeTrue()
    expect(() => State.assertExternalStorybookControlRequest(request, {origin, controlToken}),
      "Управляющий маршрут с каноническим loopback origin и capability допустим"
    ).not.toThrow()
  })
  test("Публикация capability", () => {
    const record = State.createExternalStorybookServerRecord({
      toolRoot: import.meta.dir,
      origin,

    })
    expect(Object.hasOwn(State.projectExternalStorybookServerRecord(record), "controlToken"),
      "Публичная запись сервера не раскрывает секрет управляющего канала"
    ).toBeFalse()
  })
})
