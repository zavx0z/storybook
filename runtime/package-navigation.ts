/**
Передаёт package intent единственному page owner без browser navigation fallback.

@param input - Exact packageId и route, которые server resolver проверит перед mount.

@param transition - Page-owned callback; direct scope не может менять `location` самостоятельно.

@returns Завершение committed transition либо её rollback.

@throws Если scope запущен без page controller или transition отклонена.

@example
```ts
await navigatePackage(
  {packageId: "@webxr/markdown", route: ""},
  page.navigatePackage,
)
```
*/
export async function navigatePackage(
  input: Readonly<{packageId: string; route: string}>,
  transition?: (input: Readonly<{packageId: string; route: string}>) => Promise<void>,
): Promise<void> {
  if (transition === undefined) {
    throw new Error("Storybook page controller is required for cross-package navigation")
  }
  await transition(input)
}
