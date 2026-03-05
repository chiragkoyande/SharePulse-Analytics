import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fetchResources, searchResources, fetchStats, voteResource, exportCsv, fetchSavedLinks, saveResource } from './api';
import { useAuth } from './components/AuthContext';
import LoginPage from './components/LoginPage';
import AdminPanel from './components/AdminPanel';
import StatsCard from './components/StatsCard';
import SearchBar from './components/SearchBar';
import ResourceTable from './components/ResourceTable';

export default function App() {
    const DEFAULT_PAGE_SIZE = 50;
    const { isAuthenticated, isAdmin, user, token, logout, loading: authLoading } = useAuth();
    const [resources, setResources] = useState([]);
    const [stats, setStats] = useState({ total: 0, totalShares: 0, totalVotes: 0, today: 0 });
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedDomain, setSelectedDomain] = useState('');
    const [sortMode, setSortMode] = useState('newest');
    const [showAdmin, setShowAdmin] = useState(false);
    const [savedHashes, setSavedHashes] = useState(new Set());
    const [savedOnly, setSavedOnly] = useState(false);
    const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
    const [currentPage, setCurrentPage] = useState(1);
    const [infiniteScroll, setInfiniteScroll] = useState(false);
    const [visibleCount, setVisibleCount] = useState(DEFAULT_PAGE_SIZE);
    const searchTimeout = useRef(null);
    const dataShellRef = useRef(null);
    const loadMoreSentinelRef = useRef(null);

    // ── Force Dark Theme ─────────────────────
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    }, []);

    // ── Load Data ────────────────────────────
    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [resourceData, statsData] = await Promise.all([
                fetchResources(sortMode),
                fetchStats(),
            ]);
            let savedData = [];
            try {
                savedData = await fetchSavedLinks(token);
            } catch (savedErr) {
                console.warn('Saved links unavailable, continuing without saved state:', savedErr.message);
            }

            const savedSet = new Set(savedData || []);
            setSavedHashes(savedSet);
            setResources((resourceData || []).map((r) => ({
                ...r,
                is_saved: savedSet.has(r.url_hash),
            })));
            setStats(statsData);
        } catch (err) {
            console.error('Failed to load:', err.message);
        } finally {
            setLoading(false);
        }
    }, [sortMode, token]);

    useEffect(() => {
        if (isAuthenticated) loadData();
    }, [loadData, isAuthenticated]);

    // ── Debounced Search ─────────────────────
    const handleSearch = useCallback((query) => {
        setSearchQuery(query);
        if (searchTimeout.current) clearTimeout(searchTimeout.current);

        searchTimeout.current = setTimeout(async () => {
            setLoading(true);
            try {
                const data = query.trim()
                    ? await searchResources(query)
                    : await fetchResources(sortMode);
                setResources((data || []).map((r) => ({
                    ...r,
                    is_saved: savedHashes.has(r.url_hash),
                })));
            } catch (err) {
                console.error('Search error:', err.message);
            } finally {
                setLoading(false);
            }
        }, 400);
    }, [sortMode, savedHashes]);

    // ── Sort Change ──────────────────────────
    const handleSortChange = useCallback((e) => {
        setSortMode(e.target.value);
    }, []);

    // ── Vote Handler ─────────────────────────
    const handleVote = useCallback(async (urlHash, vote) => {
        try {
            const result = await voteResource(urlHash, vote, token);
            setResources((prev) =>
                prev.map((r) => {
                    if (r.url_hash !== urlHash) return r;
                    return {
                        ...r,
                        like_count: result.like_count ?? r.like_count ?? 0,
                        dislike_count: result.dislike_count ?? r.dislike_count ?? 0,
                    };
                })
            );
        } catch (err) {
            console.error('Vote error:', err.message);
        }
    }, [token]);

    // ── Save Handler ───────────────────────────
    const handleSave = useCallback(async (urlHash, save) => {
        try {
            await saveResource(urlHash, save, token);
            setSavedHashes((prev) => {
                const next = new Set(prev);
                if (save) next.add(urlHash);
                else next.delete(urlHash);
                return next;
            });
            setResources((prev) =>
                prev.map((r) => (r.url_hash === urlHash ? { ...r, is_saved: save } : r))
            );
        } catch (err) {
            console.error('Save link error:', err.message);
        }
    }, [token]);

    // ── CSV Export ────────────────────────────
    const handleExport = useCallback(async () => {
        try {
            await exportCsv();
        } catch (err) {
            console.error('Export error:', err.message);
        }
    }, []);

    // ── Popular Links (Top 5) ────────────────
    const popularLinks = useMemo(() => {
        return [...resources]
            .sort((a, b) => (b.like_count || 0) - (a.like_count || 0))
            .slice(0, 5)
            .filter((r) => (r.like_count || 0) > 0);
    }, [resources]);

    // ── Unique Domains ───────────────────────
    const topDomains = useMemo(() => {
        const counts = {};
        resources.forEach((r) => {
            const domain = r.domain || 'unknown';
            counts[domain] = (counts[domain] || 0) + 1;
        });
        return Object.entries(counts)
            .map(([domain, count]) => ({ domain, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
    }, [resources]);

    const displayedResources = useMemo(() => {
        return resources.filter((r) => {
            const matchesDomain = !selectedDomain || (r.domain || 'unknown') === selectedDomain;
            const matchesSaved = !savedOnly || !!r.is_saved;
            return matchesDomain && matchesSaved;
        });
    }, [resources, selectedDomain, savedOnly]);

    const totalPages = useMemo(
        () => Math.max(1, Math.ceil(displayedResources.length / pageSize)),
        [displayedResources.length, pageSize]
    );

    const visibleResources = useMemo(() => {
        if (infiniteScroll) {
            return displayedResources.slice(0, visibleCount);
        }
        const start = (currentPage - 1) * pageSize;
        const pageItems = displayedResources.slice(start, start + pageSize);
        if (pageItems.length > 0 || displayedResources.length === 0) return pageItems;
        // Safety fallback when page index briefly exceeds data length after filter/search changes.
        return displayedResources.slice(0, pageSize);
    }, [displayedResources, infiniteScroll, visibleCount, currentPage, pageSize]);

    const hasMoreInfinite = infiniteScroll && visibleCount < displayedResources.length;

    const handleTopDomainClick = useCallback((domain) => {
        setSelectedDomain((prev) => (prev === domain ? '' : domain));
        setTimeout(() => {
            dataShellRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 0);
    }, []);

    useEffect(() => {
        setCurrentPage(1);
        setVisibleCount(pageSize);
    }, [searchQuery, selectedDomain, savedOnly, sortMode, pageSize, infiniteScroll]);

    useEffect(() => {
        if (!infiniteScroll || loading || !hasMoreInfinite) return;
        const node = loadMoreSentinelRef.current;
        if (!node) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting) {
                    setVisibleCount((prev) => Math.min(prev + pageSize, displayedResources.length));
                }
            },
            { root: null, rootMargin: '180px', threshold: 0.1 }
        );

        observer.observe(node);
        return () => observer.disconnect();
    }, [infiniteScroll, loading, hasMoreInfinite, pageSize, displayedResources.length]);

    useEffect(() => {
        if (infiniteScroll) return;
        setCurrentPage((prev) => Math.min(prev, totalPages));
    }, [totalPages, infiniteScroll]);

    // ── Auth Loading ─────────────────────────
    if (authLoading) {
        return (
            <div className="app">
                <div className="login-page">
                    <div className="resource-table__loading">
                        <div className="spinner" />
                        <p>Loading...</p>
                    </div>
                </div>
            </div>
        );
    }

    // ── Not Authenticated ────────────────────
    if (!isAuthenticated) {
        return (
            <div className="app">
                <LoginPage />
            </div>
        );
    }

    // ── Authenticated Dashboard ──────────────
    return (
        <div className="app">
            <header className="header">
                <div className="header__inner">
                    <div className="header__brand">
                        <div className="header__brand-copy">
                            <span className="header__eyebrow">SharePulse Analytics Console</span>
                            <h1 className="header__title">SharePulse Analytics</h1>
                        </div>
                        <div className="header__logo" aria-hidden="true">
                            <span className="header__logo-corner"></span>
                            <span className="header__logo-line header__logo-line--1"></span>
                            <span className="header__logo-line header__logo-line--2"></span>
                            <span className="header__logo-line header__logo-line--3"></span>
                        </div>
                    </div>
                    <div className="header__actions">
                        <div className="header__action-group">
                            {isAdmin && (
                                <button className="btn btn--admin" onClick={() => setShowAdmin(true)} title="Admin Panel">
                                    Admin
                                </button>
                            )}
                            <button className="btn btn--export" onClick={handleExport} title="Export CSV">
                                Export CSV
                            </button>
                            <button className="btn btn--refresh" onClick={loadData} title="Refresh">Refresh</button>
                        </div>
                        <div className="user-badge">
                            <span className="user-badge__email">{user?.email}</span>
                            <button className="btn btn--logout" onClick={logout} title="Logout">
                                Sign out
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <main className="main">
                <section className="dashboard-hero">
                    <div className="dashboard-hero__content">
                        <span className="dashboard-hero__eyebrow">Workspace Overview</span>
                        <h2>See what your community shares and what drives engagemen</h2>
                        <p>
                            Track what your community shares, rank valuable domains, and measure engagement signals in one place.
                        </p>
                    </div>
                    <div className="dashboard-hero__meta">
                        <div className="dashboard-pill">
                            <span>Workspace</span>
                            <strong>{user?.email || 'Active'}</strong>
                        </div>
                        <div className="dashboard-pill">
                            <span>Resources Indexed</span>
                            <strong>{stats.total}</strong>
                        </div>
                        <div className="dashboard-pill">
                            <span>Engagement Votes</span>
                            <strong>{stats.totalVotes}</strong>
                        </div>
                    </div>
                </section>

                <section className="stats-row">
                    <StatsCard icon="RS" value={stats.total} label="Total Resources" color="#0ea5e9" />
                    <StatsCard icon="VT" value={stats.totalVotes} label="Total Votes" color="#f97316" />
                </section>

                <div className="insights-grid">
                    {topDomains.length > 0 && (
                        <section className="top-domains">
                            <h3 className="top-domains__title">Top Domains</h3>
                            <div className="top-domains__list">
                                {topDomains.map((d, i) => (
                                    <button
                                        key={d.domain}
                                        type="button"
                                        className={`top-domains__item ${selectedDomain === d.domain ? 'top-domains__item--active' : ''}`}
                                        onClick={() => handleTopDomainClick(d.domain)}
                                        title={`Show ${d.domain} links`}
                                    >
                                        <span className="top-domains__rank">#{i + 1}</span>
                                        <span className="top-domains__name">{d.domain}</span>
                                        <span className="top-domains__count">{d.count}</span>
                                    </button>
                                ))}
                            </div>
                        </section>
                    )}

                    {popularLinks.length > 0 && (
                        <section className="popular-links">
                            <h3 className="popular-links__title">Popular Links</h3>
                            <div className="popular-links__list">
                                {popularLinks.map((r, i) => (
                                    <div key={r.id} className="popular-links__item">
                                        <span className="popular-links__rank">#{i + 1}</span>
                                        <div className="popular-links__info">
                                            <a href={r.url} target="_blank" rel="noopener noreferrer">
                                                {r.title || 'New Resource'}
                                            </a>
                                            <span className="popular-links__domain">{r.domain}</span>
                                        </div>
                                        <span className="popular-links__likes">Score {r.like_count}</span>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                </div>

                <div className="controls-row">
                    <SearchBar searchQuery={searchQuery} onSearchChange={handleSearch} />
                    <div className="sort-dropdown">
                        <label htmlFor="sort-select">Sort by:</label>
                        <select id="sort-select" value={sortMode} onChange={handleSortChange}>
                            <option value="newest">Newest First</option>
                            <option value="popular">Most Popular</option>
                        </select>
                    </div>
                    <button
                        type="button"
                        className={`btn btn--saved-only ${savedOnly ? 'btn--saved-only-active' : ''}`}
                        onClick={() => setSavedOnly((prev) => !prev)}
                        title={savedOnly ? 'Show all links' : 'Show only saved links'}
                    >
                        {savedOnly ? 'Saved Only: On' : 'Saved Only'}
                    </button>
                    <div className="pagination-controls">
                        <label htmlFor="page-size-select">Per page:</label>
                        <select
                            id="page-size-select"
                            value={pageSize}
                            onChange={(e) => setPageSize(Number(e.target.value))}
                        >
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                        </select>
                        <button
                            type="button"
                            className={`btn btn--infinite ${infiniteScroll ? 'btn--infinite-active' : ''}`}
                            onClick={() => setInfiniteScroll((prev) => !prev)}
                        >
                            {infiniteScroll ? 'Infinite: On' : 'Infinite Scroll'}
                        </button>
                    </div>
                </div>

                {(selectedDomain || savedOnly) && (
                    <div className="active-filter">
                        <span>
                            {selectedDomain && <>Domain filter: <strong>{selectedDomain}</strong></>}
                            {selectedDomain && savedOnly && <> • </>}
                            {savedOnly && <>View: <strong>Saved links only</strong></>}
                        </span>
                        <button
                            type="button"
                            className="btn btn--refresh"
                            onClick={() => {
                                setSelectedDomain('');
                                setSavedOnly(false);
                            }}
                        >
                            Clear Filter
                        </button>
                    </div>
                )}

                {!loading && (
                    <p className="results-info">
                        Showing <strong>{visibleResources.length}</strong> of <strong>{displayedResources.length}</strong> resources
                        {searchQuery && <span> matching &ldquo;{searchQuery}&rdquo;</span>}
                        {selectedDomain && <span> from &ldquo;{selectedDomain}&rdquo;</span>}
                        {savedOnly && <span> in your saved list</span>}
                    </p>
                )}

                <section className="data-shell" ref={dataShellRef}>
                    <div className="data-shell__head">
                        <h3>Resource Feed</h3>
                        <span>Live indexed links from your monitored community</span>
                    </div>
                    <ResourceTable
                        resources={visibleResources}
                        loading={loading}
                        onVote={handleVote}
                        onSave={handleSave}
                    />
                </section>

                {!loading && displayedResources.length > 0 && (
                    <div className="pager-bar">
                        {infiniteScroll ? (
                            <>
                                <span className="pager-bar__text">
                                    Loaded {visibleResources.length} of {displayedResources.length}
                                </span>
                                {hasMoreInfinite ? (
                                    <button
                                        type="button"
                                        className="btn btn--load-more"
                                        onClick={() =>
                                            setVisibleCount((prev) => Math.min(prev + pageSize, displayedResources.length))
                                        }
                                    >
                                        Load More
                                    </button>
                                ) : (
                                    <span className="pager-bar__done">All links loaded</span>
                                )}
                            </>
                        ) : (
                            <>
                                <button
                                    type="button"
                                    className="btn btn--pager"
                                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                                    disabled={currentPage === 1}
                                >
                                    Prev
                                </button>
                                <span className="pager-bar__text">
                                    Page {currentPage} of {totalPages}
                                </span>
                                <button
                                    type="button"
                                    className="btn btn--pager"
                                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                                    disabled={currentPage === totalPages}
                                >
                                    Next
                                </button>
                            </>
                        )}
                    </div>
                )}

                {infiniteScroll && hasMoreInfinite && <div className="load-more-sentinel" ref={loadMoreSentinelRef} />}
            </main>

            <footer className="footer">
                <p>SharePulse Analytics &middot; Made by Chirag Koyande</p>
            </footer>

            {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
        </div>
    );
}
