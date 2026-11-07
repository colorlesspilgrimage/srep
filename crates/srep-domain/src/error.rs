use axum::http::StatusCode;
use serde::Serialize;

#[derive(Debug, Clone)]
pub struct ApiFailure {
    pub status: StatusCode,
    pub error: &'static str,
}

impl ApiFailure {
    pub fn new(status: StatusCode, error: &'static str) -> Self {
        Self { status, error }
    }
}

pub fn fail(status: StatusCode, error: &'static str) -> ApiFailure {
    ApiFailure::new(status, error)
}

#[derive(Serialize)]
pub struct ErrorBody<'a> {
    pub error: &'a str,
}

pub type ApiResult<T> = Result<T, ApiFailure>;
