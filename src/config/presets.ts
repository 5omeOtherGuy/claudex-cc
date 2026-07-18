import type { ClaudexConfig } from "./defaults.js";

export type PresetName = "compatibility" | "balanced" | "max-reasoning";

export interface Preset {
  readonly name: PresetName;
  readonly description: string;
  /** The sections a preset controls; everything else is left untouched. */
  readonly values: {
    readonly reasoning: ClaudexConfig["reasoning"];
    readonly context: ClaudexConfig["context"];
    readonly requests: ClaudexConfig["requests"];
  };
}

/**
 * Every preset satisfies the schema's context-headroom rule:
 * compactAt + maxOutputTokens + tool/reasoning reserve < advertisedWindow.
 */
export const PRESETS: readonly Preset[] = [
  {
    name: "compatibility",
    description:
      "Most conservative: a smaller advertised window, early compaction, modest output, medium reasoning. Use when sessions hit context or output limits.",
    values: {
      reasoning: { effort: "medium" },
      context: { advertisedWindow: 200_000, compactAt: 150_000, maxOutputTokens: 16_384 },
      requests: { retries: 3 },
    },
  },
  {
    name: "balanced",
    description: "Default trade-off between context capacity, output budget, and reasoning depth.",
    values: {
      reasoning: { effort: "medium" },
      context: { advertisedWindow: 372_000, compactAt: 230_000, maxOutputTokens: 32_768 },
      requests: { retries: 3 },
    },
  },
  {
    name: "max-reasoning",
    description:
      "Deepest reasoning and the largest output budget; compaction fires earlier to reserve the extra headroom.",
    values: {
      reasoning: { effort: "xhigh" },
      context: { advertisedWindow: 372_000, compactAt: 200_000, maxOutputTokens: 65_536 },
      requests: { retries: 3 },
    },
  },
];

export function findPreset(name: string): Preset | undefined {
  return PRESETS.find((preset) => preset.name === name);
}

/** Applies a preset onto an existing config without touching unrelated sections. */
export function applyPreset(config: ClaudexConfig, preset: Preset): ClaudexConfig {
  return {
    ...config,
    reasoning: preset.values.reasoning,
    context: preset.values.context,
    requests: preset.values.requests,
  };
}
