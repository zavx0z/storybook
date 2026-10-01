import type {PackageRevision} from "@package/revision"

/** Источник темы Web имеет форму источника CSS, принадлежащую PackageRevision. */
export type WebAuthorStyleSheet = NonNullable<Parameters<PackageRevision.Output["create"]>[3]>[number]
