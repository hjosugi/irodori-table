//! Audit log, redaction, and privacy-mode primitives for Irodori.

use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum PrivacyMode {
    Normal,
    Private,
}

impl Default for PrivacyMode {
    fn default() -> Self {
        Self::Normal
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RedactionReport {
    pub text: String,
    pub redactions: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Redactor {
    privacy_mode: PrivacyMode,
    replacement: String,
    secret_values: Vec<String>,
}

impl Redactor {
    pub fn new(privacy_mode: PrivacyMode) -> Self {
        Self {
            privacy_mode,
            replacement: "[redacted]".to_string(),
            secret_values: Vec::new(),
        }
    }

    pub fn with_replacement(mut self, replacement: impl Into<String>) -> Self {
        self.replacement = replacement.into();
        self
    }

    pub fn with_secret(mut self, secret: impl Into<String>) -> Self {
        let secret = secret.into();
        if !secret.is_empty() {
            self.secret_values.push(secret);
        }
        self
    }

    pub fn privacy_mode(&self) -> PrivacyMode {
        self.privacy_mode
    }

    pub fn redact(&self, text: impl AsRef<str>) -> RedactionReport {
        let mut redactions = 0;
        let mut out = apply_redaction_ranges(
            text.as_ref(),
            url_password_ranges(text.as_ref()),
            &self.replacement,
            &mut redactions,
        );
        out = apply_redaction_ranges(
            &out,
            assignment_value_ranges(&out),
            &self.replacement,
            &mut redactions,
        );
        for secret in &self.secret_values {
            out = replace_all_counted(&out, secret, &self.replacement, &mut redactions);
        }
        if self.privacy_mode == PrivacyMode::Private {
            out = apply_redaction_ranges(
                &out,
                sql_string_literal_ranges(&out),
                &self.replacement,
                &mut redactions,
            );
        }

        RedactionReport {
            text: out,
            redactions,
        }
    }
}

impl Default for Redactor {
    fn default() -> Self {
        Self::new(PrivacyMode::Normal)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum AuditEventKind {
    ConnectionOpen,
    ConnectionClose,
    ConnectionFailed,
    QueryRun,
    QueryFailed,
    QueryCancel,
    SecretRead,
    SecretWrite,
    SecretDelete,
    DiagnosticsRun,
    Export,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AuditEvent {
    pub sequence: u64,
    pub occurred_at_ms: u64,
    pub kind: AuditEventKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub connection_id: Option<String>,
    pub summary: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub fields: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AuditLog {
    events: Vec<AuditEvent>,
    next_sequence: u64,
}

impl AuditLog {
    pub fn record(
        &mut self,
        kind: AuditEventKind,
        connection_id: Option<impl Into<String>>,
        summary: impl Into<String>,
    ) -> &AuditEvent {
        self.record_with_fields(kind, connection_id, summary, BTreeMap::new())
    }

    pub fn record_with_fields(
        &mut self,
        kind: AuditEventKind,
        connection_id: Option<impl Into<String>>,
        summary: impl Into<String>,
        fields: BTreeMap<String, String>,
    ) -> &AuditEvent {
        let event = AuditEvent {
            sequence: self.next_sequence,
            occurred_at_ms: now_millis(),
            kind,
            connection_id: connection_id.map(Into::into),
            summary: summary.into(),
            fields,
        };
        self.next_sequence += 1;
        self.events.push(event);
        self.events.last().expect("event just pushed")
    }

    pub fn events(&self) -> &[AuditEvent] {
        &self.events
    }

    pub fn export_redacted(&self, redactor: &Redactor) -> RedactedExport {
        let mut content = String::new();
        let mut redactions = 0;
        for event in &self.events {
            let summary = redactor.redact(&event.summary);
            redactions += summary.redactions;
            content.push_str(&format!(
                "{}\t{}\t{:?}\t{}\t{}",
                event.sequence,
                event.occurred_at_ms,
                event.kind,
                event.connection_id.as_deref().unwrap_or("-"),
                summary.text
            ));
            for (key, value) in &event.fields {
                let value = redactor.redact(value);
                redactions += value.redactions;
                content.push_str(&format!("\t{key}={}", value.text));
            }
            content.push('\n');
        }

        RedactedExport {
            content,
            redactions,
            event_count: self.events.len() as u64,
            privacy_mode: redactor.privacy_mode(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RedactedExport {
    pub content: String,
    pub redactions: u32,
    pub event_count: u64,
    pub privacy_mode: PrivacyMode,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn apply_redaction_ranges(
    input: &str,
    ranges: Vec<(usize, usize)>,
    replacement: &str,
    redactions: &mut u32,
) -> String {
    if ranges.is_empty() {
        return input.to_string();
    }

    let mut out = String::with_capacity(input.len());
    let mut cursor = 0;
    for (start, end) in merge_ranges(ranges) {
        if start < cursor || start >= end || end > input.len() {
            continue;
        }
        out.push_str(&input[cursor..start]);
        out.push_str(replacement);
        *redactions += 1;
        cursor = end;
    }
    out.push_str(&input[cursor..]);
    out
}

fn merge_ranges(mut ranges: Vec<(usize, usize)>) -> Vec<(usize, usize)> {
    ranges.sort_unstable_by_key(|(start, _)| *start);
    let mut merged: Vec<(usize, usize)> = Vec::with_capacity(ranges.len());
    for (start, end) in ranges {
        if let Some((_, last_end)) = merged.last_mut() {
            if start <= *last_end {
                *last_end = (*last_end).max(end);
                continue;
            }
        }
        merged.push((start, end));
    }
    merged
}

fn replace_all_counted(
    input: &str,
    needle: &str,
    replacement: &str,
    redactions: &mut u32,
) -> String {
    if needle.is_empty() {
        return input.to_string();
    }

    let mut out = String::with_capacity(input.len());
    let mut cursor = 0;
    while let Some(relative) = input[cursor..].find(needle) {
        let start = cursor + relative;
        out.push_str(&input[cursor..start]);
        out.push_str(replacement);
        *redactions += 1;
        cursor = start + needle.len();
    }
    out.push_str(&input[cursor..]);
    out
}

fn url_password_ranges(input: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut cursor = 0;

    while let Some(relative) = input[cursor..].find("://") {
        let scheme_at = cursor + relative;
        let authority_start = scheme_at + 3;
        let authority_end = input[authority_start..]
            .find(['/', '?', '#', ' ', '\t', '\r', '\n'])
            .map(|offset| authority_start + offset)
            .unwrap_or(input.len());
        if let Some(at_offset) = input[authority_start..authority_end].rfind('@') {
            let userinfo_end = authority_start + at_offset;
            if let Some(colon_offset) = input[authority_start..userinfo_end].find(':') {
                let password_start = authority_start + colon_offset + 1;
                if password_start < userinfo_end {
                    ranges.push((password_start, userinfo_end));
                }
            }
        }
        cursor = authority_end.saturating_add(1);
    }

    ranges
}

fn assignment_value_ranges(input: &str) -> Vec<(usize, usize)> {
    let lower = input.to_ascii_lowercase();
    let keys = [
        "password=",
        "pwd=",
        "token=",
        "secret=",
        "passphrase=",
        "private_key=",
        "privatekey=",
    ];
    let mut ranges = Vec::new();
    let mut cursor = 0;

    while cursor < input.len() {
        let next = keys
            .iter()
            .filter_map(|key| {
                lower[cursor..]
                    .find(key)
                    .map(|offset| (cursor + offset, key.len()))
            })
            .min_by_key(|(start, _)| *start);
        let Some((key_start, key_len)) = next else {
            break;
        };
        let value_start = key_start + key_len;
        let value_end = input[value_start..]
            .find([';', '&', ' ', '\t', '\r', '\n'])
            .map(|offset| value_start + offset)
            .unwrap_or(input.len());
        if value_start < value_end {
            ranges.push((value_start, value_end));
        }
        cursor = value_end.saturating_add(1);
    }

    ranges
}

fn sql_string_literal_ranges(input: &str) -> Vec<(usize, usize)> {
    let bytes = input.as_bytes();
    let mut ranges = Vec::new();
    let mut cursor = 0;

    while cursor < bytes.len() {
        if bytes[cursor] != b'\'' {
            cursor += 1;
            continue;
        }
        let content_start = cursor + 1;
        cursor += 1;
        while cursor < bytes.len() {
            if bytes[cursor] == b'\'' {
                if bytes.get(cursor + 1) == Some(&b'\'') {
                    cursor += 2;
                    continue;
                }
                if content_start < cursor {
                    ranges.push((content_start, cursor));
                }
                cursor += 1;
                break;
            }
            cursor += 1;
        }
    }

    ranges
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redactor_removes_url_passwords_assignments_and_known_secrets() {
        let redactor = Redactor::default().with_secret("literal-secret");
        let report = redactor.redact(
            "postgres://user:s3cr3t@localhost/db Password=abc; PWD=def; token=ghi literal-secret",
        );

        assert!(!report.text.contains("s3cr3t"));
        assert!(!report.text.contains("abc"));
        assert!(!report.text.contains("def"));
        assert!(!report.text.contains("ghi"));
        assert!(!report.text.contains("literal-secret"));
        assert!(report.redactions >= 5, "{report:?}");
    }

    #[test]
    fn private_mode_redacts_sql_literals_for_exports() {
        let report = Redactor::new(PrivacyMode::Private)
            .redact("select * from users where email = 'person@example.com' and note = 'x''y'");

        assert!(!report.text.contains("person@example.com"));
        assert!(!report.text.contains("x''y"));
        assert!(report.text.contains("'[redacted]'"));
    }

    #[test]
    fn audit_export_is_redaction_safe() {
        let mut audit = AuditLog::default();
        audit.record_with_fields(
            AuditEventKind::QueryRun,
            Some("prod"),
            "select * from users where email = 'person@example.com'",
            BTreeMap::from([(
                "dsn".to_string(),
                "postgres://user:secret@db.internal/app".to_string(),
            )]),
        );

        let export = audit.export_redacted(&Redactor::new(PrivacyMode::Private));
        assert_eq!(export.event_count, 1);
        assert_eq!(export.privacy_mode, PrivacyMode::Private);
        assert!(!export.content.contains("person@example.com"));
        assert!(!export.content.contains("secret"));
        assert!(export.redactions >= 2);
    }
}
