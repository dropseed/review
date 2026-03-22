//! JSON-RPC 2.0 message types and Content-Length framing.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

/// A JSON-RPC 2.0 message (request, response, or notification).
#[derive(Debug, Clone)]
pub enum Message {
    Request {
        id: i64,
        method: String,
        params: Value,
    },
    Response {
        id: i64,
        result: Option<Value>,
        error: Option<RpcError>,
    },
    Notification {
        method: String,
        params: Value,
    },
}

/// A JSON-RPC 2.0 error object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "JSON-RPC error {}: {}", self.code, self.message)
    }
}

impl std::error::Error for RpcError {}

/// Serialize a message to bytes with Content-Length framing.
pub fn serialize_message(msg: &Message) -> Vec<u8> {
    let json = match msg {
        Message::Request { id, method, params } => {
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": method,
                "params": params,
            })
        }
        Message::Response { id, result, error } => {
            let mut obj = serde_json::json!({ "jsonrpc": "2.0", "id": id });
            if let Some(r) = result {
                obj["result"] = r.clone();
            }
            if let Some(e) = error {
                obj["error"] = serde_json::to_value(e).unwrap_or_default();
            }
            obj
        }
        Message::Notification { method, params } => {
            serde_json::json!({
                "jsonrpc": "2.0",
                "method": method,
                "params": params,
            })
        }
    };

    let body = serde_json::to_string(&json).expect("Failed to serialize JSON-RPC message");
    format!("Content-Length: {}\r\n\r\n{}", body.len(), body).into_bytes()
}

/// Async reader that parses Content-Length framed JSON-RPC messages from a stream.
pub struct MessageReader<R> {
    reader: BufReader<R>,
}

impl<R: tokio::io::AsyncRead + Unpin> MessageReader<R> {
    pub fn new(reader: R) -> Self {
        Self {
            reader: BufReader::new(reader),
        }
    }

    /// Read the next message. Returns `None` on EOF.
    pub async fn next_message(&mut self) -> anyhow::Result<Option<Message>> {
        // Parse headers until blank line
        let mut content_length: Option<usize> = None;

        loop {
            let mut line = String::new();
            let bytes_read = self.reader.read_line(&mut line).await?;
            if bytes_read == 0 {
                return Ok(None); // EOF
            }

            let trimmed = line.trim();
            if trimmed.is_empty() {
                break; // End of headers
            }

            if let Some(len_str) = trimmed.strip_prefix("Content-Length: ") {
                content_length = Some(len_str.parse::<usize>()?);
            }
            // Ignore other headers (e.g. Content-Type)
        }

        let length = content_length.ok_or_else(|| anyhow::anyhow!("Missing Content-Length"))?;

        let mut body = vec![0u8; length];
        self.reader.read_exact(&mut body).await?;

        let json: Value = serde_json::from_slice(&body)?;
        Ok(Some(parse_message(json)?))
    }
}

/// Parse a JSON value into a Message.
fn parse_message(json: Value) -> anyhow::Result<Message> {
    let obj = json
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("Expected JSON object"))?;

    if let Some(id) = obj.get("id") {
        let id = id.as_i64().unwrap_or(0);

        if obj.contains_key("method") {
            Ok(Message::Request {
                id,
                method: obj["method"].as_str().unwrap_or("").to_owned(),
                params: obj.get("params").cloned().unwrap_or(Value::Null),
            })
        } else {
            let error = obj
                .get("error")
                .and_then(|e| serde_json::from_value::<RpcError>(e.clone()).ok());
            Ok(Message::Response {
                id,
                result: obj.get("result").cloned(),
                error,
            })
        }
    } else if obj.contains_key("method") {
        Ok(Message::Notification {
            method: obj["method"].as_str().unwrap_or("").to_owned(),
            params: obj.get("params").cloned().unwrap_or(Value::Null),
        })
    } else {
        anyhow::bail!("Unknown JSON-RPC message format")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serialize_request() {
        let msg = Message::Request {
            id: 1,
            method: "initialize".to_owned(),
            params: serde_json::json!({}),
        };
        let bytes = serialize_message(&msg);
        let s = String::from_utf8(bytes).unwrap();
        assert!(s.starts_with("Content-Length: "));
        assert!(s.contains("\"jsonrpc\":\"2.0\""));
        assert!(s.contains("\"id\":1"));
        assert!(s.contains("\"method\":\"initialize\""));
    }

    #[test]
    fn test_serialize_notification() {
        let msg = Message::Notification {
            method: "initialized".to_owned(),
            params: serde_json::json!({}),
        };
        let bytes = serialize_message(&msg);
        let s = String::from_utf8(bytes).unwrap();
        assert!(!s.contains("\"id\""));
        assert!(s.contains("\"method\":\"initialized\""));
    }

    #[tokio::test]
    async fn test_read_message() {
        let body = r#"{"jsonrpc":"2.0","id":1,"result":{"capabilities":{}}}"#;
        let frame = format!("Content-Length: {}\r\n\r\n{}", body.len(), body);
        let cursor = std::io::Cursor::new(frame.into_bytes());
        let mut reader = MessageReader::new(cursor);
        let msg = reader.next_message().await.unwrap().unwrap();
        match msg {
            Message::Response { id, result, error } => {
                assert_eq!(id, 1);
                assert!(result.is_some());
                assert!(error.is_none());
            }
            _ => panic!("Expected Response"),
        }
    }

    #[tokio::test]
    async fn test_read_notification() {
        let body = r#"{"jsonrpc":"2.0","method":"window/logMessage","params":{"type":3,"message":"hello"}}"#;
        let frame = format!("Content-Length: {}\r\n\r\n{}", body.len(), body);
        let cursor = std::io::Cursor::new(frame.into_bytes());
        let mut reader = MessageReader::new(cursor);
        let msg = reader.next_message().await.unwrap().unwrap();
        match msg {
            Message::Notification { method, .. } => {
                assert_eq!(method, "window/logMessage");
            }
            _ => panic!("Expected Notification"),
        }
    }

    #[tokio::test]
    async fn test_read_eof() {
        let cursor = std::io::Cursor::new(Vec::new());
        let mut reader = MessageReader::new(cursor);
        let msg = reader.next_message().await.unwrap();
        assert!(msg.is_none());
    }

    #[tokio::test]
    async fn test_roundtrip() {
        let original = Message::Request {
            id: 42,
            method: "textDocument/definition".to_owned(),
            params: serde_json::json!({
                "textDocument": { "uri": "file:///test.py" },
                "position": { "line": 10, "character": 5 }
            }),
        };
        let bytes = serialize_message(&original);
        let cursor = std::io::Cursor::new(bytes);
        let mut reader = MessageReader::new(cursor);
        let msg = reader.next_message().await.unwrap().unwrap();
        match msg {
            Message::Request { id, method, params } => {
                assert_eq!(id, 42);
                assert_eq!(method, "textDocument/definition");
                assert_eq!(params["position"]["line"], 10);
            }
            _ => panic!("Expected Request"),
        }
    }
}
