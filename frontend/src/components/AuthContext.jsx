// ============================================
// Auth Context — Session Management
// ============================================

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);       // { email, role }
    const [token, setToken] = useState(null);      // access_token
    const [loading, setLoading] = useState(true);

    // Restore session from localStorage
    useEffect(() => {
        const saved = localStorage.getItem('auth_session');
        if (saved) {
            try {
                const session = JSON.parse(saved);
                setUser(session.user);
                setToken(session.token);
            } catch { /* corrupted — ignore */ }
        }
        setLoading(false);
    }, []);

    const login = useCallback(async (email, password) => {
        const res = await fetch(`${API_BASE}/auth/login`, {
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
        localStorage.removeItem('auth_session');
    }, []);

    const requestAccess = useCallback(async (email, password) => {
        const res = await fetch(`${API_BASE}/auth/request-access`, {
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
        isAdmin: user?.role === 'admin',
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
