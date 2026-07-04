import { isRecord } from "@/app/app-workbench-utils";

export const CURRENT_SETTINGS_SCHEMA_VERSION = 1;

type Migration = (settings: Record<string, unknown>) => Record<string, unknown>;

const migrations: Record<number, Migration> = {
  0: migrateV0ToV1,
};

export function migrateSettingsJson(
  input: Record<string, unknown>,
): Record<string, unknown> {
  let settings = { ...input };
  let version = readSettingsVersion(settings.version);

  while (version < CURRENT_SETTINGS_SCHEMA_VERSION) {
    const migration = migrations[version];
    if (!migration) {
      throw new Error(`No settings migration from version ${version}`);
    }
    settings = migration(settings);
    version += 1;
  }

  if (version > CURRENT_SETTINGS_SCHEMA_VERSION) {
    throw new Error(
      `Settings schema version ${version} is newer than this app supports (${CURRENT_SETTINGS_SCHEMA_VERSION})`,
    );
  }

  return {
    ...settings,
    version,
  };
}

function readSettingsVersion(value: unknown) {
  if (value === undefined || value === null) {
    return 0;
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error("settings JSON version must be a non-negative integer");
  }
  return value;
}

function migrateV0ToV1(settings: Record<string, unknown>) {
  const migrated = { ...settings };
  const legacyLayout = migrated.layout;
  if (isRecord(legacyLayout)) {
    migrated.layout = { ...legacyLayout };
  }
  return {
    ...migrated,
    version: 1,
  };
}
