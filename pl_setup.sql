-- Expense Categories Table Setup
-- Run this script in Supabase SQL Editor

-- কাস্টম এক্সপেন্স ক্যাটাগরি সেভ করার জন্য
create table if not exists public.expense_categories (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade,
  name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- RLS Policy
alter table public.expense_categories enable row level security;

create policy "Users can manage own expense categories" on public.expense_categories for all using (auth.uid() = user_id);
