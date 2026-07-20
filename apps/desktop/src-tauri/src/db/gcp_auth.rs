//! Shared GCP service-account OAuth2 token signing for the Google connectors.
//!
//! BigQuery and Bigtable authenticate identically — build an RS256-signed JWT
//! assertion from the service-account key and exchange it at the Google OAuth
//! token endpoint — differing only in the requested scope. Keeping the flow
//! here means any auth fix (clock skew, error mapping, key-format support)
//! lands once for every GCP driver instead of silently diverging (#171).

use std::time::SystemTime;

use openssl::hash::MessageDigest;
use openssl::pkey::PKey;
use openssl::sign::Signer;
use reqwest::Client;
use serde_json::Value;

use super::{DbError, DbResult};

/// Exchange a service-account key for a bearer access token limited to `scope`
/// (e.g. `https://www.googleapis.com/auth/bigquery`).
pub(super) async fn fetch_oauth2_token(
    client: &Client,
    email: &str,
    private_key: &str,
    scope: &str,
) -> DbResult<String> {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let exp = now + 3600;

    let header = r#"{"alg":"RS256","typ":"JWT"}"#;
    let claims = format!(
        r#"{{"iss":"{email}","scope":"{scope}","aud":"https://oauth2.googleapis.com/token","exp":{exp},"iat":{now}}}"#
    );

    let header_b64 = base64_url_encode(header.as_bytes());
    let claims_b64 = base64_url_encode(claims.as_bytes());
    let payload = format!("{header_b64}.{claims_b64}");

    let pkey = PKey::private_key_from_pem(private_key.as_bytes()).map_err(|e| {
        DbError::connection(format!(
            "Invalid private key in Google Service Account: {e}"
        ))
    })?;

    let mut signer = Signer::new(MessageDigest::sha256(), &pkey)
        .map_err(|e| DbError::connection(format!("Failed to initialize signer: {e}")))?;
    signer
        .update(payload.as_bytes())
        .map_err(|e| DbError::connection(format!("Signer failed payload update: {e}")))?;
    let signature = signer
        .sign_to_vec()
        .map_err(|e| DbError::connection(format!("Failed to sign JWT assertion: {e}")))?;
    let signature_b64 = base64_url_encode(&signature);

    let assertion = format!("{payload}.{signature_b64}");

    let body = format!(
        "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion={}",
        assertion
    );

    let res = client
        .post("https://oauth2.googleapis.com/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| DbError::connection(format!("GCP token request failed: {e}")))?;

    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_default();
        return Err(DbError::connection(format!(
            "GCP OAuth token request failed with HTTP {status}: {err_text}"
        )));
    }

    let val: Value = res.json().await.unwrap_or(Value::Null);
    let access_token = val
        .get("access_token")
        .and_then(|t| t.as_str())
        .ok_or_else(|| DbError::connection("GCP OAuth token response missing access_token"))?
        .to_string();

    Ok(access_token)
}

/// Unpadded base64url (RFC 4648 §5), as required for JWT segments.
fn base64_url_encode(input: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    let mut i = 0;
    while i < input.len() {
        let b0 = input[i] as usize;
        let b1 = if i + 1 < input.len() {
            input[i + 1] as usize
        } else {
            0
        };
        let b2 = if i + 2 < input.len() {
            input[i + 2] as usize
        } else {
            0
        };

        let enc0 = b0 >> 2;
        let enc1 = ((b0 & 3) << 4) | (b1 >> 4);
        let enc2 = ((b1 & 15) << 2) | (b2 >> 6);
        let enc3 = b2 & 63;

        out.push(CHARS[enc0] as char);
        out.push(CHARS[enc1] as char);
        if i + 1 < input.len() {
            out.push(CHARS[enc2] as char);
        }
        if i + 2 < input.len() {
            out.push(CHARS[enc3] as char);
        }
        i += 3;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::base64_url_encode;

    #[test]
    fn base64_url_encoding_is_unpadded_and_url_safe() {
        // RFC 4648 test vectors, minus the padding JWTs must not carry.
        assert_eq!(base64_url_encode(b""), "");
        assert_eq!(base64_url_encode(b"f"), "Zg");
        assert_eq!(base64_url_encode(b"fo"), "Zm8");
        assert_eq!(base64_url_encode(b"foo"), "Zm9v");
        assert_eq!(base64_url_encode(b"foobar"), "Zm9vYmFy");
        // 0xfb 0xff maps onto the url-safe alphabet (`-`/`_`, not `+`/`/`).
        assert_eq!(base64_url_encode(&[0xfb, 0xff]), "-_8");
    }
}
