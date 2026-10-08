-- Lærere godkendt af en administrator. Administratorer står i secret TEACHER_EMAILS.
create table teachers (
  email text primary key check (email = lower(email)),
  added_by text not null,
  created_at timestamptz not null default now()
);
alter table teachers enable row level security;
