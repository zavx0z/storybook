import {Pane} from "@ui/components/pane"
import {Typography} from "@ui/components/typography"
import {flexColumn} from "@layout/core/flex"
import {defineStorybookStoryModule, type StorybookStoryModule} from "@zavx0z/storybook/stories"

export function createStorybookOverviewStory(input: Readonly<{
  title: string
  items: readonly Readonly<{label: string; route: string}>[]
}>): StorybookStoryModule {
  return defineStorybookStoryModule({
    defaultArgs: {},
    controls: [],
    render(surface, _args, frame) {
      flexColumn({
        x: frame.x,
        y: frame.y,
        w: frame.w,
        h: frame.h,
        gap: 10,
        items: input.items.map((item) => ({
          height: "1fr" as const,
          draw: (x: number, y: number, w: number, h: number) => {
            Pane(surface, x, y, w, h, {variant: "outlined"})
            Typography(surface, x + 14, y + 12, w - 28, 24, {children: item.label, variant: "title"})
            Typography(surface, x + 14, y + 40, w - 28, 20, {
              children: `/${item.route}/`,
              variant: "caption",
              color: "muted",
            })
          },
        })),
      })
    },
    source() {
      return {
        html: `<section class="overview">
  <h2 class="overview__title">${escapeHtml(input.title)}</h2>
  <nav class="overview__items" aria-label="${escapeHtml(input.title)}">
${input.items.map(({label, route}) => `    <a class="overview__item" href="/${route}/">
      <strong>${escapeHtml(label)}</strong>
      <span>/${escapeHtml(route)}/</span>
    </a>`).join("\n")}
  </nav>
</section>`,
        css: `.overview {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  gap: 10px;
}

.overview__title {
  margin: 0;
  font-size: 18px;
}

.overview__items {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 10px;
}

.overview__item {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid #1a1a1a;
  border-radius: 4px;
  color: #e8e8e8;
  background: #303030;
  text-decoration: none;
}`,
        typescript: [
          `export const title = ${JSON.stringify(input.title)}`,
          "export const items = [",
          ...input.items.map(({label, route}) => `  {label: ${JSON.stringify(label)}, route: ${JSON.stringify(route)}},`),
          "] as const",
        ].join("\n"),
      }
    },
  })
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
