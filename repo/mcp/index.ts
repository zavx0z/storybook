/**
Раскрывает Repo агенту из сохранённых сведений Package.
Предметный владелец формирует описание, переходы, схемы контрактов и сценарии.
Чтение не запускает сущность и не исполняет её сценарии.

@packageDocumentation
*/
import navigation from "@zavx0z/storybook-package-mcp-navigation"
import content from "@zavx0z/storybook-package-mcp-content"
import gitStatus from "@zavx0z/ai-git-status"
import gitDescription from "@zavx0z/ai-git-status/description.json" with {type: "json"}
import createTools from "@zavx0z/storybook-package-mcp-tools"
import type {StorybookRepoMcp as Contract} from "./contract"

export type {StorybookRepoMcp} from "./contract"

/** Формирует содержательный ответ Repo, сохраняя точные источники и границы его участников. */
async function readRepoMcp({selected, entries}: Contract.Input): Promise<Contract.Output> {
  return {
    ...navigation({path: selected.path, description: selected.description, entries,
      ...(selected.label === undefined ? {} : {label: selected.label})}),
    ...await content(selected.sources),
  }
}

/** Repo дополняет файловую основу операцией над своим Git-корнем. */
export default Object.assign(readRepoMcp, {
  tools(input: Parameters<typeof createTools>[0]) {
    return createTools({...input, extensions: [
      {name: "git.status", description: gitDescription.description,
        inputSchema: gitDescription.arguments, outputSchema: gitDescription.result,
        annotations: {readOnlyHint: true, destructiveHint: false},
        execute: args => gitStatus(args as Parameters<typeof gitStatus>[0], input.workspace)},
      ...(input.extensions ?? []),
    ]})
  },
})
