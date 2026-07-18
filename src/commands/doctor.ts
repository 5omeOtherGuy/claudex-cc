import { arch, platform, release } from "node:os";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import { VERSION } from "../version.js";

export interface DoctorReport {
  readonly status: "scaffold";
  readonly claudexVersion: string;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly architecture: string;
  readonly osRelease: string;
  readonly gatewayTarget: string;
  readonly gatewayVersion: string;
  readonly note: string;
}

export function createOfflineDoctorReport(): DoctorReport {
  return {
    status: "scaffold",
    claudexVersion: VERSION,
    nodeVersion: process.version,
    platform: platform(),
    architecture: arch(),
    osRelease: release(),
    gatewayTarget: `http://${DEFAULT_CONFIG.runtime.host}:${DEFAULT_CONFIG.runtime.port}`,
    gatewayVersion: DEFAULT_CONFIG.gateway.version,
    note: "Manager installation and live gateway checks are not implemented yet.",
  };
}
