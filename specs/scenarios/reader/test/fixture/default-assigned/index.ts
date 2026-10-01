import {readFileSync, writeFileSync} from "node:fs"

function double(input: Readonly<{value: number}>): Readonly<{value: number}> {
  const counter = process.env.STORYBOOK_DEFAULT_ASSIGNED_COUNTER
  if (counter) {
    const before = Number(readFileSync(counter, "utf8"))
    writeFileSync(counter, String(before + 1))
  }
  return {value: input.value * 2}
}

export default Object.assign(double, {unit: "points"})
