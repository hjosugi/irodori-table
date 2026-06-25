//! Token-scoped access. Bearer tokens map to a set of scopes; comparison is
//! constant-time. When no tokens are configured the server runs in "open" mode
//! (intended for localhost/dev) where every request is granted the `read` scope
//! only - writes still require an explicit token with the `write` scope.

use std::collections::BTreeSet;

use subtle::ConstantTimeEq;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Scope {
    Read,
    Write,
}

impl Scope {
    pub fn parse(value: &str) -> Option<Scope> {
        match value.trim().to_ascii_lowercase().as_str() {
            "read" => Some(Scope::Read),
            "write" => Some(Scope::Write),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Token {
    pub id: String,
    secret: String,
    scopes: BTreeSet<Scope>,
}

impl Token {
    pub fn new(
        id: impl Into<String>,
        secret: impl Into<String>,
        scopes: impl IntoIterator<Item = Scope>,
    ) -> Token {
        Token {
            id: id.into(),
            secret: secret.into(),
            scopes: scopes.into_iter().collect(),
        }
    }

    pub fn has_scope(&self, scope: Scope) -> bool {
        self.scopes.contains(&scope)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthError {
    /// No or malformed `Authorization` header where one is required.
    Missing,
    /// A bearer token was supplied but did not match any configured token.
    Invalid,
}

/// The authenticated identity for a request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    pub token_id: String,
    scopes: BTreeSet<Scope>,
}

impl Identity {
    pub fn open() -> Identity {
        Identity {
            token_id: "anonymous".into(),
            scopes: BTreeSet::from([Scope::Read]),
        }
    }

    pub fn has_scope(&self, scope: Scope) -> bool {
        self.scopes.contains(&scope)
    }
}

#[derive(Debug, Clone, Default)]
pub struct Authenticator {
    tokens: Vec<Token>,
}

impl Authenticator {
    pub fn new(tokens: Vec<Token>) -> Authenticator {
        Authenticator { tokens }
    }

    pub fn is_open(&self) -> bool {
        self.tokens.is_empty()
    }

    /// Resolve the identity for an optional `Authorization` header value.
    pub fn authenticate(&self, authorization: Option<&str>) -> Result<Identity, AuthError> {
        if self.is_open() {
            // Open mode: read-only access for anyone, regardless of header.
            return Ok(Identity::open());
        }
        let header = authorization.ok_or(AuthError::Missing)?;
        let presented = header
            .strip_prefix("Bearer ")
            .ok_or(AuthError::Missing)?
            .trim();
        if presented.is_empty() {
            return Err(AuthError::Missing);
        }
        for token in &self.tokens {
            if constant_time_eq(presented.as_bytes(), token.secret.as_bytes()) {
                return Ok(Identity {
                    token_id: token.id.clone(),
                    scopes: token.scopes.clone(),
                });
            }
        }
        Err(AuthError::Invalid)
    }
}

/// Length-independent constant-time comparison: hashing-free, leaks only whether
/// the lengths differ (which a token's length already implies).
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.ct_eq(b).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_mode_grants_read_only() {
        let auth = Authenticator::default();
        let id = auth.authenticate(None).expect("open read");
        assert!(id.has_scope(Scope::Read));
        assert!(!id.has_scope(Scope::Write));
    }

    #[test]
    fn valid_token_resolves_scopes() {
        let auth = Authenticator::new(vec![Token::new(
            "ci",
            "s3cret",
            [Scope::Read, Scope::Write],
        )]);
        let id = auth.authenticate(Some("Bearer s3cret")).expect("ok");
        assert_eq!(id.token_id, "ci");
        assert!(id.has_scope(Scope::Write));
    }

    #[test]
    fn missing_and_invalid_tokens_are_rejected() {
        let auth = Authenticator::new(vec![Token::new("ci", "s3cret", [Scope::Read])]);
        assert_eq!(auth.authenticate(None), Err(AuthError::Missing));
        assert_eq!(
            auth.authenticate(Some("Token s3cret")),
            Err(AuthError::Missing)
        );
        assert_eq!(
            auth.authenticate(Some("Bearer nope")),
            Err(AuthError::Invalid)
        );
    }

    #[test]
    fn scope_parsing() {
        assert_eq!(Scope::parse("read"), Some(Scope::Read));
        assert_eq!(Scope::parse("WRITE"), Some(Scope::Write));
        assert_eq!(Scope::parse("admin"), None);
    }
}
