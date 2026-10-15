-- Add the one-off "other" income kind. SQLite cannot alter a CHECK constraint,
-- so the table is rebuilt with the same shape plus the widened kind list.
CREATE TABLE income_entries_new (
    id TEXT PRIMARY KEY,
    tax_year INTEGER NOT NULL REFERENCES tax_years(year) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    kind TEXT NOT NULL CHECK (kind IN ('salary','bonus','other')),
    basis TEXT NOT NULL CHECK (basis IN ('actual','forecast')),
    gross_satang INTEGER NOT NULL CHECK (gross_satang >= 0),
    withholding_satang INTEGER CHECK (withholding_satang >= 0),
    note TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (source_id,tax_year) REFERENCES income_sources(id,tax_year)
) STRICT;
INSERT INTO income_entries_new SELECT id,tax_year,source_id,month,kind,basis,gross_satang,withholding_satang,note FROM income_entries;
DROP TABLE income_entries;
ALTER TABLE income_entries_new RENAME TO income_entries;
CREATE UNIQUE INDEX one_salary_per_source_month ON income_entries(source_id,month) WHERE kind = 'salary';
CREATE INDEX income_by_year ON income_entries(tax_year,month);
