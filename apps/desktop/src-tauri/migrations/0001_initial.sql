CREATE TABLE tax_years (
    year INTEGER PRIMARY KEY CHECK (year BETWEEN 2025 AND 2026),
    eligibility_json TEXT NOT NULL CHECK (json_valid(eligibility_json)),
    completion_state TEXT NOT NULL DEFAULT 'incomplete' CHECK (completion_state IN ('incomplete','complete')),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE income_sources (
    id TEXT PRIMARY KEY,
    tax_year INTEGER NOT NULL REFERENCES tax_years(year) ON DELETE CASCADE,
    label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
    UNIQUE(id,tax_year)
) STRICT;

CREATE TABLE income_entries (
    id TEXT PRIMARY KEY,
    tax_year INTEGER NOT NULL REFERENCES tax_years(year) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    kind TEXT NOT NULL CHECK (kind IN ('salary','bonus')),
    basis TEXT NOT NULL CHECK (basis IN ('actual','forecast')),
    gross_satang INTEGER NOT NULL CHECK (gross_satang >= 0),
    withholding_satang INTEGER CHECK (withholding_satang >= 0),
    FOREIGN KEY (source_id,tax_year) REFERENCES income_sources(id,tax_year)
) STRICT;
CREATE UNIQUE INDEX one_salary_per_source_month ON income_entries(source_id,month) WHERE kind = 'salary';
CREATE INDEX income_by_year ON income_entries(tax_year,month);

CREATE TABLE deduction_entries (
    id TEXT PRIMARY KEY,
    tax_year INTEGER NOT NULL REFERENCES tax_years(year) ON DELETE CASCADE,
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    rule_code TEXT NOT NULL CHECK (rule_code = 'sso_33'),
    basis TEXT NOT NULL CHECK (basis IN ('actual','forecast')),
    amount_satang INTEGER NOT NULL CHECK (amount_satang >= 0),
    UNIQUE(tax_year,month,rule_code)
) STRICT;

CREATE TABLE rule_sets (
    id TEXT PRIMARY KEY,
    tax_year INTEGER NOT NULL,
    version TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    sha256 TEXT NOT NULL UNIQUE,
    review_state TEXT NOT NULL,
    verified_at TEXT NOT NULL
) STRICT;

CREATE TABLE calculation_snapshots (
    id TEXT PRIMARY KEY,
    tax_year INTEGER NOT NULL REFERENCES tax_years(year) ON DELETE CASCADE,
    rule_set_id TEXT NOT NULL REFERENCES rule_sets(id),
    engine_version TEXT NOT NULL,
    input_json TEXT NOT NULL CHECK (json_valid(input_json)),
    result_json TEXT NOT NULL CHECK (json_valid(result_json)),
    input_hash TEXT NOT NULL,
    data_revision INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(tax_year,data_revision,rule_set_id,engine_version)
) STRICT;

CREATE TABLE app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL CHECK (json_valid(value_json))) STRICT;
