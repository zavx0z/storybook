/**
Typed pathname hierarchy shared by repository-owned Storybook applications.

The tree derives overview nodes from exact leaves. It owns canonical URL shape,
but it never chooses a story for an unknown pathname.

@packageDocumentation
*/

export type StorybookRouteTreeOverviewNode = Readonly<{
  kind: "overview"
  path: string
  segment: string
  parentPath: string | null
  depth: number
}>

export type StorybookRouteTreeLeafNode<Leaf extends string> = Readonly<{
  kind: "leaf"
  path: Leaf
  segment: string
  parentPath: string
  depth: number
}>

export type StorybookRouteTreeNode<Leaf extends string = string> =
  | StorybookRouteTreeOverviewNode
  | StorybookRouteTreeLeafNode<Leaf>

export type StorybookRouteTree<Leaf extends string = string> = Readonly<{
  leaves: readonly Leaf[]
  overviews: readonly string[]
  nodes: readonly StorybookRouteTreeNode<Leaf>[]
  find(path: string): StorybookRouteTreeNode<Leaf> | undefined
  children(path: string): readonly StorybookRouteTreeNode<Leaf>[]
}>

export type StorybookRouteTreeInput<Leaves extends readonly string[]> = Readonly<{
  leaves: Leaves
}>

export type StorybookRouteTreeOptions = Readonly<{
  basePath?: string
}>

export type StorybookRouteTreeResolution<Leaf extends string = string> =
  | Readonly<{
      kind: "match"
      node: StorybookRouteTreeNode<Leaf>
      canonicalPath: string
      redirect: boolean
    }>
  | Readonly<{kind: "not-found"}>

export type StorybookRouteTreeChange<Leaf extends string> = (
  node: StorybookRouteTreeNode<Leaf>,
  previous: StorybookRouteTreeNode<Leaf>,
) => void

export type StorybookRouteTreeRouterOptions = StorybookRouteTreeOptions & Readonly<{
  onNotFound?(error: StorybookRouteTreeNotFoundError): void
}>

/** Exact browser pathname rejected by a route-tree owner. */
export class StorybookRouteTreeNotFoundError extends Error {
  constructor(readonly pathname: string) {
    super(`Storybook route tree path is not registered: ${pathname}`)
    this.name = "StorybookRouteTreeNotFoundError"
  }
}

/**
Builds the root overview, every proper prefix overview and every exact leaf.

The returned graph and its observable collections are frozen. Input order owns
sibling order, so applications can keep catalog ordering without a second index.

@throws If a leaf is malformed, duplicated or both an overview and a leaf.
*/
export function defineStorybookRouteTree<const Leaves extends readonly string[]>(
  input: StorybookRouteTreeInput<Leaves>,
): StorybookRouteTree<Leaves[number]> {
  const leaves = Object.freeze(input.leaves.map((leaf) => validateLeaf(leaf))) as readonly Leaves[number][]
  if (new Set(leaves).size !== leaves.length) throw new Error("Storybook route tree leaves must be unique")

  type Leaf = Leaves[number]
  const nodeByPath = new Map<string, StorybookRouteTreeNode<Leaf>>()
  const childrenByPath = new Map<string, StorybookRouteTreeNode<Leaf>[]>()
  const nodes: StorybookRouteTreeNode<Leaf>[] = []
  const overviews: string[] = []

  const addNode = (node: StorybookRouteTreeNode<Leaf>): void => {
    const existing = nodeByPath.get(node.path)
    if (existing !== undefined) {
      if (existing.kind !== node.kind) {
        throw new Error(`Storybook route tree leaf conflicts with overview: ${node.path}`)
      }
      return
    }
    nodeByPath.set(node.path, node)
    nodes.push(node)
    if (node.kind === "overview") overviews.push(node.path)
    if (node.parentPath !== null) {
      const children = childrenByPath.get(node.parentPath) ?? []
      children.push(node)
      childrenByPath.set(node.parentPath, children)
    }
  }

  addNode(overviewNode(""))
  for (const leaf of leaves) {
    const segments = leaf.split("/")
    for (let depth = 1; depth < segments.length; depth += 1) {
      const path = segments.slice(0, depth).join("/")
      const existing = nodeByPath.get(path)
      if (existing?.kind === "leaf") {
        throw new Error(`Storybook route tree leaf cannot contain another leaf: ${path}`)
      }
      addNode(overviewNode(path))
    }
    const existing = nodeByPath.get(leaf)
    if (existing !== undefined) {
      throw new Error(`Storybook route tree leaf conflicts with overview: ${leaf}`)
    }
    addNode(Object.freeze({
      kind: "leaf",
      path: leaf,
      segment: segments.at(-1)!,
      parentPath: segments.slice(0, -1).join("/"),
      depth: segments.length,
    }))
  }

  for (const children of childrenByPath.values()) Object.freeze(children)
  const noChildren = Object.freeze([]) as readonly StorybookRouteTreeNode<Leaf>[]
  return Object.freeze({
    leaves,
    overviews: Object.freeze(overviews),
    nodes: Object.freeze(nodes),
    find(path: string) {
      return nodeByPath.get(normalizeLookupPath(path))
    },
    children(path: string) {
      const normalized = normalizeLookupPath(path)
      if (!nodeByPath.has(normalized)) throw new Error(`Unknown storybook route tree node: ${path}`)
      return childrenByPath.get(normalized) ?? noChildren
    },
  })
}

/**
Resolves an absolute pathname only when it denotes an existing tree node.

The result distinguishes a compatible slash redirect from an unknown route.
Malformed paths and paths outside `basePath` fail closed.

@returns A canonical match or `not-found`; never a representative story.
*/
export function resolveStorybookRouteTree<Leaf extends string>(
  tree: StorybookRouteTree<Leaf>,
  location: Readonly<{pathname: string}>,
  options: StorybookRouteTreeOptions = {},
): StorybookRouteTreeResolution<Leaf> {
  const basePath = normalizeBasePath(options.basePath)
  const pathname = normalizeInputPathname(location.pathname)
  if (pathname === null) return Object.freeze({kind: "not-found"})
  const localPath = localPathWithinMount(pathname, basePath)
  if (localPath === null) return Object.freeze({kind: "not-found"})
  const node = tree.find(localPath)
  if (node === undefined) return Object.freeze({kind: "not-found"})
  const canonicalPath = storybookRouteTreeUrl(tree, node.path, {basePath})
  return Object.freeze({
    kind: "match",
    node,
    canonicalPath,
    redirect: pathname !== canonicalPath,
  })
}

/**
Returns the canonical URL of one registered node.

Overview URLs end in `/`; exact leaf URLs do not.

@throws If `path` is not present in `tree` or `basePath` is malformed.
*/
export function storybookRouteTreeUrl<Leaf extends string>(
  tree: StorybookRouteTree<Leaf>,
  path: string,
  options: StorybookRouteTreeOptions = {},
): string {
  const node = tree.find(path)
  if (node === undefined) throw new Error(`Unknown storybook route tree node: ${path}`)
  const basePath = normalizeBasePath(options.basePath)
  if (node.path.length === 0) return basePath === "" ? "/" : `${basePath}/`
  const url = `${basePath}/${node.path}`
  return node.kind === "overview" ? `${url}/` : url
}

/**
Owns browser history for one exact route-tree mount.

Construction rejects an unknown initial URL instead of choosing presentation
state. Later unknown `popstate` locations are reported through `onNotFound` and
leave the last valid node unchanged.

The owner must call {@link StorybookRouteTreeRouter.dispose} when the mounted
page is removed.

@throws If the initial `window.location.pathname` is not registered.
*/
export class StorybookRouteTreeRouter<Leaf extends string> {
  readonly #tree: StorybookRouteTree<Leaf>
  readonly #options: StorybookRouteTreeRouterOptions
  readonly #listeners = new Set<StorybookRouteTreeChange<Leaf>>()
  #node: StorybookRouteTreeNode<Leaf>
  readonly #onLocationChange = (): void => {
    const node = this.#read(false)
    if (node !== null) this.#set(node)
  }

  /**
  Mounts one tree at the current browser pathname.

  @example
  ```ts
  const router = new StorybookRouteTreeRouter(tree, {basePath: "/components"})
  router.go("button/basic/contained")
  router.dispose()
  ```
  */
  constructor(
    tree: StorybookRouteTree<Leaf>,
    options: StorybookRouteTreeRouterOptions = {},
  ) {
    this.#tree = tree
    this.#options = Object.freeze({...options})
    const node = this.#read(true)
    if (node === null) throw new StorybookRouteTreeNotFoundError(window.location.pathname)
    this.#node = node
    window.addEventListener("popstate", this.#onLocationChange)
  }

  get current(): StorybookRouteTreeNode<Leaf> {
    return this.#node
  }

  /**
  Pushes one registered overview or leaf into browser history.

  @returns `false` without side effects when `path` is unknown.
  */
  go(path: string): boolean {
    const node = this.#tree.find(path)
    if (node === undefined) return false
    const url = storybookRouteTreeUrl(this.#tree, node.path, this.#options)
    if (window.location.pathname !== url) history.pushState(null, "", url)
    this.#set(node)
    return true
  }

  subscribe(listener: StorybookRouteTreeChange<Leaf>): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Releases the page-owned browser listener and all subscribers. */
  dispose(): void {
    window.removeEventListener("popstate", this.#onLocationChange)
    this.#listeners.clear()
  }

  #read(initial: boolean): StorybookRouteTreeNode<Leaf> | null {
    const resolution = resolveStorybookRouteTree(this.#tree, window.location, this.#options)
    if (resolution.kind === "not-found") {
      const error = new StorybookRouteTreeNotFoundError(window.location.pathname)
      if (initial || this.#options.onNotFound === undefined) throw error
      this.#options.onNotFound(error)
      return null
    }
    if (resolution.redirect) history.replaceState(null, "", resolution.canonicalPath)
    return resolution.node
  }

  #set(node: StorybookRouteTreeNode<Leaf>): void {
    if (node === this.#node) return
    const previous = this.#node
    this.#node = node
    for (const listener of [...this.#listeners]) listener(node, previous)
  }
}

function overviewNode(path: string): StorybookRouteTreeOverviewNode {
  const segments = path.length === 0 ? [] : path.split("/")
  return Object.freeze({
    kind: "overview",
    path,
    segment: segments.at(-1) ?? "",
    parentPath: segments.length === 0 ? null : segments.slice(0, -1).join("/"),
    depth: segments.length,
  })
}

function validateLeaf(value: string): string {
  if (value.length === 0 || value.startsWith("/") || value.endsWith("/") ||
    value.includes("//") || /[?#]/.test(value)) {
    throw new Error(`Storybook route tree leaf must be a normalized pathname id: ${value}`)
  }
  return value
}

function normalizeLookupPath(path: string): string {
  if (path === "" || path === "/") return ""
  return path.replace(/^\/+|\/+$/g, "")
}

function normalizeBasePath(value: string | undefined): string {
  if (value === undefined || value === "" || value === "/") return ""
  const path = value.replace(/^\/+|\/+$/g, "")
  if (path.length === 0) return ""
  validateLeaf(path)
  return `/${path}`
}

function normalizeInputPathname(value: string): string | null {
  if (!value.startsWith("/") || value.includes("//") || /[?#]/.test(value)) return null
  return value
}

function localPathWithinMount(pathname: string, basePath: string): string | null {
  let local: string
  if (basePath === "") local = pathname.slice(1)
  else if (pathname === basePath) local = ""
  else if (pathname.startsWith(`${basePath}/`)) local = pathname.slice(basePath.length + 1)
  else return null

  const path = local.replace(/\/+$/g, "")
  if (path.startsWith("/") || path.includes("//")) return null
  return path
}
