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
    #[serde(rename = "connectors")]
    #[ts(rename = "connectors")]
    Connectors,
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
    #[serde(rename = "statusBar")]
    #[ts(rename = "statusBar")]
    StatusBar,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
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

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
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
    pub status_bar_items: Vec<StatusBarItemContribution>,
    #[serde(default)]
    pub themes: Vec<ThemeContribution>,
    #[serde(default)]
    pub sql_dialects: Vec<SqlDialectContribution>,
    #[serde(default)]
    pub connectors: Vec<ConnectorContribution>,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum StatusBarAlignment {
    Left,
    Right,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct StatusBarItemContribution {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub alignment: Option<StatusBarAlignment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub priority: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tooltip: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub when: Option<String>,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ConnectorContribution {
    pub id: String,
    pub engine: String,
    pub label: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub default_port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub wire: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub module: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub dialect: Option<String>,
    #[serde(default)]
    pub features: Vec<ConnectorFeature>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub connection: Option<ConnectorConnectionModel>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub experience: Option<ConnectorExperienceModel>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum ConnectorFeature {
    Sql,
    Metadata,
    Transactions,
    Streaming,
    PreparedQueries,
    Explain,
    ResultEditing,
    Graph,
    GraphVisualization,
    PathFinding,
    GraphAlgorithms,
    VectorSearch,
    EmbeddingSearch,
    HybridSearch,
    FullTextSearch,
    FacetedSearch,
    TimeSeries,
    TimeBuckets,
    LatestValue,
    AsOfJoin,
    Warehouse,
    QueryHistory,
    QueryProfile,
    WorkloadMonitoring,
    DataLoading,
    DataEngineering,
    SemanticLayer,
    AiSql,
    SqlFormatting,
    QueryTemplates,
    Visualization,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ConnectorConnectionModel {
    pub schema_version: u16,
    #[serde(default)]
    pub infer_environment_from: Vec<String>,
    pub compatibility: ConnectorConnectionCompatibility,
    pub defaults: ConnectorConnectionDefaults,
    pub endpoint: ConnectorEndpointModel,
    #[serde(default)]
    pub profile_fields: Vec<ConnectorConnectionField>,
    #[serde(default)]
    pub auth_methods: Vec<ConnectorAuthMethod>,
    #[serde(default)]
    pub secret_purposes: Vec<ConnectorSecretPurpose>,
    pub tls: ConnectorTlsModel,
    #[serde(default)]
    pub transports: Vec<ConnectorTransportMode>,
    #[serde(default)]
    pub option_namespaces: Vec<String>,
    #[serde(default)]
    pub custom_driver_options: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ConnectorConnectionCompatibility {
    pub adds_required_profile_fields: bool,
    pub accepts_existing_profiles: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ConnectorConnectionDefaults {
    pub engine: String,
    pub wire: String,
    pub port: u16,
    pub read_only: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ConnectorExperienceModel {
    pub schema_version: u16,
    #[serde(default)]
    pub domains: Vec<ConnectorExperienceDomain>,
    #[serde(default)]
    pub inspired_by: Vec<String>,
    #[serde(default)]
    pub result_views: Vec<ConnectorResultView>,
    #[serde(default)]
    pub object_types: Vec<String>,
    #[serde(default)]
    pub workflows: Vec<ConnectorExperienceWorkflow>,
    #[serde(default)]
    pub query_templates: Vec<ConnectorQueryTemplate>,
    #[serde(default)]
    pub inspector_hints: Vec<ConnectorInspectorHint>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum ConnectorExperienceDomain {
    Graph,
    Vector,
    Search,
    TimeSeries,
    Warehouse,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum ConnectorResultView {
    Graph,
    Path,
    Table,
    Json,
    VectorNeighbors,
    SearchHits,
    Facets,
    TimeChart,
    Heatmap,
    Worksheet,
    QueryHistory,
    QueryProfile,
    WarehouseMonitor,
    CostChart,
    CopyReport,
    TaskGraph,
    Lineage,
    SemanticModel,
    Notebook,
    AiAssistant,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ConnectorExperienceWorkflow {
    pub id: String,
    pub label: String,
    pub description: String,
    pub result_view: ConnectorResultView,
    #[serde(default)]
    pub template_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ConnectorQueryTemplate {
    pub id: String,
    pub label: String,
    pub language: String,
    pub description: String,
    pub insert_text: String,
    #[serde(default)]
    pub parameters: Vec<ConnectorQueryTemplateParameter>,
    pub result_view: ConnectorResultView,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ConnectorQueryTemplateParameter {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub parameter_type: ConnectorQueryTemplateParameterType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub default: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum ConnectorQueryTemplateParameterType {
    String,
    Number,
    Boolean,
    Json,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ConnectorInspectorHint {
    pub id: String,
    pub label: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ConnectorEndpointModel {
    #[serde(default)]
    pub modes: Vec<ConnectorEndpointMode>,
    pub default_port: u16,
    #[serde(default)]
    pub fields: Vec<ConnectorConnectionField>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ConnectorAuthMethod {
    pub id: String,
    pub label: String,
    pub kind: ConnectorAuthKind,
    #[serde(default)]
    pub secret_purposes: Vec<ConnectorSecretPurpose>,
    #[serde(default)]
    pub fields: Vec<ConnectorConnectionField>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ConnectorConnectionField {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub field_type: ConnectorConnectionFieldType,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub profile_field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub option: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub secret_purpose: Option<ConnectorSecretPurpose>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub default: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ConnectorTlsModel {
    pub supported: bool,
    pub required_by_default: bool,
    #[serde(default)]
    pub modes: Vec<ConnectorTlsMode>,
    #[serde(default)]
    pub fields: Vec<ConnectorConnectionField>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum ConnectorConnectionFieldType {
    String,
    Number,
    Boolean,
    Secret,
    Path,
    Json,
    Pem,
    Uri,
    Select,
    StringList,
    Map,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum ConnectorAuthKind {
    None,
    ConnectionString,
    UserPassword,
    Basic,
    Token,
    ApiKey,
    Oauth2,
    ServiceAccount,
    PrivateKey,
    Certificate,
    Kerberos,
    Ldap,
    Saml,
    Iam,
    AzureAd,
    ManagedIdentity,
    BrowserSso,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum ConnectorSecretPurpose {
    Password,
    Token,
    PrivateKey,
    PrivateKeyPassphrase,
    SshPassword,
    ProxyPassword,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum ConnectorTlsMode {
    Disable,
    Prefer,
    Require,
    VerifyCa,
    VerifyFull,
    ClientCertificate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum ConnectorEndpointMode {
    HostPort,
    ConnectionString,
    LocalFile,
    InMemory,
    MotherduckService,
    CloudResource,
    CustomEndpoint,
    Catalog,
    ObjectStorage,
    Jdbc,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum ConnectorTransportMode {
    Direct,
    LocalFile,
    SshTunnel,
    Socks5Proxy,
    HttpConnectProxy,
    ProxyChain,
    CustomEndpoint,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub line_width: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub indent_width: Option<u16>,
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
                    "statusBarItems": [],
                    "themes": [],
                    "sqlDialects": [],
                    "connectors": []
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
    use typeship::ir::{Decl, TsType};
    use typeship::Bridge;
    use typeship_ts_rs::decl;

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
            .decl(&decl::<StatusBarAlignment>())
            .decl(&decl::<StatusBarItemContribution>())
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
            .decl(&decl::<ConnectorContribution>())
            .decl(&decl::<ConnectorFeature>())
            .decl(&decl::<ConnectorConnectionModel>())
            .decl(&decl::<ConnectorConnectionCompatibility>())
            .decl(&decl::<ConnectorConnectionDefaults>())
            .decl(&decl::<ConnectorExperienceModel>())
            .decl(&decl::<ConnectorExperienceDomain>())
            .decl(&decl::<ConnectorResultView>())
            .decl(&decl::<ConnectorExperienceWorkflow>())
            .decl(&decl::<ConnectorQueryTemplate>())
            .decl(&decl::<ConnectorQueryTemplateParameter>())
            .decl(&decl::<ConnectorQueryTemplateParameterType>())
            .decl(&decl::<ConnectorInspectorHint>())
            .decl(&decl::<ConnectorEndpointModel>())
            .decl(&decl::<ConnectorAuthMethod>())
            .decl(&decl::<ConnectorConnectionField>())
            .decl(&decl::<ConnectorTlsModel>())
            .decl(&decl::<ConnectorConnectionFieldType>())
            .decl(&decl::<ConnectorAuthKind>())
            .decl(&decl::<ConnectorSecretPurpose>())
            .decl(&decl::<ConnectorTlsMode>())
            .decl(&decl::<ConnectorEndpointMode>())
            .decl(&decl::<ConnectorTransportMode>())
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
