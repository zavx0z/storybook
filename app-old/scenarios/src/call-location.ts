/**
Находит исходное место вызова за пределами модулей трассировщика.

@packageDocumentation
*/
import {fileURLToPath} from "node:url"
import type {TraceLocation} from "./types"
import {sourceLocation} from "./source-location"

/** Берёт первый внешний frame из stack, используя номера строк Bun sourcemap. */
export function callLocation(stack: string | undefined): TraceLocation | null {
  for (const line of stack?.split("\n").slice(1) ?? []) {
    if (line.includes(import.meta.dir) || line.includes("node:internal") || line.includes("bun:test")) continue
    const match = line.match(/(?:\(|at )((?:file:\/\/)?[^()]+):(\d+):(\d+)\)?$/)
    if (!match?.[1] || !match[2] || !match[3]) continue
    const path = match[1].startsWith("file://") ? fileURLToPath(match[1]) : match[1]
    return sourceLocation({path, line: Number(match[2]), column: Number(match[3])})
  }
  return null
}
