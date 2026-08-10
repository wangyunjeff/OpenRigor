import assert from "node:assert/strict";
import test from "node:test";
import {
  effortOptions,
  isThemePreference,
  modelOptions,
  modelSupportsUltra,
  normalizeModeForModel,
  resolveTheme
} from "../src/workspace-preferences";

test("exposes the complete GPT-5.6 model and reasoning choices", () => {
  assert.deepEqual(
    modelOptions.map((option) => option.value),
    ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "auto"]
  );
  assert.deepEqual(
    effortOptions.map((option) => option.value),
    ["low", "medium", "high", "xhigh", "max"]
  );
});

test("keeps Ultra separate and available only for Sol and Terra", () => {
  assert.equal(modelSupportsUltra("gpt-5.6-sol"), true);
  assert.equal(modelSupportsUltra("gpt-5.6-terra"), true);
  assert.equal(modelSupportsUltra("gpt-5.6-luna"), false);
  assert.equal(modelSupportsUltra("auto"), false);
  assert.equal(normalizeModeForModel("gpt-5.6-sol", "ultra"), "ultra");
  assert.equal(normalizeModeForModel("gpt-5.6-luna", "ultra"), "standard");
  assert.equal(normalizeModeForModel("auto", "ultra"), "standard");
});

test("resolves and validates persisted theme preferences", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(isThemePreference("dark"), true);
  assert.equal(isThemePreference("sepia"), false);
});
