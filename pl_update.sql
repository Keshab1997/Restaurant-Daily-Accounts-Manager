-- Add manual edit columns to pl_monthly_data table
-- Run this in Supabase SQL Editor

alter table public.pl_monthly_data 
add column if not exists cash_sale_manual numeric default 0,
add column if not exists card_sale_manual numeric default 0,
add column if not exists online_sale_manual numeric default 0,
add column if not exists cash_exp_manual numeric default 0,
add column if not exists salary_manual numeric default 0;
