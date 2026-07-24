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
}
