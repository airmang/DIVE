use eventsource_stream::Eventsource;
use futures::{stream, stream::BoxStream, Stream, StreamExt};
use std::time::Duration;

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
    let events = response.bytes_stream().eventsource().map(|event| {
        event
            .map(|event| SseEvent {
                event: event.event,
                data: event.data,
                id: event.id,
            })
            .map_err(|error| ProviderError::Stream(error.to_string()))
    });
    with_chunk_timeout(events, crate::http_client::PROVIDER_STREAM_CHUNK_TIMEOUT)
}

pub(crate) fn with_chunk_timeout<S>(
    events: S,
    timeout_duration: Duration,
) -> BoxStream<'static, Result<SseEvent, ProviderError>>
where
    S: Stream<Item = Result<SseEvent, ProviderError>> + Send + 'static,
{
    stream::unfold(Some(events.boxed()), move |state| async move {
        let mut events = state?;
        match tokio::time::timeout(timeout_duration, events.next()).await {
            Ok(Some(item)) => Some((item, Some(events))),
            Ok(None) => None,
            Err(_) => Some((
                Err(ProviderError::Timeout(format!(
                    "provider stream timed out after {}s while waiting for data; check the network and retry",
                    timeout_duration.as_secs()
                ))),
                None,
            )),
        }
    })
    .boxed()
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use futures::{stream, StreamExt};

    use super::*;

    #[tokio::test]
    async fn chunk_timeout_returns_clear_provider_error_when_stream_stalls() {
        let events = stream::pending::<Result<SseEvent, ProviderError>>();
        let mut timed = with_chunk_timeout(events, Duration::from_millis(5));

        let err = timed.next().await.unwrap().unwrap_err();

        assert!(matches!(err, ProviderError::Timeout(_)));
        assert!(
            err.to_string().contains("stream")
                && err.to_string().contains("timed out")
                && err.to_string().contains("retry")
        );
    }
}
