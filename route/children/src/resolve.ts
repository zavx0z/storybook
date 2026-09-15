import {resolveRoute} from "../.."
import type {ReadRouteChildrenInput} from "../contract/input"
import type {ReadRouteChildrenOutput} from "../contract/output"

/** Разрешает набор имён как один следующий уровень указанного родителя. */
export async function resolveImmediateChildren(
  names: readonly string[],
  parentNode: string,
  roots: ReadRouteChildrenInput["roots"],
): Promise<ReadRouteChildrenOutput> {
  const children: NonNullable<Awaited<ReturnType<typeof resolveRoute>>>[] = []
  for (const name of names) {
    const route = parentNode === "" ? name : `${parentNode}/${name}`
    const child = await resolveRoute({route, roots})
    if (child !== null) children.push(child)
  }
  return children
}
