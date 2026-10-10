import {expect, test} from "bun:test"

const rows = ["text", 42, {value: "object"}, null]
test.each(rows)("pretty %p", value => {expect(rows.includes(value)).toBe(true)})
test.each(rows)("object %o", value => {expect(rows.includes(value)).toBe(true)})
test.each(rows)("json %j", value => {expect(rows.includes(value)).toBe(true)})
test.each(rows)("decimal %d", value => {expect(rows.includes(value)).toBe(true)})
test.each(rows)("integer %i", value => {expect(rows.includes(value)).toBe(true)})
test.each(rows)("float %f", value => {expect(rows.includes(value)).toBe(true)})
test.each(rows)("string %s", value => {expect(rows.includes(value)).toBe(true)})
test.each(rows)("index %# escaped %%", value => {expect(rows.includes(value)).toBe(true)})
test.each([["label", {value: 7}], ["other", {value: 8}]])("tuple %s / %p / %#", (label, value) => {
  expect(label).toBeTypeOf("string")
  expect(value.value).toBeGreaterThan(0)
})
test.each([12.75, NaN, Infinity, undefined])("numeric %d / %i / %f / %p", value => {expect([12.75, NaN, Infinity, undefined].includes(value)).toBe(true)})
const edges = [12.75, NaN, Infinity, undefined]
test.each(edges)("edge integer %i", value => {expect(edges.includes(value)).toBe(true)})
test.each(edges)("edge float %f", value => {expect(edges.includes(value)).toBe(true)})
test.each(edges)("edge pretty %p", value => {expect(edges.includes(value)).toBe(true)})
test.each(edges)("edge object %o", value => {expect(edges.includes(value)).toBe(true)})
test.each(edges)("edge json %j", value => {expect(edges.includes(value)).toBe(true)})
