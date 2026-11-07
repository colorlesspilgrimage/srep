pub mod app;
pub mod spa_shell;
pub mod static_files;

pub use app::build_app;

#[cfg(test)]
pub use app::build_app_for_test;
