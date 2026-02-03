-- Salary Management Database Setup
-- Run this script in Supabase SQL Editor

-- স্টাফদের তথ্য রাখার টেবিল
create table if not exists public.staff (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade,
  name text not null,
  designation text,
  basic_salary numeric default 0,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- প্রতি মাসের স্যালারি রেকর্ড রাখার টেবিল
create table if not exists public.salary_records (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade,
  staff_id uuid references public.staff on delete cascade,
  month_year text not null, -- e.g., "2026-01"
  absent_days numeric default 0,
  salary_cut numeric default 0,
  net_salary numeric default 0,
  status text default 'UNPAID',
  updated_at timestamp with time zone default timezone('utc'::text, now()),
  unique(staff_id, month_year)
);

-- RLS Policies
alter table public.staff enable row level security;
alter table public.salary_records enable row level security;

create policy "Users can manage own staff" on public.staff for all using (auth.uid() = user_id);
create policy "Users can manage own salary records" on public.salary_records for all using (auth.uid() = user_id);
