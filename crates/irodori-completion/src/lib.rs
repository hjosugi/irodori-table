//! Deterministic completion, ranking, snippets, and signature-help primitives.

pub mod completion;
pub mod metadata;

pub use completion::{
    apply_keyword_casing, CompletionEngine, CompletionItem, CompletionItemKind, CompletionRequest,
    KeywordCase,
};
pub use metadata::{
    ColumnMetadata, IndexMetadata, MetadataCache, MetadataObjectKind, MetadataPermissions,
    MetadataSnapshot, ObjectMetadata, RefreshReason, RefreshRequest, RefreshScope, RoutineMetadata,
    SchemaMetadata,
};

pub const CRATE_NAME: &str = "irodori-completion";
