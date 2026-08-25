/**
Real `@ui/components/button` example owned by the Storybook documentation app.

The story receives its event bridge from the eager registry. Its preview and
generated source therefore describe the same current arguments without moving
Button semantics into shared Storybook infrastructure.

@packageDocumentation
*/

import {Button} from "@ui/components/button"
import {
  defineStorybookStoryModule,
  type StorybookStoryArgs,
  type StorybookStoryModule,
} from "@zavx0z/storybook/stories"
import type {StorybookWorkbenchButtonPreset} from "../stories.ts"

type WorkbenchButtonArgs = StorybookStoryArgs & Readonly<{
  variant: "contained" | "outlined" | "glass"
  disabled: boolean
}>

/**
Creates one live documentation story from a route-owned initial state.

`onClick` remains page-owned so the shared story contract does not acquire an
event bus or domain switch.
*/
export function createStorybookWorkbenchButtonStory(
  preset: StorybookWorkbenchButtonPreset,
  onClick: () => void,
): StorybookStoryModule {
  return defineStorybookStoryModule<WorkbenchButtonArgs>({
    defaultArgs: {
      variant: preset.variant,
      disabled: preset.disabled,
    },
    controls: [
      {
        key: "variant",
        label: "Вид",
        group: "Кнопка",
        kind: "select",
        options: [
          {value: "contained", label: "Заполненная"},
          {value: "outlined", label: "Контурная"},
          {value: "glass", label: "Стекло"},
        ],
      },
      {
        key: "disabled",
        label: "Недоступна",
        group: "Состояние",
        kind: "boolean",
      },
    ],
    render(surface, args, frame) {
      const width = Math.min(240, Math.max(160, frame.w * 0.36))
      const height = 40
      Button(
        surface,
        frame.x + (frame.w - width) / 2,
        frame.y + frame.h * 0.58 - height / 2,
        width,
        height,
        {
          children: "Проверить пример",
          variant: args.variant,
          color: "primary",
          disabled: args.disabled,
          onClick,
        },
      )
    },
    source(args) {
      return [
        'import {Button} from "@ui/components/button"',
        "",
        "Button(surface, x, y, 240, 40, {",
        '  children: "Проверить пример",',
        `  variant: ${JSON.stringify(args.variant)},`,
        '  color: "primary",',
        ...(args.disabled ? ["  disabled: true,"] : []),
        "  onClick: () => console.log(\"Нажатие\"),",
        "})",
      ].join("\n")
    },
  })
}
