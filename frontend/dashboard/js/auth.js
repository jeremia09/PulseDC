/* ============================================================
   auth.js — shared login-gate + user info / logout for every
   dashboard page. Loaded before main.js. Exposes window.CurrentUser
   once checkAuth() resolves, and window.requireAuth() for main.js's
   boot() to call before it does anything else.
   ============================================================ */

// API base is resolved centrally via PulseDC.API (core/utils.js, loaded first)
const AUTH_API_BASE = window.PulseDC.API.getBaseUrl();

window.CurrentUser = null;

/**
 * Confirms there's a live session before the page does any work.
 * Redirects to login.html if not authenticated. Call this first thing
 * inside boot() — nothing else should run until it resolves.
 */
async function requireAuth() {
    try {
        const res = await fetch(`${AUTH_API_BASE}/api/me`, { credentials: 'include' });
        if (!res.ok) {
            window.location.href = 'login.html';
            return null;
        }
        const user = await res.json();
        window.CurrentUser = user;
        renderUserInfo(user);
        return user;
    } catch (e) {
        // Backend unreachable — send them to login where the error is clearer
        // than a half-loaded, data-less dashboard.
        window.location.href = 'login.html';
        return null;
    }
}

function renderUserInfo(user) {
    window.PulseDC = window.PulseDC || {};
    window.PulseDC.currentUser = user;

    const label = document.getElementById('userInfoLabel');
    if (label) {
        const who = user.display_name || user.username;
        const context = user.role === 'super_admin' ? 'Super Admin' : (user.role === 'admin' ? 'Admin' : (user.company_name || 'Client'));
        label.textContent = `${who} · ${context}`;
    }

    if (window.PulseDC?.updateChatUserContext) {
        window.PulseDC.updateChatUserContext(user);
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            // Clear all user session chat storage on logout to prevent cross-account chat leaks
            try {
                Object.keys(sessionStorage).forEach(key => {
                    if (key.startsWith('pulse_dc_chatbot_history')) {
                        sessionStorage.removeItem(key);
                    }
                });
            } catch (e) { }
            await fetch(`${AUTH_API_BASE}/api/logout`, { method: 'POST', credentials: 'include' });
            window.location.href = 'login.html';
        });
    }
}