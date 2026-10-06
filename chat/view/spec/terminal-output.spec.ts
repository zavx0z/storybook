import {expect, test} from "bun:test"
import {readTerminalOutput, terminalSegments} from "../src/terminal-output"

test("точный terminal delta показывает данные; неизвестный stream не объявляется stderr", () => {
  expect(readTerminalOutput({_meta: {terminal_output_delta: {terminal_id: "t", data: "Traceback\n"}}})).toEqual({known: true, terminalId: "t", chunks: [{stream: "combined", text: "Traceback\n"}]})
  expect(readTerminalOutput({_meta: {terminal_output_delta: {terminal_id: "t", stream: "stderr", data: "Error"}}}).chunks).toEqual([{stream: "stderr", text: "Error"}])
})
test("stdout/stderr/exit результата читаются как поля, текст ожидания не становится execution state", () => {
  expect(readTerminalOutput({rawOutput: {stdout: "out", stderr: "err", exit_code: 7}})).toEqual({known: true, chunks: [{stream: "stdout", text: "out"}, {stream: "stderr", text: "err"}], exit: {code: 7, signal: null}})
  expect(readTerminalOutput({content: [{type: "content", content: {type: "text", text: "Waiting for approval"}}]})).toEqual({known: false, chunks: []})
})

test("соседние chunks одного канала соединяются, межканальный порядок сохраняется", () => {
  expect(terminalSegments([{stream: "stdout", text: "one"}, {stream: "stdout", text: "two"}, {stream: "stderr", text: "error"}, {stream: "stdout", text: "three"}]))
    .toEqual([{stream: "stdout", text: "onetwo"}, {stream: "stderr", text: "error"}, {stream: "stdout", text: "three"}])
})
