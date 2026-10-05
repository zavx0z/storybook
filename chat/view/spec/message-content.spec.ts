import {expect, test} from "bun:test"
import {messageContent} from "../src/message-content"

test("текстовые дельты сохраняют пробелы и Markdown без дополнительных разделителей", () => {
  const chunks = ["В", "ижу ", "**", "два", "**", "\n\n`", "``ts\n", "const n = 2\n", "```"]
  const input = chunks.map(text => ({type: "text" as const, text}))
  const saved = structuredClone(input)
  expect(messageContent(input)).toEqual([{type: "text", text: chunks.join("")}])
  expect(input).toEqual(saved)
})

test("мультимедиа остаётся между текстовыми группами и сохраняет исходные данные", () => {
  const image = {type: "image" as const, data: "aGVsbG8=", mimeType: "image/png"}
  const audio = {type: "audio" as const, data: "aGVsbG8=", mimeType: "audio/wav"}
  const blocks = messageContent([
    {type: "text", text: "До"}, {type: "text", text: " изображения"}, image,
    {type: "text", text: "После"}, {type: "text", text: " изображения"}, audio,
  ])
  expect(blocks).toEqual([
    {type: "text", text: "До изображения"}, image,
    {type: "text", text: "После изображения"}, audio,
  ])
  expect(blocks[1]).toBe(image)
  expect(blocks[3]).toBe(audio)
  expect(messageContent([])).toEqual([])
})
