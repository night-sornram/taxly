-- The investment module moved out of Taxly; its data is dropped deliberately.
-- Children go first because foreign keys are enforced during DROP TABLE.
DROP TABLE wealth_import_mappings;
DROP TABLE wealth_fx_rates;
DROP TABLE wealth_prices;
DROP TABLE wealth_opening_positions;
DROP TABLE wealth_activities;
DROP TABLE wealth_instruments;
DROP TABLE wealth_accounts;
DROP TABLE wealth_meta;

CREATE TABLE ledger_categories (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 50),
    UNIQUE(kind,name)
) STRICT;

-- Income vs expense comes from the category, so the two cannot disagree.
-- A linked tax income row is owned by its ledger entry; deleting it on the
-- tax side only clears the link.
CREATE TABLE ledger_entries (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
    category_id TEXT NOT NULL REFERENCES ledger_categories(id),
    amount_satang INTEGER NOT NULL CHECK (amount_satang > 0),
    note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
    tax_income_id TEXT UNIQUE REFERENCES income_entries(id) ON DELETE SET NULL
) STRICT;
CREATE INDEX ledger_by_date ON ledger_entries(date);

-- Default categories are seeded by the app (ledger::seed_categories).
