/**
Разрешает физических владельцев исходников и создаёт compiler plugins для одного
согласованного графа. Проверка JSX config используется и при чтении сценариев,
не загружая приложение или пакетную сборку. Состав входов задаёт вызывающий код.

@packageDocumentation
*/
import {
  resolveStorybookCompilerSourceRoots,
  resolveStorybookPackageCompilerInputs,
  createStorybookOwnerResolver,
  createStorybookOwnerSourcePath,
  createStorybookPackageCompilerPlugins,
  resolveStorybookJsxImportSource,
  canonicalLexicalFile,
} from "./src/compiler"
import {
  readStorybookPackageOwner,
  readStorybookPackageRoot,
  sameStorybookPackageOwner,
  preferredStorybookPackageRoot,
  canonicalizeStorybookPackageFile,
  tryCanonicalizeStorybookPackageFile,
} from "./src/owner-identity"
import {conditionalExportTarget} from "./src/export-target"
import {ensureGeneratedJsxProtocol} from "./src/generated-jsx-protocol"
import {isOwnedJsxProtocol} from "./src/jsx-protocol-owner"
import type {BuildCompiler} from "./contract"
export type {BuildCompiler} from "./contract"

/** Один API compiler setup и его физических границ; вызовы сами владеют необходимым чтением. */
const Compiler: BuildCompiler.Output = Object.freeze({
  exactFile: canonicalLexicalFile,
  resolveStorybookCompilerSourceRoots,
  resolveStorybookPackageCompilerInputs,
  createStorybookOwnerResolver,
  createStorybookOwnerSourcePath,
  createStorybookPackageCompilerPlugins,
  resolveStorybookJsxImportSource,
  readStorybookPackageOwner,
  readStorybookPackageRoot,
  sameStorybookPackageOwner,
  preferredStorybookPackageRoot,
  canonicalizeStorybookPackageFile,
  tryCanonicalizeStorybookPackageFile,
  conditionalExportTarget,
  ensureGeneratedJsxProtocol,
  isOwnedJsxProtocol,
})

export default Compiler
