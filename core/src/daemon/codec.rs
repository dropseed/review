//! Length-prefixed framing for the daemon's Unix-socket protocol.
//!
//! Every message on the wire — control JSON, stream frames, the opening hello —
//! is a 4-byte big-endian length prefix followed by exactly that many body
//! bytes. The framing is deliberately dumb: it knows nothing about the payload,
//! so [`super::protocol`] can evolve without touching this layer.

use std::io;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// Largest body we will write or accept. A corrupt or hostile length prefix
/// would otherwise make the reader allocate up to 4 GiB in one go; 64 MiB is far
/// above anything the protocol produces (the biggest real frame is a scrollback
/// replay, bounded by the session ring).
pub const MAX_FRAME_LEN: usize = 64 * 1024 * 1024;

/// The 4-byte big-endian length prefix for a body of `len` bytes.
///
/// The single place the [`MAX_FRAME_LEN`] limit is enforced, shared by
/// [`write_frame`] and by callers that build header and body in one buffer (see
/// [`super::protocol::encode_output_framed`]).
pub(super) fn frame_header(len: usize) -> io::Result<[u8; 4]> {
    if len > MAX_FRAME_LEN {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("frame of {len} bytes exceeds the {MAX_FRAME_LEN}-byte limit"),
        ));
    }
    // The length check above guarantees the cast fits.
    Ok((len as u32).to_be_bytes())
}

/// Write one length-prefixed frame and flush it.
pub async fn write_frame<W>(writer: &mut W, body: &[u8]) -> io::Result<()>
where
    W: AsyncWrite + Unpin + ?Sized,
{
    writer.write_all(&frame_header(body.len())?).await?;
    writer.write_all(body).await?;
    writer.flush().await
}

/// Read one length-prefixed frame.
///
/// Returns `Ok(None)` on a **clean** EOF (the peer closed between frames), which
/// is the normal way a read loop ends. A partial header or a short body is a
/// truncated frame and surfaces as [`io::ErrorKind::UnexpectedEof`]; an
/// over-long length is [`io::ErrorKind::InvalidData`].
pub async fn read_frame<R>(reader: &mut R) -> io::Result<Option<Vec<u8>>>
where
    R: AsyncRead + Unpin + ?Sized,
{
    let mut header = [0u8; 4];
    let mut filled = 0;
    while filled < header.len() {
        let n = reader.read(&mut header[filled..]).await?;
        if n == 0 {
            if filled == 0 {
                return Ok(None); // clean end of stream
            }
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "truncated frame header",
            ));
        }
        filled += n;
    }

    let len = u32::from_be_bytes(header) as usize;
    if len > MAX_FRAME_LEN {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("frame length {len} exceeds the {MAX_FRAME_LEN}-byte limit"),
        ));
    }

    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).await?;
    Ok(Some(body))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Write every body into one buffer, then read them all back.
    async fn round_trip(bodies: &[&[u8]]) -> Vec<Vec<u8>> {
        let mut buf: Vec<u8> = Vec::new();
        for body in bodies {
            write_frame(&mut buf, body).await.unwrap();
        }
        let mut reader = buf.as_slice();
        let mut out = Vec::new();
        while let Some(frame) = read_frame(&mut reader).await.unwrap() {
            out.push(frame);
        }
        out
    }

    #[tokio::test]
    async fn frames_round_trip_in_order() {
        let frames = round_trip(&[b"hello", b"", b"\x00\xff\x00binary"]).await;
        assert_eq!(frames.len(), 3);
        assert_eq!(frames[0], b"hello");
        assert!(
            frames[1].is_empty(),
            "empty frame must survive the round trip"
        );
        assert_eq!(frames[2], b"\x00\xff\x00binary");
    }

    #[tokio::test]
    async fn large_frame_round_trips() {
        let big = vec![0xabu8; 1024 * 1024];
        let frames = round_trip(&[&big]).await;
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0], big);
    }

    #[tokio::test]
    async fn header_encodes_length_big_endian() {
        let mut buf: Vec<u8> = Vec::new();
        write_frame(&mut buf, b"abc").await.unwrap();
        assert_eq!(&buf[..4], &[0, 0, 0, 3]);
        assert_eq!(&buf[4..], b"abc");
    }

    #[tokio::test]
    async fn clean_eof_between_frames_is_none() {
        let mut reader: &[u8] = &[];
        assert!(read_frame(&mut reader).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn truncated_header_and_body_are_unexpected_eof() {
        let mut partial_header: &[u8] = &[0, 0];
        let err = read_frame(&mut partial_header).await.unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::UnexpectedEof);

        // Header promises 10 bytes, only 3 follow.
        let mut short_body: &[u8] = &[0, 0, 0, 10, b'a', b'b', b'c'];
        let err = read_frame(&mut short_body).await.unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::UnexpectedEof);
    }

    #[tokio::test]
    async fn oversized_length_is_rejected_without_allocating() {
        let len = (MAX_FRAME_LEN as u32) + 1;
        let mut bytes = len.to_be_bytes().to_vec();
        bytes.push(0);
        let mut reader = bytes.as_slice();
        let err = read_frame(&mut reader).await.unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
    }
}
