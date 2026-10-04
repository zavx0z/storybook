import resolveRoute from "@storybook-package-route/resolve"
import type {StorybookPackageRouteChildren} from "../contract"

/** Разрешает набор имён как один следующий уровень указанного родителя. */
export async function resolveImmediateChildren(
  names: readonly string[],
  parentNode: string,
  roots: StorybookPackageRouteChildren.Input["roots"],
): Promise<StorybookPackageRouteChildren.Output> {
  const children: NonNullable<Awaited<ReturnType<typeof resolveRoute>>>[] = []
  for (const name of names) {
    const route = parentNode === "" ? name : `${parentNode}/${name}`
    const child = await resolveRoute({route, roots})
    if (child !== null) children.push(child)
  }
  return children
}
