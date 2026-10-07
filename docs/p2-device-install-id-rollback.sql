-- Rollback of 20261008100000_p2_device_install_id. Restores the pre-change Device table shape.
-- Device rows keep working: they simply stop being unique per installation.
DROP INDEX IF EXISTS "Device_one_active_per_installation";
ALTER TABLE "Device" DROP CONSTRAINT IF EXISTS "Device_installId_uuid";
ALTER TABLE "Device" DROP COLUMN IF EXISTS "installId";
