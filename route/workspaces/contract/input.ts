/**
Вход чтения состава workspaces одного пакета.

@property root - Физический корень владельца с `package.json`.

@property value - Непосредственное значение `package.json#workspaces`.
*/
export interface ReadWorkspacePackagesInput {
  readonly root: string
  readonly value: unknown
}
