use std::time::Duration;

use tokio::time::sleep;

use crate::providers::ProviderError;

pub fn is_retryable(err: &ProviderError) -> bool {
    match err {
        ProviderError::Http(e) => {
            if e.is_timeout() || e.is_connect() {
                return true;
            }
            if let Some(status) = e.status() {
                return status.is_server_error();
            }
            false
        }
        ProviderError::Api { status, .. } => *status >= 500 && *status < 600,
        ProviderError::Stream(_) => true,
        _ => false,
    }
}

pub async fn with_retry<F, Fut, T>(
    mut op: F,
    max_attempts: u32,
    base_delay: Duration,
) -> Result<T, ProviderError>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, ProviderError>>,
{
    let mut last: Option<ProviderError> = None;
    for attempt in 0..max_attempts {
        match op().await {
            Ok(v) => return Ok(v),
            Err(err) => {
                if !is_retryable(&err) {
                    return Err(err);
                }
                last = Some(err);
                if attempt + 1 < max_attempts {
                    let delay = base_delay * 2u32.pow(attempt);
                    sleep(delay).await;
                }
            }
        }
    }
    Err(last.unwrap_or_else(|| ProviderError::Stream("retry exhausted".into())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    #[test]
    fn retryable_api_server_errors() {
        let e = ProviderError::Api {
            status: 500,
            body: "x".into(),
        };
        assert!(is_retryable(&e));
        let e = ProviderError::Api {
            status: 503,
            body: "x".into(),
        };
        assert!(is_retryable(&e));
    }

    #[test]
    fn not_retryable_client_errors() {
        let e = ProviderError::Api {
            status: 400,
            body: "x".into(),
        };
        assert!(!is_retryable(&e));
        let e = ProviderError::Api {
            status: 401,
            body: "x".into(),
        };
        assert!(!is_retryable(&e));
        let e = ProviderError::Auth("bad key".into());
        assert!(!is_retryable(&e));
        let e = ProviderError::Unsupported("xxx".into());
        assert!(!is_retryable(&e));
    }

    #[tokio::test]
    async fn succeeds_on_second_attempt() {
        let calls = Arc::new(AtomicU32::new(0));
        let c = calls.clone();
        let result = with_retry(
            || {
                let c = c.clone();
                async move {
                    let n = c.fetch_add(1, Ordering::SeqCst);
                    if n == 0 {
                        Err(ProviderError::Api {
                            status: 502,
                            body: "x".into(),
                        })
                    } else {
                        Ok::<_, ProviderError>(42)
                    }
                }
            },
            3,
            Duration::from_millis(1),
        )
        .await;
        assert_eq!(result.unwrap(), 42);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn fails_immediately_on_non_retryable() {
        let calls = Arc::new(AtomicU32::new(0));
        let c = calls.clone();
        let result = with_retry(
            || {
                let c = c.clone();
                async move {
                    c.fetch_add(1, Ordering::SeqCst);
                    Err::<u32, _>(ProviderError::Api {
                        status: 400,
                        body: "bad".into(),
                    })
                }
            },
            5,
            Duration::from_millis(1),
        )
        .await;
        assert!(result.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn exhausts_after_max_attempts() {
        let calls = Arc::new(AtomicU32::new(0));
        let c = calls.clone();
        let result = with_retry(
            || {
                let c = c.clone();
                async move {
                    c.fetch_add(1, Ordering::SeqCst);
                    Err::<u32, _>(ProviderError::Api {
                        status: 503,
                        body: "x".into(),
                    })
                }
            },
            3,
            Duration::from_millis(1),
        )
        .await;
        assert!(result.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 3);
    }
}
