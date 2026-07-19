import type { DbEngine } from "@/generated/irodori-api";
import engineConnectionConfig from "./engine-connection-config.json";

export type EngineConnectionInputMode = "url" | "fields";

export type EngineConnectionSettings = {
  preferredMode: EngineConnectionInputMode;
  urlLabel: string;
  urlPlaceholder: string;
  fieldsLabel: string;
  hostLabel: string;
  hostPlaceholder: string;
  portLabel: string;
  userLabel: string;
  userPlaceholder: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  databaseLabel: string;
  databasePlaceholder: string;
  showHost: boolean;
  showPort: boolean;
  showUser: boolean;
  showPassword: boolean;
  transportLabel: string;
};

type EngineConnectionSettingsPatch = Partial<EngineConnectionSettings>;

type EngineConnectionSettingsGroup = {
  engines: DbEngine[];
  settings: EngineConnectionSettingsPatch;
};

/**
 * One connector setting carried in `ConnectionProfile.options` rather than in a
 * dedicated profile column. The Rust side forwards the whole options map to the
 * connector verbatim (extensions/connection.rs `connect_request`), so `key` has
 * to match what the connector reads.
 *
 * Keys mirror the connector manifest model in
 * tools/extensions/scaffold-connector-repos.mjs, where these same settings are
 * declared as `option:`-bound endpoint fields. Keep the two in step.
 */
export type EngineOptionField = {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
};

type EngineOptionFieldGroup = {
  engines: DbEngine[];
  fields: EngineOptionField[];
};

const configuredOptionFields = new Map<DbEngine, EngineOptionField[]>(
  (engineConnectionConfig.optionFields as EngineOptionFieldGroup[]).flatMap(
    (group) => group.engines.map((engine) => [engine, group.fields]),
  ),
);

const noOptionFields: EngineOptionField[] = [];

export function engineOptionFields(engine: DbEngine): EngineOptionField[] {
  return configuredOptionFields.get(engine) ?? noOptionFields;
}

const tcpDatabaseSettings =
  engineConnectionConfig.defaultSettings as EngineConnectionSettings;

const configuredEngineSettings = new Map<
  DbEngine,
  EngineConnectionSettingsPatch
>(
  (
    engineConnectionConfig.engineSettings as EngineConnectionSettingsGroup[]
  ).flatMap((group) => group.engines.map((engine) => [engine, group.settings])),
);

const configuredDefaultPorts = engineConnectionConfig.defaultPorts as Partial<
  Record<DbEngine, string>
>;

export function engineConnectionSettings(
  engine: DbEngine,
): EngineConnectionSettings {
  const settings = configuredEngineSettings.get(engine);
  if (!settings) {
    return {
      ...tcpDatabaseSettings,
      portLabel: defaultPort(engine) ? "Port" : "Port (optional)",
    };
  }
  return {
    ...tcpDatabaseSettings,
    ...settings,
  };
}

export function defaultPort(engine: DbEngine) {
  return configuredDefaultPorts[engine] ?? "";
}
