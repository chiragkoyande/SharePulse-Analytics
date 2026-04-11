// ============================================
// Auth Context — Session + Workspace Management
// ============================================

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const USES_TUNNEL_API = /ngrok-free\.(app|dev)|\.(trycloudflare|cloudflare-tunnel)\.com/.test(API_BASE);

function backendFetch(url, options = {}) {
    const controller = new AbortController();
    const timeoutMs = Number(import.meta.env.VITE_API_TIMEOUT_MS || 15000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const doFetch = () => {
        if (!USES_TUNNEL_API) {
            return fetch(url, { ...options, signal: controller.signal });
        }
        const headers = new Headers(options.headers || {});
        headers.set('ngrok-skip-browser-warning', 'true');
        return fetch(url, { ...options, headers, signal: controller.signal });
    };
    return doFetch()
        .catch((err) => {
            const msg = String(err?.message || err);
            if (err?.name === 'AbortError') {
                throw new Error('Request timed out. Backend/tunnel may be offline.');
            }
            if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Load failed')) {
                throw new Error('Cannot reach backend API. Check tunnel URL and local backend.');
            }
            throw err;
        })
        .finally(() => clearTimeout(timer));
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);       // { email, role }
    const [token, setToken] = useState(null);      // access_token
    const [loading, setLoading] = useState(true);
    const [workspaces, setWorkspaces] = useState([]);
    const [activeWorkspaceId, setActiveWorkspaceIdState] = useState(null);

    // Restore session + active workspace from localStorage
    useEffect(() => {
        const saved = localStorage.getItem('auth_session');
        if (saved) {
            try {
                const session = JSON.parse(saved);
                setUser(session.user);
                setToken(session.token);
            } catch { /* corrupted — ignore */ }
        }
        const savedWs = localStorage.getItem('active_workspace_id');
        if (savedWs) setActiveWorkspaceIdState(savedWs);
        setLoading(false);
    }, []);

    // Fetch workspaces on auth
    const loadWorkspaces = useCallback(async (authToken) => {
        try {
            const res = await backendFetch(`${API_BASE}/workspaces`, {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            const json = await res.json();
            const wsList = json.data || [];
            setWorkspaces(wsList);

            // Super admins default to global view to avoid hiding recent data in other workspaces.
            if (user?.role === 'super_admin') {
                setActiveWorkspaceIdState(null);
                localStorage.removeItem('active_workspace_id');
            } else {
                const savedWs = localStorage.getItem('active_workspace_id');
                if (savedWs && wsList.find((w) => w.id === savedWs)) {
                    setActiveWorkspaceIdState(savedWs);
                } else if (wsList.length > 0) {
                    setActiveWorkspaceIdState(wsList[0].id);
                    localStorage.setItem('active_workspace_id', wsList[0].id);
                }
            }
        } catch (err) {
            console.warn('Could not load workspaces:', err.message);
        }
    }, [user?.role]);

    // Load workspaces when token is available
    useEffect(() => {
        if (token) loadWorkspaces(token);
    }, [token, loadWorkspaces]);

    const setActiveWorkspaceId = useCallback((id) => {
        setActiveWorkspaceIdState(id);
        if (id) localStorage.setItem('active_workspace_id', id);
        else localStorage.removeItem('active_workspace_id');
    }, []);

    const login = useCallback(async (email, password) => {
        const res = await backendFetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);

        const session = {
            user: json.user,
            token: json.session.access_token,
        };
        setUser(json.user);
        setToken(json.session.access_token);
        localStorage.setItem('auth_session', JSON.stringify(session));
        return json;
    }, []);

    const logout = useCallback(() => {
        setUser(null);
        setToken(null);
        setWorkspaces([]);
        setActiveWorkspaceIdState(null);
        localStorage.removeItem('auth_session');
        localStorage.removeItem('active_workspace_id');
    }, []);

    const fetchRequestWorkspaces = useCallback(async () => {
        const res = await backendFetch(`${API_BASE}/auth/request-workspaces`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Failed to load workspaces');
        return json.data || [];
    }, []);

    const requestAccess = useCallback(async (email, password) => {
        const res = await backendFetch(`${API_BASE}/auth/request-access`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        return json;
    }, []);

    const value = {
        user,
        token,
        loading,
        isAuthenticated: !!user && !!token,
        isAdmin:
            user?.role === 'admin' ||
            user?.role === 'super_admin' ||
            !!workspaces.find((w) => ['admin', 'owner', 'super_admin'].includes(w.my_role)),
        isSuperAdmin: user?.role === 'super_admin',
        workspaces,
        activeWorkspaceId,
        setActiveWorkspaceId,
        activeWorkspace: workspaces.find((w) => w.id === activeWorkspaceId) || null,
        refreshWorkspaces: () => token && loadWorkspaces(token),
        fetchRequestWorkspaces,
        login,
        logout,
        requestAccess,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be inside AuthProvider');
    return ctx;
}
