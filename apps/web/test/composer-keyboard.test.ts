import assert from "node:assert/strict";
import test from "node:test";
import { isComposerComposing } from "../src/composer-keyboard";

test("Chinese IME confirmation Enter is guarded for native and React events", () => {
  assert.equal(isComposerComposing({ key: "Enter", isComposing: true }), true);
  assert.equal(isComposerComposing({ key: "Enter", nativeEvent: { isComposing: true } }), true);
  assert.equal(isComposerComposing({ key: "Enter" }, true), true);
});

test("Safari confirmation and IME candidate navigation never reach palette shortcuts", () => {
  assert.equal(isComposerComposing({ key: "Enter", keyCode: 229 }), true);
  assert.equal(isComposerComposing({ key: "Enter", nativeEvent: { keyCode: 229, isComposing: false } }), true);
  for (const key of ["ArrowDown", "ArrowUp", "Escape", "Backspace"]) assert.equal(isComposerComposing({ key, nativeEvent: { isComposing: true } }), true);
});

test("ordinary keyboard input remains available after composition finishes", () => {
  for (const key of ["Enter", "ArrowDown", "ArrowUp", "Escape", "Backspace"]) assert.equal(isComposerComposing({ key, nativeEvent: { isComposing: false, keyCode: 13 } }), false);
});
