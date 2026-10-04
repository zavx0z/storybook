import statPath from "@zavx0z/ai-filesystem-stat"
import statPathDescription from "@zavx0z/ai-filesystem-stat/description.json" with {type: "json"}
import readFile from "@zavx0z/ai-filesystem-read"
import readFileDescription from "@zavx0z/ai-filesystem-read/description.json" with {type: "json"}
import readFiles from "@zavx0z/ai-filesystem-read-many"
import readFilesDescription from "@zavx0z/ai-filesystem-read-many/description.json" with {type: "json"}
import listFiles from "@zavx0z/ai-filesystem-list"
import listFilesDescription from "@zavx0z/ai-filesystem-list/description.json" with {type: "json"}
import writeFile from "@zavx0z/ai-filesystem-write"
import writeFileDescription from "@zavx0z/ai-filesystem-write/description.json" with {type: "json"}
import createFile from "@zavx0z/ai-filesystem-create"
import createFileDescription from "@zavx0z/ai-filesystem-create/description.json" with {type: "json"}
import makeDirectory from "@zavx0z/ai-filesystem-mkdir"
import makeDirectoryDescription from "@zavx0z/ai-filesystem-mkdir/description.json" with {type: "json"}
import removePath from "@zavx0z/ai-filesystem-remove"
import removePathDescription from "@zavx0z/ai-filesystem-remove/description.json" with {type: "json"}
import renamePath from "@zavx0z/ai-filesystem-rename"
import renamePathDescription from "@zavx0z/ai-filesystem-rename/description.json" with {type: "json"}
import applyPatch from "@zavx0z/ai-filesystem-apply-patch"
import applyPatchDescription from "@zavx0z/ai-filesystem-apply-patch/description.json" with {type: "json"}
import type {StorybookPackageMcpTools as Contract} from "../contract"

/** Прямые вызовы AI сохраняют его проверки путей, бюджетов и конфликтов. */
export function filesystem(workspace: Contract.Input["workspace"]): Contract.Output {
  return [
    {name: "filesystem.stat", description: statPathDescription.description,
      inputSchema: statPathDescription.arguments, outputSchema: statPathDescription.result,
      annotations: {readOnlyHint: true, destructiveHint: false},
      execute: input => statPath(input as Parameters<typeof statPath>[0], workspace)},
    {name: "filesystem.read", description: readFileDescription.description,
      inputSchema: readFileDescription.arguments, outputSchema: readFileDescription.result,
      annotations: {readOnlyHint: true, destructiveHint: false},
      execute: input => readFile(input as Parameters<typeof readFile>[0], workspace)},
    {name: "filesystem.read-many", description: readFilesDescription.description,
      inputSchema: readFilesDescription.arguments, outputSchema: readFilesDescription.result,
      annotations: {readOnlyHint: true, destructiveHint: false},
      execute: input => readFiles(input as Parameters<typeof readFiles>[0], workspace)},
    {name: "filesystem.list", description: listFilesDescription.description,
      inputSchema: listFilesDescription.arguments, outputSchema: listFilesDescription.result,
      annotations: {readOnlyHint: true, destructiveHint: false},
      execute: input => listFiles(input as Parameters<typeof listFiles>[0], workspace)},
    {name: "filesystem.write", description: writeFileDescription.description,
      inputSchema: writeFileDescription.arguments, outputSchema: writeFileDescription.result,
      annotations: {readOnlyHint: false, destructiveHint: true},
      execute: input => writeFile(input as Parameters<typeof writeFile>[0], workspace)},
    {name: "filesystem.create", description: createFileDescription.description,
      inputSchema: createFileDescription.arguments, outputSchema: createFileDescription.result,
      annotations: {readOnlyHint: false, destructiveHint: false},
      execute: input => createFile(input as Parameters<typeof createFile>[0], workspace)},
    {name: "filesystem.mkdir", description: makeDirectoryDescription.description,
      inputSchema: makeDirectoryDescription.arguments, outputSchema: makeDirectoryDescription.result,
      annotations: {readOnlyHint: false, destructiveHint: false},
      execute: input => makeDirectory(input as Parameters<typeof makeDirectory>[0], workspace)},
    {name: "filesystem.remove", description: removePathDescription.description,
      inputSchema: removePathDescription.arguments, outputSchema: removePathDescription.result,
      annotations: {readOnlyHint: false, destructiveHint: true},
      execute: input => removePath(input as Parameters<typeof removePath>[0], workspace)},
    {name: "filesystem.rename", description: renamePathDescription.description,
      inputSchema: renamePathDescription.arguments, outputSchema: renamePathDescription.result,
      annotations: {readOnlyHint: false, destructiveHint: true},
      execute: input => renamePath(input as Parameters<typeof renamePath>[0], workspace)},
    {name: "filesystem.apply-patch", description: applyPatchDescription.description,
      inputSchema: applyPatchDescription.arguments, outputSchema: applyPatchDescription.result,
      annotations: {readOnlyHint: false, destructiveHint: true},
      execute: input => applyPatch(input as Parameters<typeof applyPatch>[0], workspace)},
  ]
}
