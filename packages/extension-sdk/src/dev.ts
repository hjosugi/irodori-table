import type {
  DevLogEntry,
  ExtensionManifest,
  FakeDatabaseFixture,
  PermissionInspection,
  PermissionScope,
} from "./generated/irodori-extension-api";

export interface ExtensionDevSession {
  readonly manifest: ExtensionManifest;
  readonly fixtures: readonly FakeDatabaseFixture[];
  readonly permissions: PermissionInspection;
  readonly logs: readonly DevLogEntry[];
}

export interface ExtensionDevHost {
  reload(reason: string): Promise<void>;
  inspectPermissions(manifest: ExtensionManifest): PermissionInspection;
  loadFixtures(manifest: ExtensionManifest): Promise<readonly FakeDatabaseFixture[]>;
  readLogs(): Promise<readonly DevLogEntry[]>;
}

export const sensitivePermissionScopes: readonly PermissionScope[] = [
  "connections:write",
  "queries:run",
  "queryResults:read",
  "queryResults:write",
  "files:write",
  "native",
  "wasm",
];
