const SUPABASE_URL = "https://eyiyyixotvneuvnbpfok.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5aXl5aXhvdHZuZXV2bmJwZm9rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwOTg4MzIsImV4cCI6MjA4NTY3NDgzMn0.NzKsPKRaHXoBg7GQk1lttY4G1WCKBs2gu6NEVr5J5fg";

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkAuth(required = true) {
    const { data: { session } } = await _supabase.auth.getSession();
    if (required && !session) window.location.href = 'index.html';
    if (!required && session) window.location.href = 'dashboard.html';
    return session;
}

// Hamburger Menu Toggle
function toggleMenu() {
    const sideNav = document.getElementById('sideNav');
    const overlay = document.getElementById('menuOverlay');
    if (sideNav && overlay) {
        sideNav.classList.toggle('active');
        overlay.classList.toggle('active');
    }
}

// Close menu when clicking overlay or nav link
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        const overlay = document.getElementById('menuOverlay');
        const navLinks = document.querySelectorAll('.nav-links a');
        
        if (overlay) {
            overlay.addEventListener('click', toggleMenu);
        }
        
        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                const sideNav = document.getElementById('sideNav');
                if (sideNav && sideNav.classList.contains('active')) {
                    toggleMenu();
                }
            });
        });
    });
}

// Service Worker Registration with Update Logic
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then(reg => {
            console.log('Service Worker Registered');
            
            // Check for updates
            reg.addEventListener('updatefound', () => {
                const newWorker = reg.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        showUpdateToast(reg);
                    }
                });
            });

            // If update is already waiting
            if (reg.waiting) {
                showUpdateToast(reg);
            }
        }).catch(err => console.log('Service Worker Error', err));
    });

    // Reload page when new service worker takes control
    let refreshing;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        window.location.reload();
        refreshing = true;
    });
}

// Show update notification
function showUpdateToast(reg) {
    const toast = document.createElement('div');
    toast.className = 'toast toast-info show';
    toast.style.pointerEvents = 'auto';
    
    toast.innerHTML = `
        <i class="ri-refresh-line"></i>
        <span>New version available!</span>
        <button id="updateAppBtn" class="toast-btn">Update Now</button>
    `;

    document.body.appendChild(toast);

    document.getElementById('updateAppBtn').addEventListener('click', () => {
        if (reg.waiting) {
            reg.waiting.postMessage('skipWaiting');
        }
    });
}

// Toast Notification Function
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <i class="ri-${type === 'success' ? 'checkbox-circle' : type === 'error' ? 'error-warning' : 'information'}-line"></i>
        <span>${message}</span>
    `;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 100);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
