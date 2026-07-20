//! Forward migration of persisted review JSON.
//!
//! [`ReviewState`] carries a `schemaVersion` (see [`REVIEW_SCHEMA_VERSION`]). On
//! read we parse to a [`serde_json::Value`], run it through the ordered steps
//! below to bring it up to the current schema, and only then deserialize into
//! the typed struct. This is what makes a breaking shape change safe: it becomes
//! a migration step instead of a parse failure that silently drops the review —
//! the failure mode that motivated this module.
//!
//! Rules:
//! - A file already at the current version passes through untouched.
//! - An older file is migrated step by step, each step bumping `schemaVersion`.
//! - A file *newer* than this binary understands is rejected loudly
//!   ([`MigrateError::TooNew`]) — never silently dropped or truncated.
//!
//! [`ReviewState`]: super::state::ReviewState

use super::state::REVIEW_SCHEMA_VERSION;
use serde_json::Value;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum MigrateError {
    #[error("review was written by a newer version of Review (schema v{found}, this build supports v{supported}); upgrade Review to open it")]
    TooNew { found: u64, supported: u32 },
    #[error("review document is not a JSON object")]
    NotAnObject,
    #[error("review uses an obsolete pre-ref schema (v{found}) that is no longer supported")]
    Obsolete { found: u64 },
}

/// A single forward step: transform a `Value` at version N into the shape for
/// version N + 1. Steps operate on raw JSON and must not assume the document
/// already deserializes into the current struct.
type Step = fn(&mut Value) -> Result<(), MigrateError>;

/// Ordered migration steps. `STEPS[v]` migrates a document from schema `v` to
/// `v + 1`, so the slice length equals [`REVIEW_SCHEMA_VERSION`].
///
/// `0 -> 1`: adopt schema versioning. Pre-versioning files are already in the
/// v1 shape (older on-disk formats were never carried forward), so this only
/// stamps the version field — done centrally in [`migrate`].
///
/// `1 -> 2`: switch review identity from a `{base}..{head}` comparison to a
/// single `ref` + optional `baseOverride`. There is deliberately no forward
/// migration — the old key doesn't map cleanly onto a ref — so this step errors,
/// which callers treat as "skip this file silently."
const STEPS: &[Step] = &[step_0_to_1, step_1_to_2];

// Slice indexing in `migrate` relies on this; a compile-time assert turns a
// schema bump without a matching step into a build error rather than a release
// panic (a `debug_assert` would be compiled out of shipped binaries).
const _: () = assert!(STEPS.len() == REVIEW_SCHEMA_VERSION as usize);

fn step_0_to_1(_value: &mut Value) -> Result<(), MigrateError> {
    Ok(())
}

fn step_1_to_2(_value: &mut Value) -> Result<(), MigrateError> {
    Err(MigrateError::Obsolete { found: 1 })
}

/// Read `schemaVersion`, defaulting to 0 when absent (a file written before
/// versioning existed). Returned as u64 so an out-of-range value is rejected by
/// the `TooNew` check rather than silently truncated into the supported range.
fn read_version(value: &Value) -> u64 {
    value
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

/// Migrate a raw review document up to [`REVIEW_SCHEMA_VERSION`], returning it
/// with `schemaVersion` stamped to the current version and ready to deserialize
/// into a `ReviewState`.
pub fn migrate(mut value: Value) -> Result<Value, MigrateError> {
    if !value.is_object() {
        return Err(MigrateError::NotAnObject);
    }

    let found = read_version(&value);
    if found > REVIEW_SCHEMA_VERSION as u64 {
        return Err(MigrateError::TooNew {
            found,
            supported: REVIEW_SCHEMA_VERSION,
        });
    }

    // `found <= REVIEW_SCHEMA_VERSION` here, so the cast and slice are in range.
    for step in &STEPS[found as usize..REVIEW_SCHEMA_VERSION as usize] {
        step(&mut value)?;
    }

    if let Value::Object(map) = &mut value {
        map.insert("schemaVersion".into(), Value::from(REVIEW_SCHEMA_VERSION));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn steps_cover_every_version() {
        assert_eq!(STEPS.len(), REVIEW_SCHEMA_VERSION as usize);
    }

    #[test]
    fn current_version_passes_through() {
        let doc = json!({ "schemaVersion": REVIEW_SCHEMA_VERSION, "hunks": {} });
        let out = migrate(doc.clone()).unwrap();
        assert_eq!(read_version(&out), REVIEW_SCHEMA_VERSION as u64);
        assert!(out.get("hunks").is_some());
    }

    #[test]
    fn obsolete_pre_ref_schema_is_rejected() {
        // A versionless (v0) or v1 document is a pre-ref `{base}..{head}` review;
        // the 1->2 step errors so callers skip it silently rather than crash.
        let versionless = json!({ "hunks": {} });
        assert!(matches!(
            migrate(versionless).unwrap_err(),
            MigrateError::Obsolete { .. }
        ));

        let v1 = json!({ "schemaVersion": 1, "hunks": {} });
        assert!(matches!(
            migrate(v1).unwrap_err(),
            MigrateError::Obsolete { .. }
        ));
    }

    #[test]
    fn newer_schema_is_rejected_loudly() {
        let doc = json!({ "schemaVersion": REVIEW_SCHEMA_VERSION + 5, "hunks": {} });
        let err = migrate(doc).unwrap_err();
        assert!(matches!(err, MigrateError::TooNew { .. }));
    }

    #[test]
    fn out_of_u32_range_version_is_rejected_not_truncated() {
        // 2^32 must not wrap to 0 (a versionless doc) and pass through.
        let doc = json!({ "schemaVersion": 4_294_967_296_u64, "hunks": {} });
        let err = migrate(doc).unwrap_err();
        assert!(matches!(err, MigrateError::TooNew { found, .. } if found == 4_294_967_296));
    }

    #[test]
    fn non_object_is_rejected() {
        let err = migrate(json!([1, 2, 3])).unwrap_err();
        assert!(matches!(err, MigrateError::NotAnObject));
    }
}
