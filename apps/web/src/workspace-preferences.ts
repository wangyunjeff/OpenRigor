export type ModelId = "auto" | "gpt-5.6-sol" | "gpt-5.6-terra" | "gpt-5.6-luna" | (string & {});
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type RunMode = "standard" | "ultra";
export type RoutingPreference = "manual" | "tokenresearch";
export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export interface ModelOption {
  value: ModelId;
  label: string;
  description: string;
  group: "gpt-5.6" | "local";
}

export interface EffortOption {
  value: Effort;
  label: string;
  description: string;
}

export interface ManualExecutionPreference {
  model: ModelId;
  effort: Effort;
  mode: RunMode;
}

export const modelOptions: ModelOption[] = [
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol", description: "Complex reasoning, engineering, and long tasks", group: "gpt-5.6" },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra", description: "Balanced speed and quality for everyday work", group: "gpt-5.6" },
  { value: "gpt-5.6-luna", label: "GPT-5.6 Luna", description: "Fast iteration and focused execution", group: "gpt-5.6" },
  { value: "auto", label: "Auto", description: "Follow the local Codex setting", group: "local" }
];

/** Only models advertised by the local runtime may extend the persistent selector catalog. */
export const modelCatalogStorageKey = "openrigor.models";
export interface RuntimeModel { id: string; name: string; description: string }
export function normalizeModelCatalog(value: unknown): RuntimeModel[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry): RuntimeModel[] => {
    if (!entry || typeof entry !== "object") return [];
    const model = entry as Record<string, unknown>;
    if (typeof model.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model.id) || seen.has(model.id)) return [];
    seen.add(model.id);
    return [{ id: model.id, name: typeof model.name === "string" && model.name.trim() ? model.name.slice(0, 128) : model.id, description: typeof model.description === "string" ? model.description.slice(0, 512) : "Local runtime model" }];
  }).slice(0, 64);
}
export function readStoredModelCatalog(): RuntimeModel[] {
  if (typeof window === "undefined") return [];
  try { return normalizeModelCatalog(JSON.parse(window.localStorage.getItem(modelCatalogStorageKey) ?? "[]")); } catch { return []; }
}
export function persistModelCatalog(value: unknown): RuntimeModel[] {
  const catalog = normalizeModelCatalog(value);
  if (typeof window !== "undefined") { try { window.localStorage.setItem(modelCatalogStorageKey, JSON.stringify(catalog)); } catch { /* Live runtime choices remain usable without storage. */ } }
  return catalog;
}

export const effortOptions: EffortOption[] = [
  { value: "low", label: "Low", description: "Faster replies" },
  { value: "medium", label: "Medium", description: "Everyday default" },
  { value: "high", label: "High", description: "Deeper reasoning" },
  { value: "xhigh", label: "XHigh", description: "Complex tasks" },
  { value: "max", label: "Max", description: "Largest budget" }
];

export const tokenResearchRoutingProfile = {
  id: "tokenresearch" as const,
  label: "TokenResearch",
  description: "Local routing that approaches top-model quality at lower cost",
  coordinator: { model: "gpt-5.6-sol" as const, effort: "max" as const, mode: "ultra" as const },
  subagent: { agentType: "luna-worker", model: "gpt-5.6-luna" as const, effort: "max" as const }
};

export const defaultRoutingPreference: RoutingPreference = "tokenresearch";
export const routingPreferenceStorageKey = "openrigor.routing";
export const manualExecutionPreferenceStorageKey = "openrigor.execution.manual";
export const defaultManualExecutionPreference: ManualExecutionPreference = {
  model: "gpt-5.6-sol",
  effort: "medium",
  mode: "standard"
};

export const themeOptions: Array<{ value: ThemePreference; label: string; description: string }> = [
  { value: "light", label: "Light", description: "Light workspace" },
  { value: "dark", label: "Dark", description: "Dark workspace" },
  { value: "system", label: "System", description: "Match the device appearance" }
];

export const themeStorageKey = "openrigor.theme";

export function modelSupportsUltra(model: ModelId): boolean {
  return model === "gpt-5.6-sol" || model === "gpt-5.6-terra";
}

export function normalizeModeForModel(model: ModelId, mode: RunMode): RunMode {
  return mode === "ultra" && !modelSupportsUltra(model) ? "standard" : mode;
}

export function modelLabel(model: string): string {
  return readStoredModelCatalog().find((option) => option.id === model)?.name ?? modelOptions.find((option) => option.value === model)?.label ?? model;
}

export function effortLabel(effort: string): string {
  return effortOptions.find((option) => option.value === effort)?.label ?? effort;
}

export function resolveExecutionPreference(
  routing: RoutingPreference,
  model: ModelId,
  effort: Effort,
  mode: RunMode
): { model: ModelId; effort: Effort; mode: RunMode } {
  if (routing === "tokenresearch") {
    return {
      model: tokenResearchRoutingProfile.coordinator.model,
      effort: tokenResearchRoutingProfile.coordinator.effort,
      mode: tokenResearchRoutingProfile.coordinator.mode
    };
  }
  return { model, effort: mode === "ultra" ? "max" : effort, mode: normalizeModeForModel(model, mode) };
}

export function isRoutingPreference(value: unknown): value is RoutingPreference {
  return value === "manual" || value === "tokenresearch";
}

export function normalizeManualExecutionPreference(value: unknown): ManualExecutionPreference {
  if (!value || typeof value !== "object") return defaultManualExecutionPreference;
  const candidate = value as Record<string, unknown>;
  const model = modelOptions.some((option) => option.value === candidate.model) || readStoredModelCatalog().some((option) => option.id === candidate.model)
    ? candidate.model as ModelId
    : defaultManualExecutionPreference.model;
  const effort = effortOptions.some((option) => option.value === candidate.effort)
    ? candidate.effort as Effort
    : defaultManualExecutionPreference.effort;
  const mode = candidate.mode === "ultra" || candidate.mode === "standard"
    ? candidate.mode
    : defaultManualExecutionPreference.mode;
  return {
    model,
    effort: mode === "ultra" ? "max" : effort,
    mode: normalizeModeForModel(model, mode)
  };
}

export function readStoredManualExecutionPreference(): ManualExecutionPreference {
  if (typeof window === "undefined") return defaultManualExecutionPreference;
  try {
    const value = window.localStorage.getItem(manualExecutionPreferenceStorageKey);
    return value ? normalizeManualExecutionPreference(JSON.parse(value)) : defaultManualExecutionPreference;
  } catch {
    return defaultManualExecutionPreference;
  }
}

export function persistManualExecutionPreference(preference: ManualExecutionPreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      manualExecutionPreferenceStorageKey,
      JSON.stringify(normalizeManualExecutionPreference(preference))
    );
  } catch {
    // A private browsing policy may make localStorage unavailable. The live selection still applies.
  }
}

export function readStoredRoutingPreference(): RoutingPreference {
  if (typeof window === "undefined") return defaultRoutingPreference;
  try {
    const value = window.localStorage.getItem(routingPreferenceStorageKey);
    return isRoutingPreference(value) ? value : defaultRoutingPreference;
  } catch {
    return defaultRoutingPreference;
  }
}

export function persistRoutingPreference(routing: RoutingPreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(routingPreferenceStorageKey, routing);
  } catch {
    // A private browsing policy may make localStorage unavailable. The live selection still applies.
  }
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function resolveTheme(theme: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  return theme === "system" ? (systemPrefersDark ? "dark" : "light") : theme;
}

export function readStoredTheme(): ThemePreference {
  if (typeof window === "undefined") return "dark";
  try {
    const value = window.localStorage.getItem(themeStorageKey);
    return isThemePreference(value) ? value : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: ThemePreference): ResolvedTheme {
  const systemPrefersDark = Boolean(typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const resolved = resolveTheme(theme, systemPrefersDark);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = theme;
    document.documentElement.style.colorScheme = resolved;
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }
  return resolved;
}

export function persistTheme(theme: ThemePreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(themeStorageKey, theme);
  } catch {
    // A private browsing policy may make localStorage unavailable. The live theme still applies.
  }
}

export const initialThemePreference = readStoredTheme();
applyTheme(initialThemePreference);
