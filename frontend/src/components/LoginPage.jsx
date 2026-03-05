// ============================================
// Login Page — Login + Request Access
// ============================================

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';

export default function LoginPage() {
    const REMEMBER_EMAIL_KEY = 'sp_login_email';
    const { login, requestAccess } = useAuth();
    const [mode, setMode] = useState('login'); // 'login' | 'request'
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [requestPassword, setRequestPassword] = useState('');
    const [requestedEmail, setRequestedEmail] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [showLoginPassword, setShowLoginPassword] = useState(false);
    const [showRequestPassword, setShowRequestPassword] = useState(false);
    const [rememberEmail, setRememberEmail] = useState(true);

    useEffect(() => {
        const saved = localStorage.getItem(REMEMBER_EMAIL_KEY);
        if (saved) setEmail(saved);
    }, []);

    useEffect(() => {
        if (!rememberEmail) {
            localStorage.removeItem(REMEMBER_EMAIL_KEY);
            return;
        }
        const normalized = email.toLowerCase().trim();
        if (normalized) localStorage.setItem(REMEMBER_EMAIL_KEY, normalized);
    }, [email, rememberEmail]);

    const resetNotices = () => {
        setError('');
        setMessage('');
    };

    const canSubmitLogin = useMemo(
        () => !!email.trim() && !!password && !submitting,
        [email, password, submitting]
    );
    const canSubmitRequest = useMemo(
        () => !!email.trim() && requestPassword.length >= 8 && !submitting,
        [email, requestPassword, submitting]
    );

    const handleLogin = async (e) => {
        e.preventDefault();
        resetNotices();
        setSubmitting(true);
        try {
            await login(email, password);
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleRequest = async (e) => {
        e.preventDefault();
        resetNotices();
        setSubmitting(true);
        try {
            const result = await requestAccess(email, requestPassword);
            setRequestedEmail(email.toLowerCase().trim());
            setMessage(result.message);
            setEmail('');
            setRequestPassword('');
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="login-page">
            <aside className="login-showcase">
                <span className="login-showcase__eyebrow">SharePulse Analytics</span>
                <h2>SharePulse Analytics for shared link communities</h2>
                <p>
                    Track what your community shares, surface top domains, and understand engagement with one secure dashboard.
                </p>
                <div className="login-showcase__grid">
                    <div className="login-showcase__item">
                        <strong>Dedup + Hashing</strong>
                        <span>Fast unique-link indexing and duplicate control.</span>
                    </div>
                    <div className="login-showcase__item">
                        <strong>Vote Signals</strong>
                        <span>One vote per user, per link, with clean scoring.</span>
                    </div>
                    <div className="login-showcase__item">
                        <strong>Privacy-first</strong>
                        <span>No raw chat payload stored in analytics data.</span>
                    </div>
                </div>
            </aside>

            <div className="login-card">
                <div className="login-card__header">
                    <span className="login-card__logo">SP</span>
                    <h1>SharePulse Analytics</h1>
                    <p>Sign in or request workspace access</p>
                </div>

                <div className="login-card__tabs">
                    <button
                        className={`login-tab ${mode === 'login' ? 'login-tab--active' : ''}`}
                        onClick={() => { setMode('login'); resetNotices(); }}
                    >
                        Sign In
                    </button>
                    <button
                        className={`login-tab ${mode === 'request' ? 'login-tab--active' : ''}`}
                        onClick={() => { setMode('request'); resetNotices(); }}
                    >
                        Request Access
                    </button>
                </div>

                {mode === 'request' && message && !error ? (
                    <div className="request-success">
                        <h3>Request Received</h3>
                        <p>Your workspace access request has been submitted for review.</p>
                        <div className="request-success__meta">
                            <span>Email</span>
                            <strong>{requestedEmail || 'Submitted'}</strong>
                        </div>
                        <p className="request-success__hint">
                            You will use this same email and password after an admin approves your request.
                        </p>
                        <button
                            type="button"
                            className="login-submit login-submit--request"
                            onClick={() => {
                                setMessage('');
                                setError('');
                            }}
                        >
                            Submit Another Request
                        </button>
                    </div>
                ) : mode === 'login' ? (
                    <form onSubmit={handleLogin} className="login-form">
                        <div className="login-field">
                            <label htmlFor="login-email">Email</label>
                            <input
                                id="login-email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="your@email.com"
                                required
                                autoComplete="email"
                                autoFocus
                            />
                        </div>
                        <div className="login-field">
                            <label htmlFor="login-password">Password</label>
                            <div className="login-password-wrap">
                                <input
                                    id="login-password"
                                    type={showLoginPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Enter password"
                                    required
                                    autoComplete="current-password"
                                />
                                <button
                                    type="button"
                                    className="login-password-toggle"
                                    onClick={() => setShowLoginPassword((prev) => !prev)}
                                    aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                                >
                                    {showLoginPassword ? 'Hide' : 'Show'}
                                </button>
                            </div>
                        </div>
                        <div className="login-options-row">
                            <label className="login-checkbox">
                                <input
                                    type="checkbox"
                                    checked={rememberEmail}
                                    onChange={(e) => setRememberEmail(e.target.checked)}
                                />
                                <span>Remember email on this device</span>
                            </label>
                        </div>
                        <button type="submit" className="login-submit" disabled={!canSubmitLogin}>
                            {submitting ? 'Signing in...' : 'Sign In'}
                        </button>
                    </form>
                ) : (
                    <form onSubmit={handleRequest} className="login-form">
                        <div className="login-field">
                            <label htmlFor="request-email">Email</label>
                            <input
                                id="request-email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="your@email.com"
                                required
                                autoComplete="email"
                            />
                        </div>
                        <div className="login-field">
                            <label htmlFor="request-password">Password</label>
                            <div className="login-password-wrap">
                                <input
                                    id="request-password"
                                    type={showRequestPassword ? 'text' : 'password'}
                                    value={requestPassword}
                                    onChange={(e) => setRequestPassword(e.target.value)}
                                    placeholder="Choose a password"
                                    required
                                    minLength={8}
                                    autoComplete="new-password"
                                />
                                <button
                                    type="button"
                                    className="login-password-toggle"
                                    onClick={() => setShowRequestPassword((prev) => !prev)}
                                    aria-label={showRequestPassword ? 'Hide password' : 'Show password'}
                                >
                                    {showRequestPassword ? 'Hide' : 'Show'}
                                </button>
                            </div>
                        </div>
                        <p className="login-hint">
                            Create your own password. Admins can only view your email and request status.
                        </p>
                        <button type="submit" className="login-submit login-submit--request" disabled={!canSubmitRequest}>
                            {submitting ? 'Submitting...' : 'Request Access'}
                        </button>
                    </form>
                )}

                {error && <div className="login-alert login-alert--error">{error}</div>}
                {message && mode === 'login' && <div className="login-alert login-alert--success">{message}</div>}
            </div>
        </div>
    );
}
