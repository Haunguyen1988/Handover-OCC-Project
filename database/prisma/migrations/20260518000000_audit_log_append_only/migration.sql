-- Append-only enforcement for the AuditLog table.
--
-- Background
-- ----------
-- The AuditLog table is the system's regulatory audit trail. The
-- application code (backend/src/services/audit.service.ts) only ever
-- INSERTs into it, but until this migration there was no DB-level
-- enforcement of that contract — any process with table-level write
-- access could UPDATE or DELETE rows, defeating the audit trail.
--
-- This migration installs three trigger functions that raise an
-- exception on any UPDATE, DELETE, or TRUNCATE against AuditLog. Reads
-- and INSERTs are unaffected.
--
-- The error code 'AL001' is unique enough to grep for in logs and to
-- match in application-level error handling.
--
-- Emergency repair (bypass)
-- -------------------------
-- If a legitimate operational fix requires touching AuditLog rows
-- (e.g. removing PII accidentally written via newValue/oldValue), a
-- DBA with table-owner privileges can disable the triggers within a
-- single transaction:
--
--   BEGIN;
--   ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_no_update;
--   ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_no_delete;
--   ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_no_truncate;
--     -- ... perform the corrective DML, ideally followed by an
--     -- INSERT into AuditLog itself recording the corrective action ...
--   ALTER TABLE "AuditLog" ENABLE TRIGGER audit_log_no_update;
--   ALTER TABLE "AuditLog" ENABLE TRIGGER audit_log_no_delete;
--   ALTER TABLE "AuditLog" ENABLE TRIGGER audit_log_no_truncate;
--   COMMIT;
--
-- Disabling triggers requires owner privileges, which is the right
-- level of friction.

CREATE OR REPLACE FUNCTION audit_log_block_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog rows are append-only; UPDATE is not permitted (id=%)', OLD.id
    USING ERRCODE = 'AL001';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION audit_log_block_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog rows are append-only; DELETE is not permitted (id=%)', OLD.id
    USING ERRCODE = 'AL001';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION audit_log_block_truncate()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog table is append-only; TRUNCATE is not permitted'
    USING ERRCODE = 'AL001';
END;
$$ LANGUAGE plpgsql;

-- BEFORE triggers so the exception fires before any row state changes.
DROP TRIGGER IF EXISTS audit_log_no_update ON "AuditLog";
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_block_update();

DROP TRIGGER IF EXISTS audit_log_no_delete ON "AuditLog";
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON "AuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_block_delete();

DROP TRIGGER IF EXISTS audit_log_no_truncate ON "AuditLog";
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT
  EXECUTE FUNCTION audit_log_block_truncate();
