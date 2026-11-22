-- The audit row no longer carries a command/event discriminator.
ALTER TABLE "event_audit" DROP COLUMN "kind";
