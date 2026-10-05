import type {StorybookTechAcp} from "@zavx0z/storybook-tech-acp"
import type {Setting} from "../contract/state"

/** Проецирует только предоставленные агентом настройки модели и мышления. */
export function readSettings(options: StorybookTechAcp.Output["configOptions"]): readonly Setting[] {
  return options.flatMap(option => {
    if (option.type !== "select" || option.category !== "model" && option.category !== "thought_level") return []
    return [{id: option.id, category: option.category, name: option.name, value: option.currentValue,
      options: option.options.flatMap(item => "options" in item ? item.options : [item]).map(item => ({
        value: item.value, name: item.name,
        ...(typeof item.description === "string" ? {description: item.description} : {}),
      })),
    }]
  })
}
