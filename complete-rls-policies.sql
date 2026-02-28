-- Complete RLS Policies for Restaurant Manager App
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- ============================================
-- 1. PROFILES TABLE
-- ============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can delete own profile" ON profiles;

CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can delete own profile" ON profiles FOR DELETE USING (auth.uid() = id);

-- ============================================
-- 2. SALES TABLE
-- ============================================
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own sales" ON sales;
DROP POLICY IF EXISTS "Users can insert own sales" ON sales;
DROP POLICY IF EXISTS "Users can update own sales" ON sales;
DROP POLICY IF EXISTS "Users can delete own sales" ON sales;

CREATE POLICY "Users can view own sales" ON sales FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own sales" ON sales FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own sales" ON sales FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own sales" ON sales FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- 3. EXPENSES TABLE
-- ============================================
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own expenses" ON expenses;
DROP POLICY IF EXISTS "Users can insert own expenses" ON expenses;
DROP POLICY IF EXISTS "Users can update own expenses" ON expenses;
DROP POLICY IF EXISTS "Users can delete own expenses" ON expenses;

CREATE POLICY "Users can view own expenses" ON expenses FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own expenses" ON expenses FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own expenses" ON expenses FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own expenses" ON expenses FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- 4. VENDORS TABLE
-- ============================================
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own vendors" ON vendors;
DROP POLICY IF EXISTS "Users can insert own vendors" ON vendors;
DROP POLICY IF EXISTS "Users can update own vendors" ON vendors;
DROP POLICY IF EXISTS "Users can delete own vendors" ON vendors;

CREATE POLICY "Users can view own vendors" ON vendors FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own vendors" ON vendors FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own vendors" ON vendors FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own vendors" ON vendors FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- 5. VENDOR_LEDGER TABLE
-- ============================================
ALTER TABLE vendor_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own vendor_ledger" ON vendor_ledger;
DROP POLICY IF EXISTS "Users can insert own vendor_ledger" ON vendor_ledger;
DROP POLICY IF EXISTS "Users can update own vendor_ledger" ON vendor_ledger;
DROP POLICY IF EXISTS "Users can delete own vendor_ledger" ON vendor_ledger;

CREATE POLICY "Users can view own vendor_ledger" ON vendor_ledger FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own vendor_ledger" ON vendor_ledger FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own vendor_ledger" ON vendor_ledger FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own vendor_ledger" ON vendor_ledger FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- 6. OWNER_LEDGER TABLE
-- ============================================
ALTER TABLE owner_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own owner_ledger" ON owner_ledger;
DROP POLICY IF EXISTS "Users can insert own owner_ledger" ON owner_ledger;
DROP POLICY IF EXISTS "Users can update own owner_ledger" ON owner_ledger;
DROP POLICY IF EXISTS "Users can delete own owner_ledger" ON owner_ledger;

CREATE POLICY "Users can view own owner_ledger" ON owner_ledger FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own owner_ledger" ON owner_ledger FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own owner_ledger" ON owner_ledger FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own owner_ledger" ON owner_ledger FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- 7. STAFF TABLE
-- ============================================
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own staff" ON staff;
DROP POLICY IF EXISTS "Users can insert own staff" ON staff;
DROP POLICY IF EXISTS "Users can update own staff" ON staff;
DROP POLICY IF EXISTS "Users can delete own staff" ON staff;

CREATE POLICY "Users can view own staff" ON staff FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own staff" ON staff FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own staff" ON staff FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own staff" ON staff FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- 8. SALARY_RECORDS TABLE
-- ============================================
ALTER TABLE salary_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own salary_records" ON salary_records;
DROP POLICY IF EXISTS "Users can insert own salary_records" ON salary_records;
DROP POLICY IF EXISTS "Users can update own salary_records" ON salary_records;
DROP POLICY IF EXISTS "Users can delete own salary_records" ON salary_records;

CREATE POLICY "Users can view own salary_records" ON salary_records FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own salary_records" ON salary_records FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own salary_records" ON salary_records FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own salary_records" ON salary_records FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- 9. DAILY_BALANCES TABLE
-- ============================================
ALTER TABLE daily_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own daily_balances" ON daily_balances;
DROP POLICY IF EXISTS "Users can insert own daily_balances" ON daily_balances;
DROP POLICY IF EXISTS "Users can update own daily_balances" ON daily_balances;
DROP POLICY IF EXISTS "Users can delete own daily_balances" ON daily_balances;

CREATE POLICY "Users can view own daily_balances" ON daily_balances FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own daily_balances" ON daily_balances FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own daily_balances" ON daily_balances FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own daily_balances" ON daily_balances FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- 10. CASH_TALLY TABLE
-- ============================================
ALTER TABLE cash_tally ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own cash_tally" ON cash_tally;
DROP POLICY IF EXISTS "Users can insert own cash_tally" ON cash_tally;
DROP POLICY IF EXISTS "Users can update own cash_tally" ON cash_tally;
DROP POLICY IF EXISTS "Users can delete own cash_tally" ON cash_tally;

CREATE POLICY "Users can view own cash_tally" ON cash_tally FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own cash_tally" ON cash_tally FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own cash_tally" ON cash_tally FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own cash_tally" ON cash_tally FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- 11. PL_MONTHLY_DATA TABLE
-- ============================================
ALTER TABLE pl_monthly_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own pl_monthly_data" ON pl_monthly_data;
DROP POLICY IF EXISTS "Users can insert own pl_monthly_data" ON pl_monthly_data;
DROP POLICY IF EXISTS "Users can update own pl_monthly_data" ON pl_monthly_data;
DROP POLICY IF EXISTS "Users can delete own pl_monthly_data" ON pl_monthly_data;

CREATE POLICY "Users can view own pl_monthly_data" ON pl_monthly_data FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own pl_monthly_data" ON pl_monthly_data FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own pl_monthly_data" ON pl_monthly_data FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own pl_monthly_data" ON pl_monthly_data FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- VERIFICATION QUERY
-- ============================================
-- Run this to verify all policies are created:
SELECT schemaname, tablename, policyname 
FROM pg_policies 
WHERE schemaname = 'public' 
ORDER BY tablename, policyname;
