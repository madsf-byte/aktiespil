-- Planlægger: kalder funktionen "api" hvert 5. minut. Hemmeligheden ligger i Vault (navn: cron_secret).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'aktiespil-planlaegger',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://caehqnmemkbuyiujxeei.supabase.co/functions/v1/api',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
