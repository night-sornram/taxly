mod backup;
mod catalog;
mod commands;
mod error;
mod models;
mod services;
mod storage;
mod wealth_commands;
mod wealth_import;
mod wealth_market;
mod wealth_storage;

use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

pub struct AppState {
    pool: SqlitePool,
    catalog: Arc<catalog::Catalog>,
    pending_backup: Mutex<Option<backup::PendingBackup>>,
    pending_import: Mutex<Option<wealth_import::PendingImport>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            // Isolate native smoke tests from real data; ignored in release builds.
            #[cfg(debug_assertions)]
            let dir = std::env::var_os("TAXLY_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(dir);
            let catalog = Arc::new(
                catalog::Catalog::bundled().map_err(|_| "invalid bundled tax rule catalog")?,
            );
            let pool = tauri::async_runtime::block_on(storage::connect(
                &dir.join("taxly.sqlite3"),
                &catalog,
            ))
            .map_err(|_| "cannot initialize private Taxly database")?;
            app.manage(AppState {
                pool,
                catalog,
                pending_backup: Mutex::new(None),
                pending_import: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_tax_years,
            commands::get_active_tax_year,
            commands::set_active_tax_year,
            commands::get_year_workspace,
            commands::save_onboarding,
            commands::save_onboarding_draft,
            commands::save_profile,
            commands::upsert_income,
            commands::delete_income,
            commands::upsert_deduction,
            commands::delete_deduction,
            commands::calculate_year,
            commands::save_snapshot,
            commands::get_history,
            commands::get_deduction_guidance,
            commands::get_rule_sources,
            commands::open_source,
            commands::export_backup,
            commands::inspect_backup,
            commands::restore_backup,
            commands::cancel_restore,
            commands::delete_all_data,
            wealth_commands::get_wealth_workspace,
            wealth_commands::save_wealth_account,
            wealth_commands::save_wealth_instrument,
            wealth_commands::save_wealth_activity,
            wealth_commands::delete_wealth_activity,
            wealth_commands::save_wealth_opening,
            wealth_commands::delete_wealth_opening,
            wealth_commands::save_wealth_price,
            wealth_commands::save_wealth_fx,
            wealth_commands::save_wealth_preferences,
            wealth_import::preview_wealth_import,
            wealth_import::commit_wealth_import,
            wealth_import::cancel_wealth_import,
            wealth_import::save_wealth_template,
            wealth_market::refresh_wealth_market_data,
            wealth_market::search_wealth_instruments,
        ])
        .run(tauri::generate_context!())
        .expect("Taxly could not start");
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod wealth_tests;
