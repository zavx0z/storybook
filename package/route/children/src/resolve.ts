import resolveRoute from "@zavx0z/storybook-package-route-resolve"
import type {Zavx0zStorybookPackageRouteChildren} from "../contract"

/** Разрешает набор имён как один следующий уровень указанного родителя. */
export async function resolveImmediateChildren(
  names: readonly string[],
  parentNode: string,
  roots: Zavx0zStorybookPackageRouteChildren.Input["roots"],
): Promise<Zavx0zStorybookPackageRouteChildren.Output> {
  const children: NonNullable<Awaited<ReturnType<typeof resolveRoute>>>[] = []
  for (const name of names) {
    const route = parentNode === "" ? name : `${parentNode}/${name}`
    const child = await resolveRoute({route, roots})
    if (child !== null) children.push(child)
  }
  return children
}
