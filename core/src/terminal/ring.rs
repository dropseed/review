//! Bounded byte ring for terminal scrollback.
//!
//! Holds the most recent output bytes up to a fixed capacity so a client that
//! (re)attaches to a live session can replay what is currently on screen. When
//! the buffer is full, the oldest bytes are dropped to make room — the tail
//! (most recent output) is always retained.

use std::collections::VecDeque;
use std::sync::Mutex;

/// Default scrollback size: 256 KiB of raw PTY bytes.
pub const DEFAULT_RING_CAPACITY: usize = 256 * 1024;

/// The retained bytes plus the cumulative append counter, under one lock.
struct RingInner {
    buf: VecDeque<u8>,
    /// Total bytes ever appended, across the whole life of the session — not the
    /// buffered length. This is the monotonic byte **cursor** the wire contract
    /// uses to deduplicate replay against live output: every `append` returns the
    /// end-offset *after* the write, and [`snapshot_with_offset`] pairs the
    /// retained bytes with the cursor they end at.
    ///
    /// [`snapshot_with_offset`]: Ring::snapshot_with_offset
    total: u64,
}

/// A fixed-capacity FIFO byte buffer that keeps the most recent bytes.
///
/// Internally synchronized, so `append`/`snapshot` take `&self` and can be
/// called from the reader thread and API callers concurrently.
pub struct Ring {
    inner: Mutex<RingInner>,
    capacity: usize,
}

impl Ring {
    /// Create a ring with the [`DEFAULT_RING_CAPACITY`].
    pub fn new() -> Self {
        Self::with_capacity(DEFAULT_RING_CAPACITY)
    }

    /// Create a ring that retains at most `capacity` bytes.
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            inner: Mutex::new(RingInner {
                buf: VecDeque::with_capacity(capacity),
                total: 0,
            }),
            capacity,
        }
    }

    /// Append bytes, dropping the oldest bytes if capacity is exceeded. Returns
    /// the cumulative byte cursor *after* this write (the end-offset the reader
    /// thread stamps onto the outgoing [`super::TerminalMessage::Output`]).
    pub fn append(&self, bytes: &[u8]) -> u64 {
        let mut inner = self.inner.lock().unwrap();
        inner.total += bytes.len() as u64;

        // A single write larger than the whole ring: keep only its tail.
        if bytes.len() >= self.capacity {
            inner.buf.clear();
            inner.buf.extend(&bytes[bytes.len() - self.capacity..]);
            return inner.total;
        }

        inner.buf.extend(bytes);
        if inner.buf.len() > self.capacity {
            let overflow = inner.buf.len() - self.capacity;
            inner.buf.drain(..overflow);
        }
        inner.total
    }

    /// Copy the current contents out as a contiguous byte vector.
    pub fn snapshot(&self) -> Vec<u8> {
        self.snapshot_with_offset().0
    }

    /// Copy the current contents out, paired with the byte cursor they end at.
    /// Both are read under one lock so the cursor exactly matches the bytes: a
    /// client that replays these bytes can then discard any live chunk whose
    /// `seq` is `<=` this cursor.
    pub fn snapshot_with_offset(&self) -> (Vec<u8>, u64) {
        let inner = self.inner.lock().unwrap();
        let (head, tail) = inner.buf.as_slices();
        let mut out = Vec::with_capacity(inner.buf.len());
        out.extend_from_slice(head);
        out.extend_from_slice(tail);
        (out, inner.total)
    }

    /// Like [`Ring::snapshot_with_offset`], but trimmed to a byte a VT parser
    /// can safely start reading at.
    ///
    /// Old bytes are dropped at whatever offset makes room, so once the ring has
    /// wrapped its first byte is very likely the *middle* of an escape sequence.
    /// Replaying that leaves the client's parser mis-synced — the sequence's
    /// tail renders as literal junk and, worse, whatever state it was setting
    /// never gets set, so the rest of the replay lands in the wrong mode. That
    /// is the classic "reattached and the screen is garbage" failure, and
    /// full-screen TUIs (which emit almost nothing *but* escape sequences) hit
    /// it hardest.
    ///
    /// ESC is the one byte that unambiguously starts a sequence — it also
    /// aborts any sequence in progress — so a replay that begins there is
    /// always in sync. A ring that never wrapped starts at the session's real
    /// first byte and is returned untouched.
    pub fn snapshot_for_replay(&self) -> (Vec<u8>, u64) {
        let (mut out, cursor) = self.snapshot_with_offset();
        // The cursor counts every byte ever appended, so it only exceeds the
        // retained length once the ring has dropped something. Until then the
        // snapshot starts at the session's real first byte and is already sound.
        if cursor <= out.len() as u64 {
            return (out, cursor);
        }
        // No ESC at all means the retained bytes are plain text — nothing to
        // resync to, and nothing that can mis-parse.
        if let Some(first_esc) = out.iter().position(|&b| b == 0x1b) {
            out.drain(..first_esc);
        }
        (out, cursor)
    }
}

impl Default for Ring {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_returns_appended_bytes_in_order() {
        let ring = Ring::with_capacity(64);
        ring.append(b"hello ");
        ring.append(b"world");
        assert_eq!(ring.snapshot(), b"hello world");
    }

    #[test]
    fn bounds_to_capacity_and_keeps_tail() {
        let ring = Ring::with_capacity(8);
        // Append well past capacity across multiple writes.
        ring.append(b"abcde");
        ring.append(b"fghij");
        let snap = ring.snapshot();
        assert!(snap.len() <= 8, "snapshot {} exceeded capacity", snap.len());
        // Only the most recent 8 bytes survive.
        assert_eq!(snap, b"cdefghij");
    }

    #[test]
    fn single_write_larger_than_capacity_keeps_tail() {
        let ring = Ring::with_capacity(4);
        ring.append(b"0123456789");
        assert_eq!(ring.snapshot(), b"6789");
    }

    #[test]
    fn append_returns_cumulative_end_offset() {
        let ring = Ring::with_capacity(8);
        assert_eq!(ring.append(b"abc"), 3);
        assert_eq!(ring.append(b"de"), 5);
        // The cursor counts every byte ever appended, even once the buffer has
        // dropped the oldest bytes to stay within capacity.
        assert_eq!(ring.append(b"fghij"), 10);
        let (bytes, cursor) = ring.snapshot_with_offset();
        assert_eq!(cursor, 10);
        assert_eq!(bytes, b"cdefghij");
    }

    #[test]
    fn oversized_write_advances_cursor_by_full_length() {
        let ring = Ring::with_capacity(4);
        assert_eq!(ring.append(b"0123456789"), 10);
        assert_eq!(ring.snapshot_with_offset(), (b"6789".to_vec(), 10));
    }

    #[test]
    fn replay_snapshot_starts_at_an_escape_once_the_ring_has_wrapped() {
        let ring = Ring::with_capacity(12);
        // Overflow the ring so its first retained bytes land mid-sequence.
        ring.append(b"\x1b[31mred");
        ring.append(b"\x1b[0mplain");
        // Raw snapshot begins inside the truncated "\x1b[31m".
        let (raw, _) = ring.snapshot_with_offset();
        assert_eq!(raw, b"red\x1b[0mplain");
        // Replay drops the orphaned tail and starts at the next real sequence.
        let (replay, cursor) = ring.snapshot_for_replay();
        assert_eq!(replay, b"\x1b[0mplain");
        // Trimming the front never moves the cursor: it marks the end offset.
        assert_eq!(cursor, 17);
    }

    #[test]
    fn replay_snapshot_is_untouched_when_the_ring_never_wrapped() {
        let ring = Ring::with_capacity(64);
        // Plain text ahead of the first sequence is genuine session output here,
        // not a truncation artifact, so it must survive.
        ring.append(b"$ claude\r\n\x1b[32mready");
        let (replay, cursor) = ring.snapshot_for_replay();
        assert_eq!(replay, b"$ claude\r\n\x1b[32mready");
        assert_eq!(cursor, 20);
    }

    #[test]
    fn replay_snapshot_keeps_plain_text_with_no_escape_to_resync_to() {
        let ring = Ring::with_capacity(4);
        ring.append(b"abcdefgh");
        assert_eq!(ring.snapshot_for_replay(), (b"efgh".to_vec(), 8));
    }
}
