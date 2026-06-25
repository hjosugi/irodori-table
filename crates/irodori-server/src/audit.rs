//! Audit logging, on by default. Every request produces one structured entry,
//! whether it succeeded or was rejected, so the local API leaves a reviewable
//! trail. Sinks are pluggable; the default writes JSON lines to stderr.

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub at_unix_ms: u128,
    pub token_id: String,
    pub method: String,
    pub path: String,
    pub source: Option<String>,
    pub action: &'static str,
    pub status: u16,
    pub row_count: Option<u64>,
    pub detail: Option<String>,
}

impl AuditEntry {
    pub fn new(token_id: impl Into<String>, method: impl Into<String>, path: impl Into<String>) -> AuditEntry {
        AuditEntry {
            at_unix_ms: now_unix_ms(),
            token_id: token_id.into(),
            method: method.into(),
            path: path.into(),
            source: None,
            action: "request",
            status: 0,
            row_count: None,
            detail: None,
        }
    }
}

/// Where audit entries go. Implementations must be cheap and non-blocking enough
/// to call on every request.
pub trait AuditSink: Send + Sync {
    fn record(&self, entry: &AuditEntry);
}

/// Default sink: one JSON object per line on stderr.
#[derive(Debug, Default)]
pub struct StderrAuditSink;

impl AuditSink for StderrAuditSink {
    fn record(&self, entry: &AuditEntry) {
        match serde_json::to_string(entry) {
            Ok(line) => eprintln!("{line}"),
            Err(error) => eprintln!("audit: failed to serialize entry: {error}"),
        }
    }
}

/// Test/inspection sink that retains entries in memory.
#[derive(Debug, Default)]
pub struct MemoryAuditSink {
    entries: Mutex<Vec<AuditEntry>>,
}

impl MemoryAuditSink {
    pub fn entries(&self) -> Vec<AuditEntry> {
        self.entries.lock().expect("audit lock").clone()
    }
}

impl AuditSink for MemoryAuditSink {
    fn record(&self, entry: &AuditEntry) {
        self.entries.lock().expect("audit lock").push(entry.clone());
    }
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_sink_collects_entries() {
        let sink = MemoryAuditSink::default();
        let mut entry = AuditEntry::new("ci", "GET", "/health");
        entry.status = 200;
        sink.record(&entry);
        let entries = sink.entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].status, 200);
        assert_eq!(entries[0].token_id, "ci");
    }
}
