import {expect, test} from "bun:test"
import {callLocation} from "../src/call-location"
import {registerCompiledSource, registerInsertions, sourceLocation} from "../src/source-location"

test("native compiler ranges и trace insertions возвращают исходную строку и колонку вызова", () => {
  const path = "/fixture/source-location-native.tsx"
  const original = "const value = call()\n"
  const position = original.indexOf("call")
  const inserted = "trace("
  registerInsertions(path, original, [{position, text: inserted}])
  const instrumented = original.slice(0, position) + inserted + original.slice(position)
  const generated = "import {lower} from 'core'\n"
  const code = generated + instrumented
  registerCompiledSource(path, instrumented, code, [{generatedStart: generated.length, generatedEnd: code.length, sourceStart: 0}])
  expect(sourceLocation({path, line: 2, column: position + inserted.length + 1})).toEqual({path, line: 1, column: position + 1})
  expect(sourceLocation({path, line: 1, column: 1})).toBeNull()
  expect(callLocation(`Error\n    at lower (${path}:1:1)\n    at caller (${path}:2:${position + inserted.length + 1})`)).toEqual({path, line: 1, column: position + 1})
  const installed = "/fixture/installed-source-location-native.tsx"
  registerCompiledSource(installed, instrumented, code, [{generatedStart: generated.length, generatedEnd: code.length, sourceStart: 0}], path)
  expect(sourceLocation({path: installed, line: 2, column: position + inserted.length + 1})).toEqual({path: installed, line: 1, column: position + 1})
})

test("обычный trace без JSX сохраняет прежнее отображение вставок", () => {
  const path = "/fixture/source-location-plain.ts"
  const source = "const value = call()"
  registerInsertions(path, source, [{position: 14, text: "trace("}])
  expect(sourceLocation({path, line: 1, column: 21})).toEqual({path, line: 1, column: 15})
})
