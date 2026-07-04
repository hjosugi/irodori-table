use irodori_core::{IrodoriError, IrodoriErrorKind};

pub type DbResult<T> = std::result::Result<T, DbError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DbError {
    kind: IrodoriErrorKind,
    message: String,
    code: Option<String>,
    retryable: bool,
}

impl DbError {
    pub(crate) fn new(kind: IrodoriErrorKind, message: impl Into<String>) -> Self {
        let retryable = matches!(
            kind,
            IrodoriErrorKind::Connection | IrodoriErrorKind::Timeout | IrodoriErrorKind::Transport
        );
        Self {
            kind,
            message: message.into(),
            code: None,
            retryable,
        }
    }

    pub(crate) fn validation(message: impl Into<String>) -> Self {
        Self::new(IrodoriErrorKind::Validation, message)
    }

    pub(crate) fn unsupported(message: impl Into<String>) -> Self {
        Self::new(IrodoriErrorKind::Unsupported, message)
    }

    pub(crate) fn not_found(message: impl Into<String>) -> Self {
        Self::new(IrodoriErrorKind::NotFound, message)
    }

    pub(crate) fn connection(message: impl Into<String>) -> Self {
        Self::new(IrodoriErrorKind::Connection, message)
    }

    pub(crate) fn query(message: impl Into<String>) -> Self {
        Self::new(IrodoriErrorKind::Query, message)
    }

    pub(crate) fn metadata(message: impl Into<String>) -> Self {
        Self::new(IrodoriErrorKind::Metadata, message)
    }

    pub(crate) fn edit(message: impl Into<String>) -> Self {
        Self::new(IrodoriErrorKind::Edit, message)
    }

    pub(crate) fn timeout(message: impl Into<String>) -> Self {
        Self::new(IrodoriErrorKind::Timeout, message)
    }

    pub(crate) fn cancelled(message: impl Into<String>) -> Self {
        Self::new(IrodoriErrorKind::Cancelled, message)
    }

    pub(crate) fn transport(message: impl Into<String>) -> Self {
        Self::new(IrodoriErrorKind::Transport, message)
    }

    pub(crate) fn internal(message: impl Into<String>) -> Self {
        Self::new(IrodoriErrorKind::Internal, message)
    }

    pub(crate) fn with_message(mut self, message: impl Into<String>) -> Self {
        self.message = message.into();
        self
    }

    pub(crate) fn message(&self) -> &str {
        &self.message
    }

    #[cfg(test)]
    pub(crate) fn contains(&self, needle: &str) -> bool {
        self.message.contains(needle)
    }
}

impl std::fmt::Display for DbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for DbError {}

impl From<DbError> for IrodoriError {
    fn from(value: DbError) -> Self {
        let mut error = IrodoriError::new(value.kind, value.message).retryable(value.retryable);
        if let Some(code) = value.code {
            error = error.with_code(code);
        }
        error
    }
}

impl From<IrodoriError> for DbError {
    fn from(value: IrodoriError) -> Self {
        Self {
            kind: value.kind,
            message: value.message,
            code: value.code,
            retryable: value.retryable,
        }
    }
}
