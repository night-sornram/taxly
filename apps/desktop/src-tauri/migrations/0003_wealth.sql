-- Financial decimals are JSON strings, decoded and validated by wealth-core.
-- The relational keys below protect the graph as well as typed validation.
CREATE TABLE wealth_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    preferences_json TEXT NOT NULL CHECK (json_valid(preferences_json))
) STRICT;
INSERT INTO wealth_meta VALUES (1, 0, '{"reporting_currency":"THB","market_data_enabled":false}');
CREATE TABLE wealth_accounts (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL CHECK (json_valid(payload))
) STRICT;
CREATE TABLE wealth_instruments (
    id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    exchange TEXT NOT NULL,
    currency TEXT NOT NULL,
    payload TEXT NOT NULL CHECK (json_valid(payload)),
    UNIQUE(symbol, exchange, currency)
) STRICT;
CREATE TABLE wealth_activities (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES wealth_accounts(id),
    instrument_id TEXT REFERENCES wealth_instruments(id),
    related_account_id TEXT REFERENCES wealth_accounts(id),
    payload TEXT NOT NULL CHECK (json_valid(payload))
) STRICT;
CREATE TABLE wealth_opening_positions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES wealth_accounts(id),
    instrument_id TEXT REFERENCES wealth_instruments(id),
    payload TEXT NOT NULL CHECK (json_valid(payload))
) STRICT;
CREATE TABLE wealth_prices (
    instrument_id TEXT NOT NULL REFERENCES wealth_instruments(id),
    date TEXT NOT NULL,
    payload TEXT NOT NULL CHECK (json_valid(payload)),
    PRIMARY KEY(instrument_id, date)
) STRICT;
CREATE TABLE wealth_fx_rates (
    from_currency TEXT NOT NULL,
    to_currency TEXT NOT NULL,
    date TEXT NOT NULL,
    payload TEXT NOT NULL CHECK (json_valid(payload)),
    PRIMARY KEY(from_currency, to_currency, date)
) STRICT;
CREATE TABLE wealth_import_mappings (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL CHECK (json_valid(payload))
) STRICT;
