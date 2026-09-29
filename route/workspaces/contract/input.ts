/**
Вход чтения корневого workspace либо состава выбранного вложенного пакета.

@property root - Физический корень владельца с `package.json`.

@property [value] - Значение корневого `package.json#workspaces`. Без него
читатель находит декларацию Repo, не пересекая границу Git.
*/
export interface ReadWorkspacePackagesInput {
  readonly root: string
  readonly value?: unknown
}
