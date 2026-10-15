-- Employer labels identify sources within one tax year in the basic salary tracker.
CREATE UNIQUE INDEX source_label_per_year ON income_sources(tax_year,label);
