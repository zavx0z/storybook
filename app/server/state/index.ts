/**
Хранит идентичность единственного процесса Storybook, атомарный startup lease
и полномочия его управляющего HTTP-канала.

@packageDocumentation
*/
import {
  EXTERNAL_STORYBOOK_SERVER_PROTOCOL,
  acquireExternalStorybookStartLease,
  assertExternalStorybookStartLease,
  writeExternalStorybookStartupProgress,
  readExternalStorybookStartupProgress,
  writeExternalStorybookOperationProgress,
  readExternalStorybookOperationProgress,
  clearExternalStorybookMigrationRecord,
  createExternalStorybookServerRecord,
  externalStorybookArtifactRoot,
  externalStorybookLegacyStatePaths,
  externalStorybookMigrationStatePath,
  externalStorybookServerStatePath,
  externalStorybookStateRoot,
  inspectExternalStorybookServer,
  processExists,
  projectExternalStorybookServerRecord,
  publishExternalStorybookStartCandidate,
  readExternalStorybookMigrationRecord,
  readExternalStorybookServerRecord,
  readProcessDirectory,
  readProcessStart,
  removeReplaceableExternalStorybookState,
  writeExternalStorybookMigrationRecord,
  writeExternalStorybookServerRecord,
  writeExternalStorybookStartCandidate,
} from "./src/server-state"
import {
  ExternalStorybookSecurityError,
  assertExternalStorybookControlRequest,
  assertExternalStorybookRequestHost,
  assertExternalStorybookRequestOrigin,
  externalStorybookControlAuthorization,
  externalStorybookControlTokenMatches,
} from "./src/security"
import StorybookTechHttpClient from "@zavx0z/storybook-tech-http-client"
import type {StorybookAppServerState} from "./contract"

export type {StorybookAppServerState} from "./contract"

/** Единая публичная возможность для записи, проверки и авторизации процесса. */
const state: StorybookAppServerState.Output = Object.freeze({
  client(record) {
    return new StorybookTechHttpClient({origin: record.origin, instanceId: record.instanceId,
      authorization: () => externalStorybookControlAuthorization(record.controlToken)})
  },
  EXTERNAL_STORYBOOK_SERVER_PROTOCOL,
  ExternalStorybookSecurityError,
  acquireExternalStorybookStartLease,
  assertExternalStorybookControlRequest,
  assertExternalStorybookRequestHost,
  assertExternalStorybookRequestOrigin,
  assertExternalStorybookStartLease,
  writeExternalStorybookStartupProgress,
  readExternalStorybookStartupProgress,
  writeExternalStorybookOperationProgress,
  readExternalStorybookOperationProgress,
  clearExternalStorybookMigrationRecord,
  createExternalStorybookServerRecord,
  externalStorybookArtifactRoot,
  externalStorybookControlAuthorization,
  externalStorybookControlTokenMatches,
  externalStorybookLegacyStatePaths,
  externalStorybookMigrationStatePath,
  externalStorybookServerStatePath,
  externalStorybookStateRoot,
  inspectExternalStorybookServer,
  processExists,
  projectExternalStorybookServerRecord,
  publishExternalStorybookStartCandidate,
  readExternalStorybookMigrationRecord,
  readExternalStorybookServerRecord,
  readProcessDirectory,
  readProcessStart,
  removeReplaceableExternalStorybookState,
  writeExternalStorybookMigrationRecord,
  writeExternalStorybookServerRecord,
  writeExternalStorybookStartCandidate,
})

export default state
