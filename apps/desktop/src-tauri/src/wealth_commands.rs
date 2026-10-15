use crate::{
    AppState,
    error::{AppError, AppResult},
    wealth_storage,
};
use tauri::State;
use wealth_core::*;

#[tauri::command]
pub async fn get_wealth_workspace(
    filter: PortfolioFilter,
    state: State<'_, AppState>,
) -> AppResult<WealthWorkspace> {
    let data = wealth_storage::load(&state.pool).await?;
    let portfolio =
        wealth_core::portfolio(&data, &filter).map_err(|e| AppError::invalid(e.to_string()))?;
    Ok(WealthWorkspace { data, portfolio })
}

fn upsert<T>(items: &mut Vec<T>, value: T, id: impl Fn(&T) -> &str) {
    if let Some(index) = items.iter().position(|item| id(item) == id(&value)) {
        items[index] = value;
    } else {
        items.push(value);
    }
}

#[tauri::command]
pub async fn save_wealth_account(account: Account, state: State<'_, AppState>) -> AppResult<()> {
    wealth_storage::mutate(&state.pool, None, move |data| {
        upsert(&mut data.accounts, account, |x| &x.id);
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn save_wealth_instrument(
    instrument: Instrument,
    state: State<'_, AppState>,
) -> AppResult<usize> {
    wealth_storage::mutate(&state.pool, None, move |data| {
        // Sync reads the stored currency, so it must run before the upsert.
        let synced = wealth_storage::sync_instrument_currency(data, &instrument);
        upsert(&mut data.instruments, instrument, |x| &x.id);
        Ok(synced)
    })
    .await
}
#[tauri::command]
pub async fn save_wealth_activity(
    mut activity: Activity,
    state: State<'_, AppState>,
) -> AppResult<()> {
    wealth_storage::mutate(&state.pool, None, move |data| {
        // Same-day entries retain a stable user order. UUID lexical order must
        // never decide whether a just-entered deposit precedes its purchase.
        activity.sequence =
            if let Some(existing) = data.activities.iter().find(|x| x.id == activity.id) {
                existing.sequence
            } else {
                data.activities
                    .iter()
                    .map(|x| x.sequence)
                    .max()
                    .unwrap_or(0)
                    .checked_add(1)
                    .ok_or_else(|| AppError::invalid("ลำดับรายการเกินขอบเขตที่รองรับ"))?
            };
        upsert(&mut data.activities, activity, |x| &x.id);
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn delete_wealth_activity(id: String, state: State<'_, AppState>) -> AppResult<()> {
    wealth_storage::mutate(&state.pool, None, move |data| {
        data.activities.retain(|x| x.id != id);
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn save_wealth_opening(
    opening: OpeningPosition,
    state: State<'_, AppState>,
) -> AppResult<()> {
    wealth_storage::mutate(&state.pool, None, move |data| {
        upsert(&mut data.opening_positions, opening, |x| &x.id);
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn delete_wealth_opening(id: String, state: State<'_, AppState>) -> AppResult<()> {
    wealth_storage::mutate(&state.pool, None, move |data| {
        data.opening_positions.retain(|x| x.id != id);
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn save_wealth_price(mut price: Price, state: State<'_, AppState>) -> AppResult<()> {
    price.source = "manual".into();
    wealth_storage::mutate(&state.pool, None, move |data| {
        data.prices
            .retain(|x| x.instrument_id != price.instrument_id || x.date != price.date);
        data.prices.push(price);
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn save_wealth_fx(mut rate: FxRate, state: State<'_, AppState>) -> AppResult<()> {
    rate.source = "manual".into();
    wealth_storage::mutate(&state.pool, None, move |data| {
        data.fx_rates.retain(|x| {
            x.from_currency != rate.from_currency
                || x.to_currency != rate.to_currency
                || x.date != rate.date
        });
        data.fx_rates.push(rate);
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn save_wealth_preferences(
    preferences: WealthPreferences,
    state: State<'_, AppState>,
) -> AppResult<()> {
    wealth_storage::mutate(&state.pool, None, move |data| {
        if data.preferences.reporting_currency != preferences.reporting_currency {
            // Imported opening base costs belong to the old reporting currency.
            // Native basis remains valid; do not relabel it as another currency.
            for opening in &mut data.opening_positions {
                opening.cost_basis_base = None;
            }
        }
        data.preferences = preferences;
        Ok(())
    })
    .await
}
