/**
 * Hamburger Menu Logic
 * Handles opening and closing of the sidebar
 */

function toggleSidebar() {
    const sidebar = document.getElementById('sidebarMenu');
    const overlay = document.getElementById('menuOverlay');
    
    if (sidebar && overlay) {
        sidebar.classList.toggle('active');
        overlay.classList.toggle('active');
    }
}

// Close sidebar when pressing 'Escape' key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const sidebar = document.getElementById('sidebarMenu');
        if (sidebar && sidebar.classList.contains('active')) {
            toggleSidebar();
        }
    }
});

// Highlight active link based on current URL
document.addEventListener('DOMContentLoaded', () => {
    const currentPath = window.location.pathname.split('/').pop();
    const navLinks = document.querySelectorAll('.sidebar-nav-links a');
    
    navLinks.forEach(link => {
        if (link.getAttribute('href') === currentPath) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
});
