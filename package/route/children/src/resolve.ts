import resolveRoute from "@route/resolve"
import type {RouteChildren} from "../contract"

/** Разрешает набор имён как один следующий уровень указанного родителя. */
export async function resolveImmediateChildren(
  names: readonly string[],
  parentNode: string,
  roots: RouteChildren.Input["roots"],
): Promise<RouteChildren.Output> {
  const children: NonNullable<Awaited<ReturnType<typeof resolveRoute>>>[] = []
  for (const name of names) {
    const route = parentNode === "" ? name : `${parentNode}/${name}`
    const child = await resolveRoute({route, roots})
    if (child !== null) children.push(child)
  }
  return children
}
