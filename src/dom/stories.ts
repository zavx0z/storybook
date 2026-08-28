/**
DOM-native Storybook stories for one lean `@zavx0z/dom` realm.

The owner receives the exact `Document` that also owns the Workbench. A story
creates one real `Node` on its first render and mutates that same node for later
argument updates. This module has no Engine, Layout or UI primitive boundary.

@packageDocumentation
*/

import {type Document, Node} from "@zavx0z/dom"

export type StorybookDomStoryArgs = Readonly<object>

/** Literal authoring documents retained as story provenance and evidence. */
export type StorybookDomStorySource = Readonly<{
  html: string
  css: string
  typescript: string
}>

export type StorybookDomStoryModuleInput<Args extends StorybookDomStoryArgs> = Readonly<{
  defaultArgs: Args
  /**
  Creates or updates the story root in the supplied realm.

  `current` is `null` exactly once. Every later call receives the original root
  and must return that same object after applying the new arguments.
  */
  render(document: Document, args: Args, current: Node | null): Node
  source(args: Args): StorybookDomStorySource
}>

export type StorybookDomStoryModule<Args extends StorybookDomStoryArgs = StorybookDomStoryArgs> = Readonly<{
  defaultArgs: Args
  render(document: Document, args: Args, current: Node | null): Node
  source(args: Args): StorybookDomStorySource
}>

export type MountStorybookDomStoryOptions<Args extends StorybookDomStoryArgs> = Readonly<{
  document: Document
  host: Node
  story: StorybookDomStoryModule<Args>
  args?: Partial<Args>
}>

/** Owns one mounted story root and its addressed argument updates. */
export type StorybookDomStoryController<Args extends StorybookDomStoryArgs> = Readonly<{
  document: Document
  host: Node
  node: Node
  args: Args
  update(patch: Partial<Args>): Node
  source(): StorybookDomStorySource
  dispose(): void
}>

/**
Defines one DOM story without introducing another render-target abstraction.

The returned wrapper snapshots arguments and source documents, verifies that a
root is a real Node from the installed `@zavx0z/dom` realm, and rejects root
replacement on update.
*/
export function defineStorybookDomStory<Args extends StorybookDomStoryArgs>(
  input: StorybookDomStoryModuleInput<Args>,
): StorybookDomStoryModule<Args> {
  if (typeof input.render !== "function") throw new TypeError("DOM story render must be a function")
  if (typeof input.source !== "function") throw new TypeError("DOM story source must be a function")

  const defaultArgs = Object.freeze({...input.defaultArgs}) as Args
  return Object.freeze({
    defaultArgs,
    render(document, args, current) {
      const node = input.render(document, args, current)
      assertNodeInDocument(node, document, "DOM story render")
      if (current !== null && node !== current) {
        throw new Error("DOM story render must preserve its root Node identity")
      }
      return node
    },
    source(args) {
      return normalizeSource(input.source(args))
    },
  })
}

/**
Mounts one story into an existing host from the same Document.

The controller performs shallow addressed argument updates and removes only its
owned root when disposed. It never clears or replaces unrelated host children.
*/
export function mountStorybookDomStory<Args extends StorybookDomStoryArgs>(
  options: MountStorybookDomStoryOptions<Args>,
): StorybookDomStoryController<Args> {
  assertHostInDocument(options.host, options.document)
  let disposed = false
  let args = Object.freeze({...options.story.defaultArgs, ...options.args}) as Args
  let node!: Node

  options.document.transaction(() => {
    node = options.story.render(options.document, args, null)
    options.host.appendChild(node)
  })

  const controller: StorybookDomStoryController<Args> = {
    document: options.document,
    host: options.host,
    get node() {
      return node
    },
    get args() {
      return args
    },
    update(patch) {
      assertActive(disposed)
      args = Object.freeze({...args, ...patch}) as Args
      return options.document.transaction(() => options.story.render(options.document, args, node))
    },
    source() {
      assertActive(disposed)
      return options.story.source(args)
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (node.parentNode !== null) node.parentNode.removeChild(node)
    },
  }
  return Object.freeze(controller)
}

function assertNodeInDocument(node: Node, document: Document, operation: string): void {
  if (!(node instanceof Node)) throw new TypeError(`${operation} must return a Node from @zavx0z/dom`)
  if (node.ownerDocument !== document) throw new Error(`${operation} returned a Node from another Document`)
}

function assertHostInDocument(host: Node, document: Document): void {
  if (!(host instanceof Node)) throw new TypeError("DOM story host must be a Node from @zavx0z/dom")
  if (host !== document && host.ownerDocument !== document) {
    throw new Error("DOM story host belongs to another Document")
  }
}

function normalizeSource(source: StorybookDomStorySource): StorybookDomStorySource {
  const normalized: StorybookDomStorySource = {
    html: nonEmptySource("html", source.html),
    css: nonEmptySource("css", source.css),
    typescript: nonEmptySource("typescript", source.typescript),
  }
  return Object.freeze(normalized)
}

function nonEmptySource(kind: keyof StorybookDomStorySource, value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`DOM story source ${kind} must not be empty`)
  }
  return value
}

function assertActive(disposed: boolean): void {
  if (disposed) throw new Error("DOM story controller is disposed")
}
