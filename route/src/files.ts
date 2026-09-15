import {lstat, readFile, realpath} from "node:fs/promises"
import {isAbsolute, relative, resolve, sep} from "node:path"
import type {PackageManifest} from "./types"

const privateSegments = new Set(["spec", "src", "fixture", "node_modules"])

/** Читает только package identity и workspace composition из package.json. */
export async function readPackageManifest(packagePath: string): Promise<PackageManifest | null> {
  let value: unknown
  try {
    const manifestPath = resolve(packagePath, "package.json")
    const info = await lstat(manifestPath)
    if (!info.isFile() || info.isSymbolicLink()) return null
    value = JSON.parse(await readFile(manifestPath, "utf8"))
  } catch {
    return null
  }
  if (!isRecord(value) || typeof value.name !== "string") return null

  const workspaces = Array.isArray(value.workspaces)
    ? value.workspaces.filter((item): item is string => typeof item === "string")
    : []
  return {name: value.name, workspaces}
}

/** Проверяет, что сегмент может участвовать в публичном структурном пути. */
export function isPublicSegment(segment: string): boolean {
  return segment.length > 0
    && !segment.startsWith(".")
    && !privateSegments.has(segment)
    && segment !== "test"
    && segment !== "tests"
}

/** Возвращает настоящий корень только для обычной зарегистрированной директории. */
export async function readRootPath(path: string): Promise<string | null> {
  const absolutePath = resolve(path)
  try {
    const info = await lstat(absolutePath)
    if (!info.isDirectory() || info.isSymbolicLink()) return null
    return await realpath(absolutePath)
  } catch {
    return null
  }
}

/** Проверяет существование обычной директории внутри зарегистрированного корня. */
export async function readContainedDirectory(rootPath: string, path: string): Promise<string | null> {
  const absolutePath = resolve(path)
  if (!isContained(rootPath, absolutePath)) return null
  try {
    const info = await lstat(absolutePath)
    if (!info.isDirectory() || info.isSymbolicLink()) return null
    const actualPath = await realpath(absolutePath)
    return isContained(rootPath, actualPath) ? actualPath : null
  } catch {
    return null
  }
}

/** Проверяет непосредственный файл, обозначающий виртуальное представление. */
export async function hasOwnedFile(rootPath: string, ownerPath: string, relativePath: string): Promise<boolean> {
  const path = resolve(ownerPath, relativePath)
  if (!isContained(ownerPath, path) || !isContained(rootPath, path)) return false
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) return false
    const actualPath = await realpath(path)
    return actualPath === path
      && isContained(ownerPath, actualPath)
      && isContained(rootPath, actualPath)
  } catch {
    return false
  }
}

/** Разрешает обычный файл относительно базы и проверяет его реальную принадлежность owner. */
export async function readContainedFile(
  rootPath: string,
  ownerPath: string,
  basePath: string,
  path: string,
): Promise<string | null> {
  const candidatePath = resolve(basePath, path)
  if (!isContained(ownerPath, candidatePath) || !isContained(rootPath, candidatePath)) return null
  try {
    const info = await lstat(candidatePath)
    if (!info.isFile() || info.isSymbolicLink()) return null
    const actualPath = await realpath(candidatePath)
    return actualPath === candidatePath
      && isContained(ownerPath, actualPath)
      && isContained(rootPath, actualPath)
      ? actualPath
      : null
  } catch {
    return null
  }
}

/** Определяет принадлежность пути указанному корню, включая сам корень. */
function isContained(rootPath: string, path: string): boolean {
  const difference = relative(rootPath, path)
  return difference === "" || (!difference.startsWith(`..${sep}`) && difference !== ".." && !isAbsolute(difference))
}

/** Отличает JSON object от массивов и примитивов. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
