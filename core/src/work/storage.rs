//! Persistence for the work queue (`~/.review/work.json`).
//!
//! The queue is **global**, not per-repo: a work item can bind refs from any
//! number of repositories, so it can't live under `repos/<repo-id>/`. It sits
//! next to `index.json` at the central root instead.
//!
//! Concurrency mirrors review state: reads are plain, writes carry an expected
//! on-disk version and fail loudly on a mismatch, and [`super::mutate`] retries
//! the read-modify-write. The file is written atomically (temp + rename) like
//! the repo index, so a reader (or the file watcher) never sees a half-written
//! queue.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use super::{WorkError, WorkState, WORK_SCHEMA_VERSION};
use crate::review::central;

/// Path to the global work queue file.
pub fn work_path() -> Result<PathBuf, WorkError> {
    Ok(central::get_central_root()?.join("work.json"))
}

/// The two fields that decide whether the rest of the document can be read at
/// all, parsed on their own so an older queue can be recognized rather than
/// deserialized.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Envelope {
    #[serde(default)]
    schema_version: u32,
    #[serde(default)]
    version: u64,
}

/// Load the work queue. A missing file is an empty queue at version 0 — the
/// same "nothing recorded yet" shape a first write expects.
///
/// An **older** document is dropped, not migrated: workspaces are cheap to
/// remake and the model they were written against no longer exists. It comes
/// back as an empty queue *at the file's own version*, so the first write after
/// it satisfies [`save`]'s version check instead of conflicting with a document
/// nothing will read again.
///
/// A document from a **newer** build is rejected loudly rather than emptied:
/// downgrading is a temporary state, and blowing away the newer build's queue
/// on the way through is not a thing to do quietly.
pub fn load() -> Result<WorkState, WorkError> {
    let path = work_path()?;
    if !path.exists() {
        return Ok(WorkState::default());
    }
    let raw = fs::read_to_string(&path)?;
    let envelope: Envelope = serde_json::from_str(&raw)?;
    if envelope.schema_version > WORK_SCHEMA_VERSION {
        return Err(WorkError::SchemaTooNew {
            found: envelope.schema_version,
            supported: WORK_SCHEMA_VERSION,
        });
    }
    if envelope.schema_version < WORK_SCHEMA_VERSION {
        log::info!(
            "[work] work.json is schema v{} and this build reads v{WORK_SCHEMA_VERSION}; starting from an empty queue",
            envelope.schema_version
        );
        return Ok(WorkState {
            version: envelope.version,
            ..WorkState::default()
        });
    }
    Ok(serde_json::from_str(&raw)?)
}

/// Save the work queue with optimistic concurrency control.
///
/// `state.version` is the version being written, so the expected on-disk
/// version is `state.version - 1`; anything else means another process wrote in
/// between and the caller has to redo its mutation on the newer state. Version
/// 0 is a fresh write with no file to conflict with.
pub fn save(state: &WorkState) -> Result<(), WorkError> {
    let path = work_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    if path.exists() && state.version > 0 {
        let existing: WorkState = serde_json::from_str(&fs::read_to_string(&path)?)?;
        let expected = state.version - 1;
        if existing.version != expected {
            return Err(WorkError::VersionConflict {
                expected,
                found: existing.version,
            });
        }
    }

    // Atomic: a watcher (or a concurrent reader) only ever sees the whole file.
    let tmp = temp_path(&path);
    let write = fs::write(&tmp, serde_json::to_string_pretty(state)?)
        .and_then(|()| fs::rename(&tmp, &path));
    if let Err(err) = write {
        // A temp file nobody will reuse is a temp file nobody will clean up.
        let _ = fs::remove_file(&tmp);
        return Err(err.into());
    }
    Ok(())
}

/// Counter behind [`temp_path`]. Paired with the pid so two *processes* — the
/// desktop app and the CLI, which is the concurrency this module is built
/// around — can't collide either.
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// A scratch path for one save, distinct from every other save's.
///
/// A shared `work.json.tmp` is not merely untidy: two writers that both pass
/// the version check (nothing holds a lock across it) write the same file, so
/// the first rename publishes whichever bytes landed last and the second fails
/// `ENOENT` — surfacing as [`WorkError::Io`], which [`super::mutate`] does not
/// retry, only `VersionConflict`. One writer's edit is lost and the other
/// errors despite its content being on disk.
///
/// Kept in the target's own directory so the rename stays within one
/// filesystem, which is what makes it atomic.
fn temp_path(path: &Path) -> PathBuf {
    let n = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    path.with_extension(format!("json.tmp.{}.{n}", std::process::id()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::central::tests::{setup_test, ENV_LOCK};

    #[test]
    fn temp_paths_are_unique_and_beside_the_target() {
        let target = Path::new("/central/work.json");
        let a = temp_path(target);
        let b = temp_path(target);

        assert_ne!(a, b);
        // Same directory, or the rename would cross filesystems and stop being
        // atomic.
        assert_eq!(a.parent(), target.parent());
        assert_eq!(b.parent(), target.parent());
        // Still recognizable as our scratch, so a stale one can be identified.
        for path in [&a, &b] {
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            assert!(name.starts_with("work.json.tmp."), "{name}");
        }
    }

    #[test]
    fn saves_leave_no_temp_file_behind() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, home, _repo) = setup_test();

        let mut state = WorkState::default();
        for _ in 0..3 {
            state.version += 1;
            save(&state).unwrap();
        }

        // A unique name is only safe if it's also cleaned up — the rename is
        // what removes it, so a leftover means a save went sideways.
        let mut names: Vec<_> = fs::read_dir(home.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, ["work.json"]);
        assert_eq!(load().unwrap().version, 3);
    }

    #[test]
    fn a_queue_from_a_newer_build_is_rejected_not_truncated() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        fs::write(
            work_path().unwrap(),
            r#"{"schemaVersion":99,"version":1,"workspaces":[]}"#,
        )
        .unwrap();

        assert!(matches!(
            load(),
            Err(WorkError::SchemaTooNew { found: 99, .. })
        ));
    }

    #[test]
    fn an_older_queue_loads_empty_and_keeps_its_version() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        // A v1 document: shapes this build cannot deserialize at all, which is
        // why the envelope is read on its own.
        fs::write(
            work_path().unwrap(),
            r#"{"schemaVersion":1,"version":7,"workspaces":[
                {"id":"0a1b2c3d","title":"old","notes":"","endorsed":true,
                 "claims":[{"repoPath":"/r","ref":"main"}],"createdAt":"x"}]}"#,
        )
        .unwrap();

        let state = load().unwrap();
        assert!(state.workspaces.is_empty());
        assert_eq!(state.schema_version, WORK_SCHEMA_VERSION);
        // Carrying the version forward is what lets the next write land instead
        // of conflicting forever with a document nothing will read again.
        assert_eq!(state.version, 7);
        let mut next = state;
        next.version += 1;
        save(&next).unwrap();
        assert_eq!(load().unwrap().version, 8);
    }
}
