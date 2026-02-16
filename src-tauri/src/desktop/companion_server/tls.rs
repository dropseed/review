//! TLS certificate generation and management for the companion server.

use log::info;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// Holds paths to the generated certificate and its fingerprint.
pub struct TlsCertificate {
    pub cert_path: PathBuf,
    pub key_path: PathBuf,
    pub fingerprint: String,
}

/// Load an existing certificate or generate a new self-signed one.
///
/// Certificates are stored in `{app_data_dir}/tls/cert.pem` and `key.pem`.
pub fn ensure_certificate(app_data_dir: &Path) -> Result<TlsCertificate, String> {
    let tls_dir = app_data_dir.join("tls");
    let cert_path = tls_dir.join("cert.pem");
    let key_path = tls_dir.join("key.pem");

    if cert_path.exists() && key_path.exists() {
        // Load existing certificate to compute fingerprint
        let cert_pem = std::fs::read_to_string(&cert_path)
            .map_err(|e| format!("Failed to read cert.pem: {e}"))?;
        let fingerprint = fingerprint_from_pem(&cert_pem)?;
        return Ok(TlsCertificate {
            cert_path,
            key_path,
            fingerprint,
        });
    }

    // Generate a new self-signed certificate
    std::fs::create_dir_all(&tls_dir)
        .map_err(|e| format!("Failed to create tls directory: {e}"))?;

    let subject_alt_names = vec!["localhost".to_owned(), "0.0.0.0".to_owned()];
    let certified_key = rcgen::generate_simple_self_signed(subject_alt_names)
        .map_err(|e| format!("Failed to generate certificate: {e}"))?;

    let cert_pem = certified_key.cert.pem();
    let key_pem = certified_key.key_pair.serialize_pem();

    std::fs::write(&cert_path, &cert_pem).map_err(|e| format!("Failed to write cert.pem: {e}"))?;
    std::fs::write(&key_path, &key_pem).map_err(|e| format!("Failed to write key.pem: {e}"))?;

    let fingerprint = fingerprint_from_pem(&cert_pem)?;

    info!("Generated new self-signed certificate");
    info!("Fingerprint: {fingerprint}");

    Ok(TlsCertificate {
        cert_path,
        key_path,
        fingerprint,
    })
}

/// Delete existing certificate files so a fresh one is generated on next start.
pub fn delete_certificate(app_data_dir: &Path) {
    let tls_dir = app_data_dir.join("tls");
    let _ = std::fs::remove_file(tls_dir.join("cert.pem"));
    let _ = std::fs::remove_file(tls_dir.join("key.pem"));
}

/// Compute the SHA-256 fingerprint of the DER-encoded certificate from PEM.
fn fingerprint_from_pem(pem_str: &str) -> Result<String, String> {
    let der_bytes = pem_to_der(pem_str)?;
    Ok(compute_fingerprint(&der_bytes))
}

/// Extract DER bytes from a PEM-encoded certificate string.
fn pem_to_der(pem_str: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;

    let b64: String = pem_str
        .lines()
        .filter(|line| !line.starts_with("-----"))
        .collect();

    base64::engine::general_purpose::STANDARD
        .decode(&b64)
        .map_err(|e| format!("Failed to decode PEM base64: {e}"))
}

/// SHA-256 fingerprint of DER bytes, formatted with colon separators.
pub fn compute_fingerprint(der_bytes: &[u8]) -> String {
    let hash = Sha256::digest(der_bytes);
    hash.iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}
