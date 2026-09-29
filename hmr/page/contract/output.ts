/**
Владелец одного действующего scope. Замены сериализуются; current становится null
на время смены исполнения. Ошибка create/accept восстанавливает прошлый scope.
accept получает restored=true при откате и отвечает за адрес и представление.
detach освобождает scope перед передачей Canvas другому владельцу платформы.
dispose запрещает новые замены и завершает освобождение, включая ожидающие операции.
*/
export type HmrPageOutput<Scope> = Readonly<{
  readonly current: Scope | null
  replace(create: () => Promise<Scope>, accept: (scope: Scope, restored: boolean) => void | Promise<void>): Promise<void>
  detach(): Promise<void>
  dispose(): Promise<void>
}>
