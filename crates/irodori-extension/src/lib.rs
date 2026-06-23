//! Extension manifest, SDK contract, and development-host types.
//!
//! These structs are the Rust source of truth for the TypeScript extension SDK.
//! They intentionally describe the public extension boundary, not desktop internals.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const CRATE_NAME: &str = "irodori-extension";
pub const CURRENT_MANIFEST_VERSION: u16 = 1;
pub const CURRENT_API_VERSION: &str = "0.1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum ExtensionRuntime {
    #[serde(rename = "typescript")]
    #[ts(rename = "typescript")]
    TypeScript,
    #[serde(rename = "javascript")]
    #[ts(rename = "javascript")]
    JavaScript,
    #[serde(rename = "wasm")]
    #[ts(rename = "wasm")]
    Wasm,
    #[serde(rename = "native")]
    #[ts(rename = "native")]
    Native,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum PermissionScope {
    #[serde(rename = "commands")]
    #[ts(rename = "commands")]
    Commands,
    #[serde(rename = "keybindings")]
    #[ts(rename = "keybindings")]
    Keybindings,
    #[serde(rename = "workspace:read")]
    #[ts(rename = "workspace:read")]
    WorkspaceRead,
    #[serde(rename = "connections:read")]
    #[ts(rename = "connections:read")]
    ConnectionsRead,
    #[serde(rename = "connections:write")]
    #[ts(rename = "connections:write")]
    ConnectionsWrite,
    #[serde(rename = "queries:run")]
    #[ts(rename = "queries:run")]
    QueriesRun,
    #[serde(rename = "queryResults:read")]
    #[ts(rename = "queryResults:read")]
    QueryResultsRead,
    #[serde(rename = "queryResults:write")]
    #[ts(rename = "queryResults:write")]
    QueryResultsWrite,
    #[serde(rename = "metadata:read")]
    #[ts(rename = "metadata:read")]
    MetadataRead,
    #[serde(rename = "files:read")]
    #[ts(rename = "files:read")]
    FilesRead,
    #[serde(rename = "files:write")]
    #[ts(rename = "files:write")]
    FilesWrite,
    #[serde(rename = "themes")]
    #[ts(rename = "themes")]
    Themes,
    #[serde(rename = "sqlDialects")]
    #[ts(rename = "sqlDialects")]
    SqlDialects,
    #[serde(rename = "resultRenderers")]
    #[ts(rename = "resultRenderers")]
    ResultRenderers,
    #[serde(rename = "logs")]
    #[ts(rename = "logs")]
    Logs,
    #[serde(rename = "dev:fixtures")]
    #[ts(rename = "dev:fixtures")]
    DevFixtures,
    #[serde(rename = "native")]
    #[ts(rename = "native")]
    Native,
    #[serde(rename = "wasm")]
    #[ts(rename = "wasm")]
    Wasm,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ExtensionManifest {
    pub manifest_version: u16,
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub publisher: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
    pub license: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub repository: Option<String>,
    pub api_version: String,
    pub runtime: ExtensionRuntime,
    pub entry: String,
    #[serde(default)]
    pub permissions: Vec<PermissionScope>,
    #[serde(default)]
    pub contributes: ExtensionContributions,
    #[serde(default)]
    pub capabilities: ExtensionCapabilities,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub dev: Option<ExtensionDevConfig>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ExtensionContributions {
    #[serde(default)]
    pub commands: Vec<CommandContribution>,
    #[serde(default)]
    pub keybindings: Vec<KeybindingContribution>,
    #[serde(default)]
    pub result_grid_actions: Vec<ResultGridActionContribution>,
    #[serde(default)]
    pub result_grid_renderers: Vec<ResultGridRendererContribution>,
    #[serde(default)]
    pub themes: Vec<ThemeContribution>,
    #[serde(default)]
    pub sql_dialects: Vec<SqlDialectContribution>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ExtensionCapabilities {
    #[serde(default)]
    pub wasm_modules: Vec<WasmModuleContribution>,
    #[serde(default)]
    pub native_modules: Vec<NativeModuleContribution>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct CommandContribution {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub enablement: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct KeybindingContribution {
    pub command: String,
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub mac: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub windows: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub linux: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub when: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ResultGridActionContribution {
    pub id: String,
    pub title: String,
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub when: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ResultGridRendererContribution {
    pub id: String,
    pub title: String,
    pub path: String,
    #[serde(default)]
    pub media_types: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ThemeContribution {
    pub id: String,
    pub label: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub kind: Option<ThemeKind>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum ThemeKind {
    Light,
    Dark,
    HighContrast,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ThemeDefinition {
    pub id: String,
    pub name: String,
    pub kind: ThemeKind,
    #[serde(default)]
    pub colors: BTreeMap<String, String>,
    #[serde(default)]
    pub token_colors: Vec<TokenColorRule>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct TokenColorRule {
    #[serde(default)]
    pub scope: Vec<String>,
    #[serde(default)]
    pub settings: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct SqlDialectContribution {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub file_extensions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct SqlDialectDefinition {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub keywords: Vec<SqlKeyword>,
    #[serde(default)]
    pub snippets: Vec<SqlSnippet>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub formatter: Option<SqlFormatterConfig>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct SqlKeyword {
    pub word: String,
    pub category: SqlKeywordCategory,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum SqlKeywordCategory {
    Keyword,
    Function,
    Type,
    Operator,
    Procedure,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct SqlSnippet {
    pub label: String,
    pub insert_text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct SqlFormatterConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub keyword_case: Option<SqlKeywordCase>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub identifier_quote: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum SqlKeywordCase {
    Upper,
    Lower,
    Preserve,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct WasmModuleContribution {
    pub id: String,
    pub path: String,
    pub abi: String,
    #[serde(default)]
    pub exports: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct NativeModuleContribution {
    pub id: String,
    pub path: String,
    pub platforms: Vec<NativePlatform>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum NativePlatform {
    WindowsX64,
    WindowsArm64,
    MacosX64,
    MacosArm64,
    LinuxX64,
    LinuxArm64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ResultGridColumn {
    pub name: String,
    pub data_type: String,
    #[serde(default)]
    pub nullable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ResultGridCell {
    pub column: String,
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ResultGridRow {
    pub row_index: u32,
    pub cells: Vec<ResultGridCell>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ResultGridSelection {
    #[serde(default)]
    pub columns: Vec<String>,
    #[serde(default)]
    pub rows: Vec<u32>,
    #[serde(default)]
    pub cells: Vec<ResultGridCell>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ResultGridSnapshot {
    pub columns: Vec<ResultGridColumn>,
    pub rows: Vec<ResultGridRow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub selection: Option<ResultGridSelection>,
    #[serde(default)]
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ExtensionDevConfig {
    #[serde(default)]
    pub watch: Vec<String>,
    #[serde(default)]
    pub fixtures: Vec<FakeDatabaseFixture>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub log_file: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct FakeDatabaseFixture {
    pub id: String,
    pub engine: String,
    #[serde(default)]
    pub schemas: Vec<FakeSchemaFixture>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct FakeSchemaFixture {
    pub name: String,
    #[serde(default)]
    pub tables: Vec<FakeTableFixture>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct FakeTableFixture {
    pub name: String,
    #[serde(default)]
    pub columns: Vec<FakeColumnFixture>,
    #[serde(default)]
    pub rows: Vec<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct FakeColumnFixture {
    pub name: String,
    pub data_type: String,
    #[serde(default)]
    pub nullable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum DevLogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct DevLogEntry {
    pub level: DevLogLevel,
    pub message: String,
    pub target: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct PermissionInspection {
    #[serde(default)]
    pub declared: Vec<PermissionScope>,
    #[serde(default)]
    pub sensitive: Vec<PermissionScope>,
    #[serde(default)]
    pub missing_for_contributions: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn manifest_serializes_with_camel_case_fields() {
        let manifest = ExtensionManifest {
            manifest_version: CURRENT_MANIFEST_VERSION,
            id: "example.quick-export".into(),
            name: "Quick Export".into(),
            version: "0.1.0".into(),
            publisher: None,
            description: None,
            license: "MIT OR 0BSD".into(),
            repository: None,
            api_version: CURRENT_API_VERSION.into(),
            runtime: ExtensionRuntime::TypeScript,
            entry: "dist/main.js".into(),
            permissions: vec![PermissionScope::Commands, PermissionScope::QueryResultsRead],
            contributes: ExtensionContributions {
                commands: vec![CommandContribution {
                    id: "quickExport.copyAsMarkdown".into(),
                    title: "Copy Result as Markdown Table".into(),
                    category: Some("Result Grid".into()),
                    enablement: Some("resultGridFocus".into()),
                }],
                ..ExtensionContributions::default()
            },
            capabilities: ExtensionCapabilities::default(),
            dev: None,
        };

        assert_eq!(
            serde_json::to_value(manifest).unwrap(),
            json!({
                "manifestVersion": 1,
                "id": "example.quick-export",
                "name": "Quick Export",
                "version": "0.1.0",
                "license": "MIT OR 0BSD",
                "apiVersion": "0.1",
                "runtime": "typescript",
                "entry": "dist/main.js",
                "permissions": ["commands", "queryResults:read"],
                "contributes": {
                    "commands": [{
                        "id": "quickExport.copyAsMarkdown",
                        "title": "Copy Result as Markdown Table",
                        "category": "Result Grid",
                        "enablement": "resultGridFocus"
                    }],
                    "keybindings": [],
                    "resultGridActions": [],
                    "resultGridRenderers": [],
                    "themes": [],
                    "sqlDialects": []
                },
                "capabilities": {
                    "wasmModules": [],
                    "nativeModules": []
                }
            })
        );
    }

    #[test]
    fn permission_inspection_serializes_empty_lists() {
        assert_eq!(
            serde_json::to_value(PermissionInspection {
                declared: vec![PermissionScope::Native],
                sensitive: vec![PermissionScope::Native],
                missing_for_contributions: vec![]
            })
            .unwrap(),
            json!({
                "declared": ["native"],
                "sensitive": ["native"],
                "missingForContributions": []
            })
        );
    }
}

#[cfg(test)]
mod typegen {
    use super::*;
    use std::path::Path;
    use typebridge::ir::{Decl, TsType};
    use typebridge::Bridge;
    use typebridge_ts_rs::decl;

    const GENERATED: &str = "../../packages/extension-sdk/src/generated/irodori-extension-api.ts";

    fn bridge() -> Bridge {
        Bridge::fetch()
            .header("// @generated by cargo test -p irodori-extension export_typescript_bindings. Do not edit.")
            .decl(&Decl::alias("JsonValue", TsType::unknown()))
            .decl(&decl::<ExtensionRuntime>())
            .decl(&decl::<PermissionScope>())
            .decl(&decl::<ExtensionManifest>())
            .decl(&decl::<ExtensionContributions>())
            .decl(&decl::<ExtensionCapabilities>())
            .decl(&decl::<CommandContribution>())
            .decl(&decl::<KeybindingContribution>())
            .decl(&decl::<ResultGridActionContribution>())
            .decl(&decl::<ResultGridRendererContribution>())
            .decl(&decl::<ThemeContribution>())
            .decl(&decl::<ThemeKind>())
            .decl(&decl::<ThemeDefinition>())
            .decl(&decl::<TokenColorRule>())
            .decl(&decl::<SqlDialectContribution>())
            .decl(&decl::<SqlDialectDefinition>())
            .decl(&decl::<SqlKeyword>())
            .decl(&decl::<SqlKeywordCategory>())
            .decl(&decl::<SqlSnippet>())
            .decl(&decl::<SqlFormatterConfig>())
            .decl(&decl::<SqlKeywordCase>())
            .decl(&decl::<WasmModuleContribution>())
            .decl(&decl::<NativeModuleContribution>())
            .decl(&decl::<NativePlatform>())
            .decl(&decl::<ResultGridColumn>())
            .decl(&decl::<ResultGridCell>())
            .decl(&decl::<ResultGridRow>())
            .decl(&decl::<ResultGridSelection>())
            .decl(&decl::<ResultGridSnapshot>())
            .decl(&decl::<ExtensionDevConfig>())
            .decl(&decl::<FakeDatabaseFixture>())
            .decl(&decl::<FakeSchemaFixture>())
            .decl(&decl::<FakeTableFixture>())
            .decl(&decl::<FakeColumnFixture>())
            .decl(&decl::<DevLogLevel>())
            .decl(&decl::<DevLogEntry>())
            .decl(&decl::<PermissionInspection>())
            .with_assert_never(true)
    }

    #[test]
    fn export_typescript_bindings() {
        let rendered = bridge().render();
        let path = Path::new(GENERATED);

        if std::env::var_os("CI").is_some() {
            let outcome = rendered
                .check(path)
                .expect("read generated extension SDK bindings");
            assert!(
                outcome.is_up_to_date(),
                "{} — run `cargo test -p irodori-extension export_typescript_bindings` and commit the result",
                outcome.summary()
            );
        } else {
            rendered
                .write(path)
                .expect("write generated extension SDK bindings");
        }
    }
}
