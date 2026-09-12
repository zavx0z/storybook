export const inspectorConfigured = Boolean(process.env.BUN_INSPECT)
export const inspectorNotificationConfigured = Boolean(process.env.BUN_INSPECT_NOTIFY)
export const inheritedValue = process.env.SCENARIO_INSPECTOR_TEST

console.log(JSON.stringify({inspectorConfigured, inspectorNotificationConfigured, inheritedValue}))
