-- Kør én gang i Supabase → SQL Editor, efter funktionen "api" er udgivet.
-- Erstat <PROJEKT-REF> og <CRON_SECRET> med dine værdier.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'aktiespil-planlaegger',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJEKT-REF>.supabase.co/functions/v1/api',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
