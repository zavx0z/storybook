/** Проверки адаптера общего fill: штатный native delegate владеет изменением value и событиями. */
import {expect, test} from "bun:test"
import {createDocument, type HTMLInputElement, type HTMLTextAreaElement} from "@zavx0z/immersive"
import {boundedFillText, boundedText, fillTextControl} from "../src/actions"

test.each([
  {tag: "textarea" as const, value: ""},
  {tag: "textarea" as const, value: "Новый текст\nВторая строка"},
  {tag: "input" as const, value: "Новый текст"},
])("fill $tag передаёт полную замену через native input", ({tag, value}) => {
  const f = fixture(tag)
  fillTextControl(f.control, {text: value}, f.shell)
  expect(f.document.activeElement, "Focus выбирает точную semantic цель").toBe(f.control)
  expect(f.calls, "Native delegate получает выделенное исходное значение и полный новый текст").toEqual([
    {text: value, start: 0, end: "Исходный текст".length, currentValue: "Исходный текст"},
  ])
  expect(f.control.value, "Адаптер самостоятельно не заменяет value").toBe("Исходный текст")
  expect(f.focuses(), "Адаптер использует публичный focus").toBe(1)
})

test("fill не сообщает успех при отказе native beforeinput", () => {
  const f = fixture("textarea", false)
  expect(() => fillTextControl(f.control, "", f.shell), "Отказ native input остаётся ошибкой управления").toThrow("fill input was rejected")
  expect(f.calls, "Пустая строка дошла до native пути, а не была отфильтрована валидатором").toHaveLength(1)
  expect(f.control.value, "При отказе адаптер не обходит input owner присваиванием value").toBe("Исходный текст")
})

test.each(["disabled", "readOnly"] as const)("fill отклоняет %s до фокуса и выделения", property => {
  const f = fixture("textarea")
  f.control[property] = true
  const previous = [f.control.selectionStart, f.control.selectionEnd]
  expect(() => fillTextControl(f.control, "новый", f.shell)).toThrow("disabled or readonly")
  expect(f.focuses(), "Отказ не меняет фокус").toBe(0)
  expect([f.control.selectionStart, f.control.selectionEnd], "Отказ не меняет диапазон").toEqual(previous)
  expect(f.calls, "Readonly и disabled не передаются native delegate").toEqual([])
})

test.each(["number", "email", "checkbox"])("fill отклоняет unsupported input %s до эффектов", type => {
  const f = fixture("input")
  f.control.type = type
  expect(() => fillTextControl(f.control, "новый", f.shell)).toThrow("textarea or text-like input")
  expect(f.focuses(), "Unsupported control не фокусируется").toBe(0)
  expect(f.calls, "Unsupported control не передаётся native delegate").toEqual([])
})

test("disabled fieldset не позволяет focus и не начинает замену", () => {
  const f = fixture("textarea")
  const fieldset = f.document.createElement("fieldset")
  fieldset.setAttribute("disabled", "")
  f.document.documentElement!.append(fieldset)
  fieldset.append(f.control)
  const previous = [f.control.selectionStart, f.control.selectionEnd]
  expect(() => fillTextControl(f.control, "новый", f.shell)).toThrow("cannot receive focus")
  expect(f.focuses(), "Публичный focus соблюдает disabled ancestor").toBe(0)
  expect([f.control.selectionStart, f.control.selectionEnd]).toEqual(previous)
  expect(f.calls).toEqual([])
})

test("detached поле отклоняется до фокуса и ввода", () => {
  const f = fixture("textarea")
  f.control.remove()
  expect(() => fillTextControl(f.control, "новый", f.shell)).toThrow("active Document")
  expect(f.focuses()).toBe(0)
  expect(f.calls).toEqual([])
})

test.each([
  {value: null},
  {value: 3},
  {value: {}},
  {value: []},
  {value: "x".repeat(4097)},
  {value: "\u0000"},
])("fill отклоняет недопустимое значение до эффектов", ({value}) => {
  const f = fixture("textarea")
  const previous = [f.control.selectionStart, f.control.selectionEnd]
  expect(() => fillTextControl(f.control, value, f.shell)).toThrow("fill value must be bounded text")
  expect(f.focuses()).toBe(0)
  expect([f.control.selectionStart, f.control.selectionEnd]).toEqual(previous)
  expect(f.calls).toEqual([])
})

test("отдельная проверка fill разрешает пустой текст, прежний type остаётся непустым", () => {
  expect(boundedFillText("", 4096)).toBe("")
  expect(() => boundedText("", 4096, "type value")).toThrow("bounded text")
})

function fixture<Tag extends "input" | "textarea">(tag: Tag, accepted = true) {
  const document = createDocument()
  const host = document.createElement("div")
  document.append(host)
  const control = document.createElement(tag)
  control.value = "Исходный текст"
  host.append(control)
  let focusCount = 0
  control.addEventListener("focus", () => { focusCount += 1 })
  const calls: Array<Readonly<{text: string, start: number | null, end: number | null, currentValue: string}>> = []
  const shell = {
    document,
    dispatchNativeText(target: HTMLInputElement | HTMLTextAreaElement, text: string) {
      calls.push({text, start: target.selectionStart, end: target.selectionEnd, currentValue: target.value})
      return accepted
    },
  }
  return {document, control, shell, calls, focuses: () => focusCount}
}
