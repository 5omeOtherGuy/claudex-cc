import { CONFIG_VERSION } from "./schema.js";

export interface ClaudexConfig {
  readonly configVersion: number;
  readonly runtime: {
    readonly mode: "persistent" | "session";
    readonly host: string;
    readonly port: number;
  };
  readonly gateway: {
    readonly implementation: "cliproxyapi";
    readonly version: string;
    readonly updateChannel: "pinned" | "stable";
  };
  readonly models: {
    readonly main: string;
    readonly subagent: string;
    readonly fallback: string;
  };
  readonly reasoning: {
    readonly effort: "low" | "medium" | "high" | "xhigh" | "max";
  };
  readonly context: {
    readonly advertisedWindow: number;
    readonly compactAt: number;
    readonly maxOutputTokens: number;
  };
  /** Bounded gateway-side request policy. */
  readonly requests: {
    /**
     * Gateway retries for transient upstream failures (403/408/5xx). Permanent
     * failures (validation, auth) are never retried by the gateway.
     */
    readonly retries: number;
  };
  /** Explicit opt-in compatibility options with documented consequences. */
  readonly advanced: {
    /** Sticky credential routing per client session (gateway routing.session-affinity). */
    readonly sessionAffinity: boolean;
    /** SSE keep-alive interval in seconds; 0 disables (gateway streaming.keepalive-seconds). */
    readonly streamingKeepaliveSeconds: number;
    /** Gateway-side retries before the first streamed byte (streaming.bootstrap-retries). */
    readonly streamingBootstrapRetries: number;
    /** false starts the gateway with its embedded model catalog only (--local-model). */
    readonly remoteModelCatalog: boolean;
  };
}

export const DEFAULT_CONFIG: ClaudexConfig = {
  configVersion: CONFIG_VERSION,
  runtime: {
    mode: "persistent",
    host: "127.0.0.1",
    port: 8317,
  },
  gateway: {
    implementation: "cliproxyapi",
    version: "7.2.86",
    updateChannel: "pinned",
  },
  models: {
    main: "gpt-5.6-sol",
    subagent: "gpt-5.6-luna",
    fallback: "gpt-5.6-terra",
  },
  reasoning: {
    effort: "medium",
  },
  context: {
    advertisedWindow: 372_000,
    compactAt: 230_000,
    maxOutputTokens: 32_768,
  },
  requests: {
    retries: 3,
  },
  advanced: {
    sessionAffinity: false,
    streamingKeepaliveSeconds: 0,
    streamingBootstrapRetries: 0,
    remoteModelCatalog: true,
  },
};
