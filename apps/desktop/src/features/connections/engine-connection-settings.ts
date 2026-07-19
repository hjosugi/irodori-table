import type { DbEngine } from "@/generated/irodori-api";
import type { TranslationKey, Translator } from "@/i18n";
import engineConnectionConfig from "./engine-connection-config.json";

export type EngineConnectionInputMode = "url" | "fields";

/**
 * The form layout exactly as declared in engine-connection-config.json.
 *
 * Labels are translation keys; placeholders are literal examples (DSNs, host
 * names, region codes) that read the same in every locale and so stay in the
 * config verbatim. The three placeholders that are prose rather than examples
 * are omitted there and filled in from `prosePlaceholderKeys` below.
 */
export type EngineConnectionLayout = {
  preferredMode: EngineConnectionInputMode;
  urlLabelKey: TranslationKey;
  urlPlaceholder: string;
  fieldsLabelKey: TranslationKey;
  hostLabelKey: TranslationKey;
  hostPlaceholder: string;
  portLabelKey: TranslationKey;
  userLabelKey: TranslationKey;
  userPlaceholder?: string;
  passwordLabelKey: TranslationKey;
  passwordPlaceholder?: string;
  databaseLabelKey: TranslationKey;
  databasePlaceholder?: string;
  showHost: boolean;
  showPort: boolean;
  showUser: boolean;
  showPassword: boolean;
  transportLabelKey: TranslationKey;
};

/** The same layout with every label resolved for display. */
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

/**
 * Placeholders that describe the field rather than show an example value, so
 * they have to follow the app locale. Engines that want a literal example
 * (`token`, `AwsDataCatalog/default`, …) override them in the config.
 */
const prosePlaceholderKeys = {
  user: "connection.placeholder.username",
  password: "connection.placeholder.password",
  database: "connection.placeholder.databaseName",
} as const satisfies Record<string, TranslationKey>;

type EngineConnectionLayoutPatch = Partial<EngineConnectionLayout>;

type EngineConnectionLayoutGroup = {
  engines: DbEngine[];
  settings: EngineConnectionLayoutPatch;
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
  labelKey: TranslationKey;
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

const tcpDatabaseLayout =
  engineConnectionConfig.defaultSettings as EngineConnectionLayout;

const configuredEngineSettings = new Map<DbEngine, EngineConnectionLayoutPatch>(
  (
    engineConnectionConfig.engineSettings as EngineConnectionLayoutGroup[]
  ).flatMap((group) => group.engines.map((engine) => [engine, group.settings])),
);

const configuredDefaultPorts = engineConnectionConfig.defaultPorts as Partial<
  Record<DbEngine, string>
>;

/** Untranslated layout, for callers that only need the shape of the form. */
export function engineConnectionLayout(
  engine: DbEngine,
): EngineConnectionLayout {
  const settings = configuredEngineSettings.get(engine);
  if (!settings) {
    return {
      ...tcpDatabaseLayout,
      portLabelKey: defaultPort(engine)
        ? "connection.field.port"
        : "connection.field.portOptional",
    };
  }
  return {
    ...tcpDatabaseLayout,
    ...settings,
  };
}

export function engineConnectionSettings(
  engine: DbEngine,
  t: Translator["t"],
): EngineConnectionSettings {
  const layout = engineConnectionLayout(engine);
  return {
    preferredMode: layout.preferredMode,
    urlLabel: t(layout.urlLabelKey),
    urlPlaceholder: layout.urlPlaceholder,
    fieldsLabel: t(layout.fieldsLabelKey),
    hostLabel: t(layout.hostLabelKey),
    hostPlaceholder: layout.hostPlaceholder,
    portLabel: t(layout.portLabelKey),
    userLabel: t(layout.userLabelKey),
    userPlaceholder: layout.userPlaceholder ?? t(prosePlaceholderKeys.user),
    passwordLabel: t(layout.passwordLabelKey),
    passwordPlaceholder:
      layout.passwordPlaceholder ?? t(prosePlaceholderKeys.password),
    databaseLabel: t(layout.databaseLabelKey),
    databasePlaceholder:
      layout.databasePlaceholder ?? t(prosePlaceholderKeys.database),
    showHost: layout.showHost,
    showPort: layout.showPort,
    showUser: layout.showUser,
    showPassword: layout.showPassword,
    transportLabel: t(layout.transportLabelKey),
  };
}

export function defaultPort(engine: DbEngine) {
  return configuredDefaultPorts[engine] ?? "";
}
