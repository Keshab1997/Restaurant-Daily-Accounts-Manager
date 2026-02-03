const SUPABASE_URL = "https://eyiyyixotvneuvnbpfok.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5aXl5aXhvdHZuZXV2bmJwZm9rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwOTg4MzIsImV4cCI6MjA4NTY3NDgzMn0.NzKsPKRaHXoBg7GQk1lttY4G1WCKBs2gu6NEVr5J5fg";

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkAuth(required = true) {
    const { data: { session } } = await _supabase.auth.getSession();
    if (required && !session) window.location.href = 'index.html';
    if (!required && session) window.location.href = 'dashboard.html';
    return session;
}
