CREATE TABLE ledger_sync_state (
    id INTEGER PRIMARY KEY CHECK(id=1),
    revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
    owner_id TEXT,
    project_url TEXT,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    cloud_revision INTEGER NOT NULL DEFAULT 0 CHECK(cloud_revision>=0),
    base_snapshot TEXT NOT NULL DEFAULT '{"categories":[],"entries":[]}' CHECK(json_valid(base_snapshot)),
    upload_json TEXT CHECK(upload_json IS NULL OR json_valid(upload_json))
) STRICT;
INSERT INTO ledger_sync_state(id) VALUES (1);

CREATE TRIGGER ledger_category_sync_insert AFTER INSERT ON ledger_categories BEGIN
    UPDATE ledger_sync_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER ledger_category_sync_update AFTER UPDATE ON ledger_categories BEGIN
    UPDATE ledger_sync_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER ledger_category_sync_delete AFTER DELETE ON ledger_categories BEGIN
    UPDATE ledger_sync_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER ledger_entry_sync_insert AFTER INSERT ON ledger_entries BEGIN
    UPDATE ledger_sync_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER ledger_entry_sync_update AFTER UPDATE ON ledger_entries BEGIN
    UPDATE ledger_sync_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER ledger_entry_sync_delete AFTER DELETE ON ledger_entries BEGIN
    UPDATE ledger_sync_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER ledger_linked_income_sync_update AFTER UPDATE ON income_entries
WHEN EXISTS(SELECT 1 FROM ledger_entries WHERE tax_income_id=NEW.id) BEGIN
    UPDATE ledger_sync_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER ledger_linked_source_sync_update AFTER UPDATE ON income_sources
WHEN EXISTS(SELECT 1 FROM income_entries i JOIN ledger_entries l ON l.tax_income_id=i.id WHERE i.source_id=NEW.id) BEGIN
    UPDATE ledger_sync_state SET revision=revision+1 WHERE id=1;
END;
