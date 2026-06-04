-- ============================================================
-- Mind Race — Alter buzz_time_ms column type to BIGINT
-- Fixes "integer out of range" error when claiming the buzzer
-- ============================================================

ALTER TABLE public.match_rounds ALTER COLUMN buzz_time_ms TYPE BIGINT;
