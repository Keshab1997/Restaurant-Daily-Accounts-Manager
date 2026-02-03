-- Expense Categories Table Setup
-- Run this script in Supabase SQL Editor

-- কাস্টম এক্সপেন্স ক্যাটাগরি সেভ করার জন্য
create table if not exists public.expense_categories (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade,
  name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- P&L মাসিক ডেটা সেভ করার জন্য
create table if not exists public.pl_monthly_data (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade,
  month_year text not null, -- e.g., "2026-01"
  stock_amount numeric default 0,
  card_commission numeric default 2,
  online_commission numeric default 25,
  rent_amount numeric default 0,
  gst_amount numeric default 0,
  custom_values jsonb default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  unique(user_id, month_year)
);

-- RLS Policies
alter table public.expense_categories enable row level security;
alter table public.pl_monthly_data enable row level security;

create policy "Users can manage own expense categories" on public.expense_categories for all using (auth.uid() = user_id);
create policy "Users can manage own pl data" on public.pl_monthly_data for all using (auth.uid() = user_id);
