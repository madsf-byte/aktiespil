# Aktiespillet

Aktiespil for skoleklasser: eleverne handler med fiktive penge til rigtige (ca. 15 min. forsinkede) kurser.

- `src/` – webappen (Preact + Vite), udgives på GitHub Pages.
- `supabase/functions/_shared/` – regler, handelsmotor og API (deles af server og browser).
- `supabase/functions/api/` – Edge Function i Supabase.
- `supabase/migrations/` – databasen.

## Udvikling

```
npm install
npm test
npm run dev:demo   # hele appen i browseren med opdigtede kurser – ingen Supabase nødvendig
```

## Opsætning af Supabase

1. `npx supabase login` og `npx supabase link --project-ref <ref>`
2. `npx supabase db push`
3. `npx supabase secrets set TOKEN_SECRET=… CRON_SECRET=… TEACHER_EMAILS=lærer@skole.dk`
4. `npx supabase functions deploy api --use-api`
5. Planlæggeren (migration `…_cron.sql`) læser `cron_secret` fra Vault: `select vault.create_secret('<CRON_SECRET>', 'cron_secret')`.
6. Auth → Providers → Google (klient-id og -hemmelighed fra Google Cloud). Auth → URL Configuration: tilføj appens adresse.
