-- =====================================================
-- Supabase Database Fix for 400 Bad Request Error
-- =====================================================
-- এই SQL কোডটি Supabase SQL Editor-এ রান করুন
-- =====================================================

-- ১. Sales টেবিলের জন্য Unique Constraint যোগ করা
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_user_id_report_date_sale_type_key;

ALTER TABLE public.sales 
ADD CONSTRAINT sales_user_id_report_date_sale_type_key 
UNIQUE (user_id, report_date, sale_type);

-- ২. Daily Balances টেবিলের জন্য Unique Constraint যোগ করা
ALTER TABLE public.daily_balances DROP CONSTRAINT IF EXISTS daily_balances_user_id_report_date_key;

ALTER TABLE public.daily_balances 
ADD CONSTRAINT daily_balances_user_id_report_date_key 
UNIQUE (user_id, report_date);

-- ৩. সফলভাবে সম্পন্ন হলে এই মেসেজ দেখাবে
SELECT 'Unique constraints added successfully!' AS status;
