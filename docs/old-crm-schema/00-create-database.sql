-- Run once on VPS Postgres as superuser (not via apply script).
-- Example:
--   ssh root@187.127.145.253
--   docker exec -it supabase-db psql -U postgres -c "CREATE DATABASE old_crm;"
--
-- Then apply migrations:
--   OLD_CRM_DATABASE_URL=postgresql://postgres:PASSWORD@api.wrl-fsm.cloud:5432/old_crm \
--     node scripts/apply-old-crm-schema.mjs

CREATE DATABASE old_crm;
