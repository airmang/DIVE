//! Mock provider for tests.
//!
//! Accepts a pre-scripted queue of `Vec<ChatEvent>` batches; each call to
//! `chat()` pops the front batch and returns it as a stream. Used by the
//! Agent Loop integration tests.

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use futures::stream::{self, BoxStream};
use futures::StreamExt;

use super::error::ProviderError;
use super::types::{ChatEvent, ChatRequest, ModelInfo};
use super::LlmProvider;

#[derive(Clone)]
pub struct MockProvider {
    pub id: String,
    pub scripts: Arc<Mutex<Vec<Vec<ChatEvent>>>>,
    pub requests: Arc<Mutex<Vec<ChatRequest>>>,
}

impl MockProvider {
    pub fn new(scripts: Vec<Vec<ChatEvent>>) -> Self {
        Self {
            id: "mock".into(),
            scripts: Arc::new(Mutex::new(scripts)),
            requests: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn request_count(&self) -> usize {
        self.requests.lock().map(|r| r.len()).unwrap_or(0)
    }

    pub fn requests_snapshot(&self) -> Vec<ChatRequest> {
        self.requests.lock().map(|r| r.clone()).unwrap_or_default()
    }
}

#[async_trait]
impl LlmProvider for MockProvider {
    fn id(&self) -> &str {
        &self.id
    }

    fn list_models(&self) -> Vec<ModelInfo> {
        vec![ModelInfo {
            id: "mock-model".into(),
            display_name: "Mock".into(),
        }]
    }

    async fn chat(&self, req: ChatRequest) -> Result<BoxStream<'static, ChatEvent>, ProviderError> {
        if let Ok(mut r) = self.requests.lock() {
            r.push(req);
        }
        let batch = {
            let mut s = self
                .scripts
                .lock()
                .map_err(|_| ProviderError::Unsupported("mock mutex poisoned".into()))?;
            if s.is_empty() {
                vec![ChatEvent::Done {
                    finish_reason: super::FinishReason::Stop,
                }]
            } else {
                s.remove(0)
            }
        };
        Ok(stream::iter(batch).boxed())
    }

    async fn refresh_auth(&mut self) -> Result<(), ProviderError> {
        Ok(())
    }
}
