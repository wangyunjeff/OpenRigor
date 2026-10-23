interface ComposerKeyEvent {
  key: string;
  keyCode?: number;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}

/** Safari may report the confirmation Enter after compositionend with keyCode 229. */
export function isComposerComposing(event: ComposerKeyEvent, composing = false): boolean {
  return composing || event.isComposing === true || event.nativeEvent?.isComposing === true || event.keyCode === 229 || event.nativeEvent?.keyCode === 229;
}
