import type {Zavx0zStorybookPackageMcpSource} from "@zavx0z/storybook-package-mcp-source"
import type {Zavx0zStorybookPackageMcpNavigation} from "@zavx0z/storybook-package-mcp-navigation"
import type {Zavx0zStorybookPackageMcpContent} from "@zavx0z/storybook-package-mcp-content"

/** Общая форма чтения Package, используемая предметными владельцами. */
export declare namespace Zavx0zStorybookPackageMcp {
  type Input = Readonly<{
    selected: Zavx0zStorybookPackageMcpSource.Output[number]
    entries: Zavx0zStorybookPackageMcpSource.Output
    /** До подтверждения типа маршрутизатор запрашивает только навигацию. */
    includeContent?: boolean
  }>
  type Output = Zavx0zStorybookPackageMcpNavigation.Output & Zavx0zStorybookPackageMcpContent.Output
}
