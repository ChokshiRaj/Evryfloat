use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(String),

    #[error("Clipboard error: {0}")]
    Clipboard(String),

    #[error("Item not found: {0}")]
    NotFound(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Action blocked: {0}")]
    Blocked(String),

    #[error("Confirmation declined")]
    ConfirmationDeclined,

    #[error("No association for file type: {0}")]
    NoAssociation(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Native OS error: {0}")]
    NativeOs(String),

    #[error("Validation error: {0}")]
    Validation(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        AppError::Database(err.to_string())
    }
}
