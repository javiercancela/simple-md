export type ExternalAction = "ignore" | "reload" | "prompt-reload" | "removed" | "prompt-removed";

export function decideExternalChange(input: {
  dirty: boolean;
  exists: boolean;
  contentChanged: boolean;
}): ExternalAction {
  if (!input.exists) return input.dirty ? "prompt-removed" : "removed";
  if (!input.contentChanged) return "ignore";
  return input.dirty ? "prompt-reload" : "reload";
}
