use std::backtrace::Backtrace;
use std::fs;
use std::io;
use std::panic::{self, PanicHookInfo};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

const PENDING_CRASH_JSON: &str = "irodori-last-panic.json";
const PENDING_CRASH_TEXT: &str = "irodori-last-panic.txt";
const LATEST_BUNDLE_DIR: &str = "irodori-crash-report-latest";
const LATEST_MANIFEST: &str = "irodori-crash-report-latest.json";

static PANIC_LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
static PANIC_HOOK_INSTALLED: OnceLock<()> = OnceLock::new();

#[derive(Debug, Clone)]
pub struct CrashReportState {
    pub log_dir: PathBuf,
    pub latest_bundle_dir: Option<PathBuf>,
    pub latest_manifest_path: Option<PathBuf>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PanicRecord {
    schema_version: u8,
    captured_at_unix: String,
    process_id: u32,
    thread: String,
    payload: String,
    location: Option<PanicLocation>,
    backtrace: String,
    telemetry: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PanicLocation {
    file: String,
    line: u32,
    column: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CrashReportManifest {
    schema_version: u8,
    created_at_unix: String,
    telemetry: &'static str,
    bundle_dir: String,
    files: Vec<String>,
    note: &'static str,
}

pub fn initialize<R: Runtime>(app: &AppHandle<R>) -> CrashReportState {
    let log_dir = app
        .path()
        .app_log_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("dev.irodori.table").join("logs"));
    let _ = fs::create_dir_all(&log_dir);

    let latest_bundle_dir = stage_pending_crash_bundle(&log_dir).ok().flatten();
    let latest_manifest_path = latest_bundle_dir
        .as_ref()
        .map(|_| log_dir.join(LATEST_MANIFEST));

    install_panic_hook(log_dir.clone());

    CrashReportState {
        log_dir,
        latest_bundle_dir,
        latest_manifest_path,
    }
}

fn install_panic_hook(log_dir: PathBuf) {
    let _ = PANIC_LOG_DIR.set(log_dir);
    PANIC_HOOK_INSTALLED.get_or_init(|| {
        let default_hook = panic::take_hook();
        panic::set_hook(Box::new(move |info| {
            if let Some(log_dir) = PANIC_LOG_DIR.get() {
                let _ = write_panic_record(log_dir, info);
            }
            default_hook(info);
        }));
    });
}

fn write_panic_record(log_dir: &Path, info: &PanicHookInfo<'_>) -> io::Result<()> {
    fs::create_dir_all(log_dir)?;
    let record = panic_record(info);
    let json = serde_json::to_string_pretty(&record)
        .map_err(|error| io::Error::new(io::ErrorKind::Other, error))?;
    fs::write(log_dir.join(PENDING_CRASH_JSON), json)?;
    fs::write(log_dir.join(PENDING_CRASH_TEXT), panic_text_report(&record))?;
    Ok(())
}

fn panic_record(info: &PanicHookInfo<'_>) -> PanicRecord {
    let thread = std::thread::current();
    PanicRecord {
        schema_version: 1,
        captured_at_unix: unix_timestamp(SystemTime::now()),
        process_id: std::process::id(),
        thread: thread.name().unwrap_or("unnamed").to_string(),
        payload: panic_payload(info),
        location: info.location().map(|location| PanicLocation {
            file: location.file().to_string(),
            line: location.line(),
            column: location.column(),
        }),
        backtrace: Backtrace::force_capture().to_string(),
        telemetry: "disabled",
    }
}

fn panic_payload(info: &PanicHookInfo<'_>) -> String {
    if let Some(payload) = info.payload().downcast_ref::<&str>() {
        return (*payload).to_string();
    }
    if let Some(payload) = info.payload().downcast_ref::<String>() {
        return payload.clone();
    }
    "<non-string panic payload>".to_string()
}

fn panic_text_report(record: &PanicRecord) -> String {
    let location = record
        .location
        .as_ref()
        .map(|location| format!("{}:{}:{}", location.file, location.line, location.column))
        .unwrap_or_else(|| "unknown".to_string());
    format!(
        "Irodori Table crash report\n\
         schemaVersion: {}\n\
         capturedAtUnix: {}\n\
         processId: {}\n\
         thread: {}\n\
         location: {}\n\
         telemetry: {}\n\
         payload: {}\n\n\
         Backtrace:\n{}\n",
        record.schema_version,
        record.captured_at_unix,
        record.process_id,
        record.thread,
        location,
        record.telemetry,
        record.payload,
        record.backtrace,
    )
}

fn stage_pending_crash_bundle(log_dir: &Path) -> io::Result<Option<PathBuf>> {
    let pending_json = log_dir.join(PENDING_CRASH_JSON);
    if !pending_json.is_file() {
        return Ok(None);
    }

    let bundle_dir = log_dir.join(LATEST_BUNDLE_DIR);
    if bundle_dir.exists() {
        fs::remove_dir_all(&bundle_dir)?;
    }
    fs::create_dir_all(&bundle_dir)?;

    let mut files = Vec::new();
    move_into_bundle(&pending_json, &bundle_dir.join("panic.json"))?;
    files.push("panic.json".to_string());

    let pending_text = log_dir.join(PENDING_CRASH_TEXT);
    if pending_text.is_file() {
        move_into_bundle(&pending_text, &bundle_dir.join("panic.txt"))?;
        files.push("panic.txt".to_string());
    }

    let readme = "This is a local crash report bundle. Review and redact it before sharing. \
                  Irodori Table does not upload crash reports or telemetry automatically.\n";
    fs::write(bundle_dir.join("README.txt"), readme)?;
    files.push("README.txt".to_string());

    let manifest = CrashReportManifest {
        schema_version: 1,
        created_at_unix: unix_timestamp(SystemTime::now()),
        telemetry: "disabled",
        bundle_dir: bundle_dir.display().to_string(),
        files,
        note: "Generated on restart from the previous local panic record.",
    };
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|error| io::Error::new(io::ErrorKind::Other, error))?;
    fs::write(bundle_dir.join("manifest.json"), &manifest_json)?;
    fs::write(log_dir.join(LATEST_MANIFEST), manifest_json)?;

    Ok(Some(bundle_dir))
}

fn move_into_bundle(from: &Path, to: &Path) -> io::Result<()> {
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(from, to)?;
            fs::remove_file(from)
        }
    }
}

fn unix_timestamp(time: SystemTime) -> String {
    match time.duration_since(UNIX_EPOCH) {
        Ok(duration) => format!("{}.{:09}", duration.as_secs(), duration.subsec_nanos()),
        Err(error) => {
            let duration = error.duration();
            format!("-{}.{:09}", duration.as_secs(), duration.subsec_nanos())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(name: &str) -> Self {
            let suffix = unix_timestamp(SystemTime::now()).replace('.', "-");
            let path = std::env::temp_dir().join(format!(
                "irodori-crash-report-test-{name}-{}-{suffix}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create temp crash report dir");
            Self { path }
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn stages_pending_panic_as_restart_bundle() {
        let temp = TempDir::new("stage");
        fs::write(temp.path.join(PENDING_CRASH_JSON), r#"{"payload":"boom"}"#)
            .expect("write pending json");
        fs::write(temp.path.join(PENDING_CRASH_TEXT), "boom").expect("write pending text");

        let bundle = stage_pending_crash_bundle(&temp.path)
            .expect("stage bundle")
            .expect("bundle should be created");

        assert!(bundle.join("panic.json").is_file());
        assert!(bundle.join("panic.txt").is_file());
        assert!(bundle.join("README.txt").is_file());
        assert!(bundle.join("manifest.json").is_file());
        assert!(temp.path.join(LATEST_MANIFEST).is_file());
        assert!(!temp.path.join(PENDING_CRASH_JSON).exists());
        assert!(!temp.path.join(PENDING_CRASH_TEXT).exists());
    }

    #[test]
    fn returns_none_without_pending_panic() {
        let temp = TempDir::new("empty");
        let bundle = stage_pending_crash_bundle(&temp.path).expect("stage bundle");
        assert!(bundle.is_none());
    }
}
