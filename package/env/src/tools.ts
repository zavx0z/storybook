import type {StorybookPackageEnv as Contract} from "../contract"

/** Публичные источники обязательных файловых возможностей, без загрузки модулей. */
export function tools(): Record<string, Contract.Output["tools"][string]> {
  return Object.fromEntries(["stat", "read", "read-many", "list", "write", "create", "mkdir", "remove", "rename", "apply-patch"].map(name => {
    const owner = `@zavx0z/ai-filesystem-${name}`
    return [`filesystem.${name}`, {
      implementation: {package: owner, export: "."},
      description: {package: owner, path: "description.json"},
    }]
  }))
}
