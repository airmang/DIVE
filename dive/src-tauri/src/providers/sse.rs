use eventsource_stream::Eventsource;
use futures::{stream::BoxStream, StreamExt};

use super::ProviderError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseEvent {
    pub event: String,
    pub data: String,
    pub id: String,
}

pub fn response_to_sse_events(
    response: reqwest::Response,
) -> BoxStream<'static, Result<SseEvent, ProviderError>> {
    response
        .bytes_stream()
        .eventsource()
        .map(|event| {
            event
                .map(|event| SseEvent {
                    event: event.event,
                    data: event.data,
                    id: event.id,
                })
                .map_err(|error| ProviderError::Stream(error.to_string()))
        })
        .boxed()
}
