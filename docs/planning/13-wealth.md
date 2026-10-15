# Wealth portfolio module

Taxly combines Thai salary-tax estimation with independently implemented portfolio tracking inspired by Wealthfolio. The modules share private SQLite storage and encrypted backups; investment results do not enter the tax engine.

## Product and boundaries

Investments are available before tax onboarding. The Thai interface includes overview, accounts, holdings, activities, CSV review, and market data. Reporting currency defaults to THB. Stocks, ETFs, fractional units, and multi-currency account cash are supported. Brokerage sync, funds, crypto, debts, budgets, XIRR, and investment tax rules remain outside this release.

## Domain and numerical contracts

`wealth-core` is a pure Rust crate with `validate(WealthData)` and `portfolio(WealthData, PortfolioFilter)`. It has no database, clock, filesystem, or network access. Wealth numbers remain decimal strings through IPC and SQLite JSON payloads; Rust performs checked decimal arithmetic. Frontend chart coordinates may use floating-point projection, never financial calculation.

Accounts hold cash by currency. Activities record deposits, withdrawals, buys, sells, dividends, interest, fees, withholding (`tax`), stock splits, linked cash transfers, and explicit currency exchanges (`fx`). An activity amount is the final cash debit/credit including charges. Buys/sells may omit that amount to derive it from quantity, unit price, fee, and withholding; supplied amounts must reconcile. FIFO lots preserve basis through partial disposals and splits. Invalid backdated changes roll back completely.

Opening records for an account share a baseline date. Cash openings use no instrument ID; their quantity is the cash balance. Security openings can have unknown native or reporting-currency cost basis. Unknown basis stays unavailable. Changing reporting currency invalidates manually supplied opening base costs while preserving native cost.

Performance uses daily valuations and geometrically linked time-weighted return (TWR). Deposits occur at the start of the day; withdrawals at the end. Transfers within the selected scope are internal. Opening positions establish a starting valuation, never pre-baseline returns. TWR and allocations are decimal fractions (`0.05` means 5%). Gains on holdings use native currency; totals and period gain use reporting currency. Historical valuations use prices and FX on or before that date, with warnings for stale data and unavailable results when inputs are incomplete.

## Application boundary

`get_wealth_workspace` returns typed records plus a calculated portfolio for account/date filters. Dedicated commands save accounts, instruments, activities, openings, manual quotes, FX, and preferences. All calls are main-window allowlisted. Native dialogs and HTTP remain in Rust; the frontend receives no filesystem, SQL, shell, or general network capability.

CSV review accepts activities or opening positions, reusable column mappings, ISO/day-first/Buddhist dates, and explicit symbol resolution. Preview changes no financial records. Duplicate candidates are initially excluded and can be deliberately included. Commit consumes a time-limited token, checks the reviewed revision, replays the entire resulting ledger, and writes accepted rows atomically.

Market data defaults off. Optional on-demand Yahoo requests expose requested symbols and IP to Yahoo. Refreshes fetch historical quotes and FX, retain cached results on failure, and preserve manual overrides. Provider split adjustments are reversed to match explicitly recorded split activities. Quotes are best effort, can be delayed, and are not trade execution prices.

When market data is enabled, visible holdings load company/ETF logos directly from Financial Modeling Prep's `image-stock` endpoint using the market-qualified provider symbol (for example, `PTT.BK`). Logos are remote images, not bundled assets or database records. Requests omit the referrer and expose only the requested symbol and IP to the provider. The CSP permits this image path only; it grants no frontend network API access. Disabled market data, unavailable logos, and image errors show symbol initials instead.

## Storage and backup compatibility

Migration 0003 adds separate STRICT wealth tables with relational foreign keys and typed JSON payloads. Each mutation takes a write transaction, validates the complete financial graph, increments its revision, and commits consistently. Existing tax tables and satang representation are retained.

Backup v2 includes both modules, imported mappings, preferences, prices, and FX. A v2 restore replaces both modules atomically and invalidates old import/refresh revisions. Legacy v1 restore replaces tax records only and preserves wealth data; the review screen explains this scope. Delete-all-data clears both modules and caches and resets wealth preferences. The live database remains plaintext with private OS file permissions; age encryption applies to backups.

## Verification

Core fixtures cover FIFO, fractional units, charges, splits, FX, transfer scopes, TWR flows, unknown costs, missing/stale market data, and invalid histories. Real SQLite tests cover migration, restart, revisions, rollback, legacy restore, and v2 backup. Browser tests use Rust-generated wealth contracts for UI assertions; they do not substitute for SQLite, encryption, live providers, or native dialogs.
