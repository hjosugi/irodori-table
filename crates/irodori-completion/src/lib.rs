//! Deterministic completion, ranking, snippets, and signature-help primitives.

pub mod completion;
pub mod metadata;

pub use completion::{
    apply_keyword_casing, CompletionEngine, CompletionItem, CompletionItemKind, CompletionRequest,
    GeneratedColumnList, JoinSuggestion, KeywordCase,
};
pub use metadata::{
    ColumnMetadata, ForeignKeyMetadata, IndexMetadata, MetadataCache, MetadataObjectKind,
    MetadataPermissions, MetadataSnapshot, ObjectMetadata, RefreshReason, RefreshRequest,
    RefreshScope, RoutineKind, RoutineMetadata, SchemaMetadata,
};

pub const CRATE_NAME: &str = "irodori-completion";
