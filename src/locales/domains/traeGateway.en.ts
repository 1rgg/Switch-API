/**
 * 文案域：**Trae 产品线 · 产品线切换与网关管理**（英文）。
 *
 * ⚠️ 不写类型注解：键名合法性由 `src/locales/en.ts` 单点校验。域文件保持零依赖。
 * 键必须与 `traeGateway.zh.ts` **一一对应**（缺哪条就回落中文）。
 */
export const en = {
  // =====================================================================
  // trae-variant-bar.tsx —— variant status bar (accounts page)
  // =====================================================================
  "trae.variant.bar.loggedIn": "Signed in: {name}",
  "trae.variant.bar.notLoggedIn": "Not signed in",
  "trae.variant.bar.notDetected": "Not detected",

  // =====================================================================
  // trae-variant-switch.tsx —— variant switcher
  // =====================================================================
  "trae.variant.switch.aria": "Select Trae version",
  "trae.variant.switch.running": "Running",
  "trae.variant.switch.installed": "Installed",
  "trae.variant.switch.notDetected": "Not detected",
  "trae.variant.switch.tip": "{label}: {state}",
  "trae.variant.switch.tipVersion": "{label}: {state} · v{version}",

  // =====================================================================
  // gateway/trae-model-list.tsx —— model list
  // =====================================================================
  "trae.gateway.models.title": "Model list",
  "trae.gateway.models.summary": "{count} total · default {model}",
  "trae.gateway.models.note": "This list is read from the Trae client's local cache (pushed by upstream), so it follows the client's refresh; the exposed list (/v1/models) follows the API key's owned client, and the two clients differ.",
  "trae.gateway.models.empty": "No model data yet.",
  "trae.gateway.models.refresh": "Reload",
  "trae.gateway.models.program": "Select target client",
  "trae.gateway.models.programTip": "Read the model list of the {label} client",
  "trae.gateway.models.source": "Source",
  "trae.gateway.models.sourceCache": "Client cache",
  "trae.gateway.models.sourceMissing": "Not loaded",
  "trae.gateway.models.readAt": "Read at {time}",
  "trae.gateway.models.readFrom": "Read from the {label} client",
  "trae.gateway.models.gatewayCount": "{count} exposed by gateway",
  "trae.gateway.models.gatewayCountFor": "{count} exposed by gateway ({program})",
  "trae.gateway.models.groupCount": "{count}",
  "trae.gateway.models.badgeDefault": "Default",
  "trae.gateway.models.badgeNew": "New",
  "trae.gateway.models.badgeBeta": "Beta",
  "trae.gateway.models.badgeCustom": "Custom",
  "trae.gateway.models.badgeNotServed": "Not served",
  // ---- "only served models" toggle ----
  // Defaults to **off**: the client cache is the user's only on-disk evidence of what
  // upstream actually pushed; silently dropping entries makes them think it was never there.
  // Turn it on when a directly usable list is wanted — then it matches /v1/models row for row.
  "trae.gateway.models.onlyServed": "Only models the gateway serves",
  "trae.gateway.models.onlyServedTip": "Hide rows the gateway does not serve (outside the current program's function, or third-party routes).",
  "trae.gateway.models.hiddenCount": "{count} unservable model(s) hidden",
  // ---- model table (mirrors workbuddy2api-panel's columns, column-for-column with the WorkBuddy table) ----
  "trae.gateway.models.tableHint": "The table lists every model in this client's cache, grouped by function; rows marked \"Not served\" fall outside this client's function and return 4001.",
  "trae.gateway.models.colModel": "Model",
  "trae.gateway.models.colCredits": "Credit rate",
  "trae.gateway.models.colDefaultEffort": "Default tier",
  "trae.gateway.models.colEfforts": "Supported effort tiers",
  "trae.gateway.models.colContext": "Context",
  "trae.gateway.models.colMaxTokens": "Max output",
  // The Trae upstream list has **no** credit-rate field — this column is always "—", so the tooltip says "not applicable", not "unavailable".
  "trae.gateway.models.creditNotApplicable": "The Trae upstream list has no per-model credit rate (credits are tracked per account package).",
  "trae.gateway.models.effortNone": "This model is not in the tier table (upstream has no reasoning_effort support).",
  "trae.gateway.models.effortFixed": "Fixed: {effort}",
  "trae.gateway.models.effortDefaultTip": "Default tier: {effort}",
  "trae.gateway.models.effortInferred": "Inferred",
  "trae.gateway.models.effortInferredTip": "The tier table declares no default; this is the backend fallback, not an upstream declaration.",
  "trae.gateway.models.capVision": "Vision",
  "trae.gateway.models.capNoVision": "Text only",

  // =====================================================================
  // gateway/trae-request-log.tsx —— request log
  // =====================================================================
  "trae.gateway.log.title": "Request log (last {count})",
  "trae.gateway.log.clear": "Clear",
  "trae.gateway.log.empty": "No requests yet. Once the gateway is running, every call from a client is recorded here (metadata only by default, no bodies).",
  "trae.gateway.log.col.time": "Time",
  "trae.gateway.log.col.account": "Account",
  "trae.gateway.log.col.model": "Model",
  "trae.gateway.log.col.status": "Status",
  "trae.gateway.log.col.latency": "Latency",
  "trae.gateway.log.col.tokens": "Token",

  // =====================================================================
  // gateway/trae-integration-guide.tsx —— integration guide
  // =====================================================================
  "trae.gateway.guide.title": "Integration guide",
  "trae.gateway.guide.copy": "Copy code",
  "trae.gateway.guide.copied": "Code copied",
  "trae.gateway.guide.noKey": "sk-trae-… (create a key above first)",
  "trae.gateway.guide.streamNote": "The Trae upstream only supports streaming; when a request sets `stream: false`, this gateway aggregates locally and returns it at once, with longer first-byte latency.",
  // Field labels inside the copyable snippet
  "trae.gateway.guide.snippet.apiBase": "API Base URL",
  "trae.gateway.guide.snippet.apiKey": "API Key",
  "trae.gateway.guide.snippet.model": "Model",

  // =====================================================================
  // The account pool card is now **shared by both sides**
  // (`gateway/account-pool-card.tsx`); its strings moved to
  // `shared.gateway.pool.*` / `shared.poolStatus.*` (see `shared.en.ts`).
  // =====================================================================

  // =====================================================================
  // gateway/trae-api-key-table.tsx —— API Key list / create / revoke / delete
  // =====================================================================
  // ---- Toasts ----
  "trae.gateway.key.loadFailed": "Failed to load the API Key list",
  "trae.gateway.key.nameRequired": "Please enter a name",
  "trae.gateway.key.noPlaintext": "Created successfully but no plaintext returned; please retry",
  "trae.gateway.key.createFailed": "Create failed",
  "trae.gateway.key.revoked": "Revoked",
  "trae.gateway.key.revokeFailed": "Revoke failed",
  "trae.gateway.key.deleted": "Deleted",
  "trae.gateway.key.deleteFailed": "Delete failed",
  "trae.gateway.key.copied": "API Key copied",

  // ---- List ----
  "trae.gateway.key.create": "Create API Key",
  "trae.gateway.key.loading": "Loading…",
  "trae.gateway.key.empty": "No API Keys created yet.",
  "trae.gateway.key.neverUsed": "Never used",
  "trae.gateway.key.statusRevoked": "Revoked",
  "trae.gateway.key.statusActive": "Enabled",
  "trae.gateway.key.revoke": "Revoke",
  "trae.gateway.key.delete": "Delete",

  // ---- Table headers ----
  "trae.gateway.key.name": "Name",
  "trae.gateway.key.col.variant": "Owned client",
  "trae.gateway.key.col.prefix": "Prefix",
  "trae.gateway.key.col.createdAt": "Created",
  "trae.gateway.key.col.lastUsed": "Last used",
  "trae.gateway.key.col.status": "Status",
  "trae.gateway.key.col.actions": "Actions",

  // ---- Create dialog ----
  "trae.gateway.key.createDesc": "Each key can only reach the models and account pool of its owned client — TraeWork and TraeCode offer different models.",
  "trae.gateway.key.namePlaceholder": "e.g. Cursor",
  "trae.gateway.key.variant": "Owned client",
  "trae.gateway.key.cancel": "Cancel",
  "trae.gateway.key.createSubmit": "Create",

  // ---- One-time plaintext ----
  "trae.gateway.key.createdTitle": "API Key created",
  "trae.gateway.key.createdDesc": "The full key is shown only this once; copy and save it immediately.",
  "trae.gateway.key.copy": "Copy",
  "trae.gateway.key.saved": "I have saved it, close",

  // ---- Revoke / delete confirmations ----
  "trae.gateway.key.revokeTitle": "Revoke API Key",
  "trae.gateway.key.revokeDesc": "After revocation, \"{name}\" becomes invalid immediately (401) and remains listed as \"revoked\".",
  "trae.gateway.key.deleteTitle": "Delete API Key",
  "trae.gateway.key.deleteDesc": "Delete the revoked key \"{name}\"? This cannot be undone.",
};
