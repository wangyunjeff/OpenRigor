export type ModelId = "auto" | "gpt-5.6-sol" | "gpt-5.6-terra" | "gpt-5.6-luna";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type RunMode = "standard" | "ultra";
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

export const modelOptions: ModelOption[] = [
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol", description: "复杂推理、工程与长链路任务", group: "gpt-5.6" },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra", description: "兼顾速度与质量的日常主力", group: "gpt-5.6" },
  { value: "gpt-5.6-luna", label: "GPT-5.6 Luna", description: "快速迭代与聚焦执行", group: "gpt-5.6" },
  { value: "auto", label: "Auto", description: "跟随本地 Codex 当前设置", group: "local" }
];

export const effortOptions: EffortOption[] = [
  { value: "low", label: "Low", description: "更快响应" },
  { value: "medium", label: "Medium", description: "日常默认" },
  { value: "high", label: "High", description: "深入推理" },
  { value: "xhigh", label: "XHigh", description: "复杂任务" },
  { value: "max", label: "Max", description: "最高预算" }
];

export const themeOptions: Array<{ value: ThemePreference; label: string; description: string }> = [
  { value: "light", label: "明亮", description: "浅色工作区" },
  { value: "dark", label: "深色", description: "深色工作区" },
  { value: "system", label: "跟随系统", description: "自动匹配设备外观" }
];

export const themeStorageKey = "openrigor.theme";

export function modelSupportsUltra(model: ModelId): boolean {
  return model === "gpt-5.6-sol" || model === "gpt-5.6-terra";
}

export function normalizeModeForModel(model: ModelId, mode: RunMode): RunMode {
  return mode === "ultra" && !modelSupportsUltra(model) ? "standard" : mode;
}

export function modelLabel(model: string): string {
  return modelOptions.find((option) => option.value === model)?.label ?? model;
}

export function effortLabel(effort: string): string {
  return effortOptions.find((option) => option.value === effort)?.label ?? effort;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function resolveTheme(theme: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  return theme === "system" ? (systemPrefersDark ? "dark" : "light") : theme;
}

export function readStoredTheme(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const value = window.localStorage.getItem(themeStorageKey);
    return isThemePreference(value) ? value : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme: ThemePreference): ResolvedTheme {
  const systemPrefersDark = Boolean(typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const resolved = resolveTheme(theme, systemPrefersDark);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = theme;
    document.documentElement.style.colorScheme = resolved;
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
