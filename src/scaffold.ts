/**
Canonical package scaffold for a repository-owned Storybook.

The generator renders one maintained template into a new directory. It refuses
existing targets, writes through a sibling staging directory and validates the
required package composition before the atomic rename.

@packageDocumentation
*/

import {randomUUID} from "node:crypto"
import {existsSync} from "node:fs"
import {mkdir, readdir, rename, rm} from "node:fs/promises"
import {basename, dirname, join, resolve} from "node:path"
import {fileURLToPath} from "node:url"
import {
  readStorybookPackageManifest,
  validateStorybookPackageName,
} from "./internal/package-runtime.ts"

export const STORYBOOK_PACKAGE_TEMPLATE_PATHS = Object.freeze([
  "app.ts",
  "build.ts",
  "bunfig.toml",
  "package.json",
  "page/entry.ts",
  "page/fixtures/example.ts",
  "page/page.ts",
  "page/preview.ts",
  "page/state/lab-state.ts",
  "page/stories.ts",
  "page/stories/example.ts",
  "page/stories/overview.ts",
  "page/style.css",
  "server.ts",
  "storybook.test.ts",
  "tsconfig.json",
  "wgsl-shim.d.ts",
] as const)

export type StorybookPackageTemplatePath = typeof STORYBOOK_PACKAGE_TEMPLATE_PATHS[number]

export type CreateStorybookPackageOptions = Readonly<{
  packageName: string
  directory: string
  title?: string
  ownerLabel?: string
  ownerHref?: string
}>

export type StorybookPackageScaffold = Readonly<{
  packageName: string
  appId: string
  title: string
  directory: string
  files: readonly StorybookPackageTemplatePath[]
}>

export type StorybookPackageScaffoldValidation = Readonly<{
  packageName: string
  appId: string
  directory: string
  files: readonly StorybookPackageTemplatePath[]
}>

/** Creates one new canonical Storybook package without overwriting any path. */
export async function createStorybookPackage(
  options: CreateStorybookPackageOptions,
): Promise<StorybookPackageScaffold> {
  const packageName = validateStorybookPackageName(options.packageName)
  const appId = scaffoldAppId(packageName)
  const directory = resolve(options.directory)
  validateTargetDirectory(directory)
  if (existsSync(directory)) throw new Error(`create-storybook refuses an existing target: ${directory}`)
  const title = visibleText(options.title ?? `${humanize(appId)} Storybook`, "title")
  const ownerLabel = visibleText(options.ownerLabel ?? "MetaFor", "owner label")
  const ownerHref = webUrl(options.ownerHref ?? "https://github.com/zavx0z/metafor")
  const tokens = Object.freeze({
    "__PACKAGE_NAME__": packageName,
    "__APP_ID__": appId,
    "__APP_TITLE__": title,
    "__APP_PASCAL__": pascalCase(appId),
    "__APP_CAMEL__": camelCase(appId),
    "__OWNER_LABEL__": ownerLabel,
    "__OWNER_HREF__": ownerHref,
  })
  const staging = join(dirname(directory), `.${basename(directory)}-create-storybook-${randomUUID()}`)
  const templateRoot = fileURLToPath(new URL("../templates/package/", import.meta.url))
  await mkdir(staging, {recursive: false})
  try {
    for (const relativePath of STORYBOOK_PACKAGE_TEMPLATE_PATHS) {
      const templatePath = join(templateRoot, `${relativePath}.template`)
      if (!existsSync(templatePath)) throw new Error(`Storybook package template is missing: ${relativePath}`)
      const outputPath = join(staging, relativePath)
      await mkdir(dirname(outputPath), {recursive: true})
      await Bun.write(outputPath, renderTemplate(await Bun.file(templatePath).text(), tokens, relativePath))
    }
    await validateStorybookPackageScaffold(staging, packageName)
    await rename(staging, directory)
  } catch (error) {
    await rm(staging, {recursive: true, force: true})
    throw error
  }
  return Object.freeze({
    packageName,
    appId,
    title,
    directory,
    files: STORYBOOK_PACKAGE_TEMPLATE_PATHS,
  })
}

/** Checks the required template composition and exact package identity. */
export async function validateStorybookPackageScaffold(
  directory: string,
  expectedPackageName?: string,
): Promise<StorybookPackageScaffoldValidation> {
  const root = resolve(directory)
  const missing = STORYBOOK_PACKAGE_TEMPLATE_PATHS.filter((path) => !existsSync(join(root, path)))
  if (missing.length > 0) throw new Error(`Storybook package scaffold is incomplete:\n${missing.join("\n")}`)
  const manifest = await Bun.file(join(root, "package.json")).json() as Record<string, unknown>
  const packageName = validateStorybookPackageName(String(manifest.name ?? ""))
  readStorybookPackageManifest(root)
  if (expectedPackageName !== undefined && packageName !== expectedPackageName) {
    throw new Error(`Storybook scaffold package mismatch: expected ${expectedPackageName}, received ${packageName}`)
  }
  if (manifest.private !== true || manifest.type !== "module") {
    throw new Error(`Storybook package must be private ESM: ${packageName}`)
  }
  const scripts = manifest.scripts as Record<string, unknown> | undefined
  for (const script of ["storybook", "build", "test", "typecheck", "check"]) {
    if (typeof scripts?.[script] !== "string" || scripts[script].length === 0) {
      throw new Error(`Storybook package is missing scripts.${script}: ${packageName}`)
    }
  }
  const unexpectedTemplates = (await listFiles(root)).filter((path) => path.endsWith(".template"))
  if (unexpectedTemplates.length > 0) {
    throw new Error(`Rendered Storybook package contains template sources:\n${unexpectedTemplates.join("\n")}`)
  }
  const appId = scaffoldAppId(packageName)
  return Object.freeze({
    packageName,
    appId,
    directory: root,
    files: STORYBOOK_PACKAGE_TEMPLATE_PATHS,
  })
}

function scaffoldAppId(packageName: string): string {
  const scope = packageName.slice(1, packageName.indexOf("/"))
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(scope)) {
    throw new Error(`create-storybook requires a lowercase kebab-case scope: ${packageName}`)
  }
  return scope
}

function validateTargetDirectory(path: string): void {
  if (path === "/" || path === dirname(path)) throw new Error(`create-storybook target is too broad: ${path}`)
  if (basename(path).length === 0 || [".", ".."].includes(basename(path))) {
    throw new Error(`create-storybook target is invalid: ${path}`)
  }
  if (!existsSync(dirname(path))) throw new Error(`create-storybook parent does not exist: ${dirname(path)}`)
}

function renderTemplate(
  source: string,
  tokens: Readonly<Record<string, string>>,
  relativePath: string,
): string {
  let rendered = source
  for (const [token, value] of Object.entries(tokens)) rendered = rendered.replaceAll(token, value)
  const unresolved = rendered.match(/__[A-Z][A-Z0-9_]*__/gu)
  if (unresolved !== null) {
    throw new Error(`Storybook template has unresolved tokens in ${relativePath}: ${[...new Set(unresolved)].join(", ")}`)
  }
  return rendered.endsWith("\n") ? rendered : `${rendered}\n`
}

function visibleText(value: string, label: string): string {
  const normalized = value.trim()
  if (normalized.length === 0 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error(`Invalid Storybook ${label}`)
  }
  return normalized
}

function webUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Storybook owner URL must be HTTP(S): ${value}`)
  }
  return url.href
}

function humanize(value: string): string {
  return value.split("-").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ")
}

function pascalCase(value: string): string {
  return humanize(value).replaceAll(" ", "")
}

function camelCase(value: string): string {
  const pascal = pascalCase(value)
  return `${pascal[0]?.toLowerCase() ?? ""}${pascal.slice(1)}`
}

async function listFiles(root: string): Promise<readonly string[]> {
  const output: string[] = []
  const visit = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) await visit(join(directory, entry.name), relativePath)
      else if (entry.isFile()) output.push(relativePath)
    }
  }
  await visit(root, "")
  return Object.freeze(output.sort())
}
