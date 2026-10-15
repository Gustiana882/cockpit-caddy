/*
 * Cockpit Caddy Reverse Proxy Plugin
 * Standard PatternFly 6 Component Architecture
 * LGPL-2.1-or-later
 */

import React, { useEffect, useState, useMemo } from 'react';
import cockpit from 'cockpit';

// PatternFly 6 Core Components
import { Page, PageSection } from '@patternfly/react-core/dist/esm/components/Page/index.js';
import { Card, CardBody, CardTitle, CardHeader } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Button } from '@patternfly/react-core/dist/esm/components/Button/index.js';
import { Label } from '@patternfly/react-core/dist/esm/components/Label/index.js';
import { Badge } from '@patternfly/react-core/dist/esm/components/Badge/index.js';
import { Alert, AlertGroup } from '@patternfly/react-core/dist/esm/components/Alert/index.js';
import { Tabs, Tab, TabTitleText } from '@patternfly/react-core/dist/esm/components/Tabs/index.js';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@patternfly/react-core/dist/esm/components/Modal/index.js';
import { Form, FormGroup, ActionGroup } from '@patternfly/react-core/dist/esm/components/Form/index.js';
import { TextInput } from '@patternfly/react-core/dist/esm/components/TextInput/index.js';
import { TextArea } from '@patternfly/react-core/dist/esm/components/TextArea/index.js';
import { Checkbox } from '@patternfly/react-core/dist/esm/components/Checkbox/index.js';
import { EmptyState, EmptyStateBody, EmptyStateActions } from '@patternfly/react-core/dist/esm/components/EmptyState/index.js';
import { Toolbar, ToolbarContent, ToolbarItem } from '@patternfly/react-core/dist/esm/components/Toolbar/index.js';
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner/index.js';
import { CodeBlock, CodeBlockCode } from '@patternfly/react-core/dist/esm/components/CodeBlock/index.js';

// PatternFly Icons
import SyncAltIcon from '@patternfly/react-icons/dist/esm/icons/sync-alt-icon.js';
import PlusCircleIcon from '@patternfly/react-icons/dist/esm/icons/plus-circle-icon.js';
import RedoIcon from '@patternfly/react-icons/dist/esm/icons/redo-icon.js';
import TrashIcon from '@patternfly/react-icons/dist/esm/icons/trash-icon.js';
import EditIcon from '@patternfly/react-icons/dist/esm/icons/edit-icon.js';
import DownloadIcon from '@patternfly/react-icons/dist/esm/icons/download-icon.js';
import CheckCircleIcon from '@patternfly/react-icons/dist/esm/icons/check-circle-icon.js';
import ExclamationCircleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon.js';
import ServerIcon from '@patternfly/react-icons/dist/esm/icons/server-icon.js';

const _ = cockpit.gettext;

interface CaddyRoute {
    id: string;
    hasRealId: boolean;
    serverKey: string;
    routeIndex: number;
    hosts: string[];
    upstreams: string[];
    rawRoute: any;
    isHttps: boolean;
    hasHeaders: boolean;
}

interface NotificationAlert {
    id: number;
    title: string;
    variant: 'success' | 'danger' | 'warning' | 'info';
    message?: string | undefined;
}

const CADDY_API_BASE = 'http://127.0.0.1:2019';

async function caddyRequest(path: string, method: string = 'GET', data: any = null): Promise<any> {
    const url = `${CADDY_API_BASE}${path}`;
    const isCockpit = typeof cockpit !== 'undefined' && typeof cockpit.spawn === 'function';

    if (isCockpit) {
        return new Promise((resolve, reject) => {
            const args = ['curl', '-s', '-w', '\n%{http_code}', '-X', method];
            args.push('-H', 'Content-Type: application/json');

            if (data !== null) {
                args.push('-d', typeof data === 'string' ? data : JSON.stringify(data));
            }
            args.push(url);

            cockpit.spawn(args, { superuser: 'try' })
                .then((output: string) => {
                    const lines = output.trim().split('\n');
                    const statusCode = parseInt(lines.pop() || '0', 10);
                    const responseBody = lines.join('\n');

                    if (statusCode >= 200 && statusCode < 300) {
                        try {
                            resolve(responseBody ? JSON.parse(responseBody) : {});
                        } catch {
                            resolve(responseBody);
                        }
                    } else {
                        reject(new Error(`HTTP ${statusCode}: ${responseBody || 'Permintaan gagal'}`));
                    }
                })
                .catch((err: any) => reject(err));
        });
    } else {
        const options: RequestInit = {
            method,
            headers: { 'Content-Type': 'application/json' }
        };
        if (data !== null) {
            options.body = typeof data === 'string' ? data : JSON.stringify(data);
        }
        const res = await fetch(url, options);
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`HTTP ${res.status}: ${txt}`);
        }
        const text = await res.text();
        return text ? JSON.parse(text) : {};
    }
}

export const Application = () => {
    // State
    const [connected, setConnected] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(true);
    const [routes, setRoutes] = useState<CaddyRoute[]>([]);
    const [rawConfig, setRawConfig] = useState<any>({});
    const [serverName, setServerName] = useState<string>('srv0');
    const [activeTab, setActiveTab] = useState<number | string>(0);
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [alerts, setAlerts] = useState<NotificationAlert[]>([]);

    // Modal state
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
    const [formDomains, setFormDomains] = useState<string>('');
    const [formUpstreams, setFormUpstreams] = useState<string>('');
    const [formId, setFormId] = useState<string>('');
    const [formHeaders, setFormHeaders] = useState<boolean>(true);
    const [formSubmitting, setFormSubmitting] = useState<boolean>(false);

    // Raw JSON text state
    const [rawEditorText, setRawEditorText] = useState<string>('');
    const [savingRaw, setSavingRaw] = useState<boolean>(false);

    const addAlert = (title: string, variant: 'success' | 'danger' | 'warning' | 'info' = 'info', message?: string) => {
        const id = Date.now();
        setAlerts(prev => [...prev, { id, title, variant, message }]);
        setTimeout(() => {
            setAlerts(prev => prev.filter(a => a.id !== id));
        }, 4000);
    };

    // Load Caddy Config
    const loadConfig = async () => {
        setLoading(true);
        try {
            const config = await caddyRequest('/config/');
            setRawConfig(config || {});
            setRawEditorText(JSON.stringify(config || {}, null, 2));
            setConnected(true);

            // Parse routes
            const parsedRoutes: CaddyRoute[] = [];
            let srvKeyName = 'srv0';

            if (config && config.apps && config.apps.http && config.apps.http.servers) {
                const servers = config.apps.http.servers;
                const serverKeys = Object.keys(servers);
                if (serverKeys.length > 0) {
                    srvKeyName = serverKeys[0];
                    setServerName(srvKeyName);
                }

                serverKeys.forEach(sKey => {
                    const srv = servers[sKey];
                    if (srv && Array.isArray(srv.routes)) {
                        srv.routes.forEach((route: any, index: number) => {
                            const handleList = route.handle || [];
                            const proxyHandler = handleList.find((h: any) => h.handler === 'reverse_proxy');

                            if (proxyHandler) {
                                const hosts: string[] = [];
                                if (route.match && Array.isArray(route.match)) {
                                    route.match.forEach((m: any) => {
                                        if (m.host && Array.isArray(m.host)) {
                                            hosts.push(...m.host);
                                        }
                                    });
                                }

                                const upstreams: string[] = [];
                                if (proxyHandler.upstreams && Array.isArray(proxyHandler.upstreams)) {
                                    upstreams.push(...proxyHandler.upstreams.map((u: any) => u.dial));
                                }

                                const hasHeaders = !!(proxyHandler.headers && proxyHandler.headers.request);
                                const isHttps = hosts.some(h => !h.includes(':') && h !== '*' && !h.endsWith('.localhost'));

                                parsedRoutes.push({
                                    id: route['@id'] || `srv_${sKey}_route_${index}`,
                                    hasRealId: !!route['@id'],
                                    serverKey: sKey,
                                    routeIndex: index,
                                    hosts: hosts.length > 0 ? hosts : ['* (All Hosts)'],
                                    upstreams,
                                    rawRoute: route,
                                    isHttps,
                                    hasHeaders
                                });
                            }
                        });
                    }
                });
            }

            setRoutes(parsedRoutes);
        } catch (err: any) {
            console.error('Failed to load Caddy config:', err);
            setConnected(false);
            addAlert(_("Gagal terhubung ke Caddy API"), "danger", err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadConfig();
    }, []);

    // Filtered routes
    const filteredRoutes = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return routes;
        return routes.filter(r =>
            r.hosts.some(h => h.toLowerCase().includes(query)) ||
            r.upstreams.some(u => u.toLowerCase().includes(query)) ||
            r.id.toLowerCase().includes(query)
        );
    }, [routes, searchQuery]);

    // Statistics
    const stats = useMemo(() => {
        const totalRoutes = routes.length;
        let totalUpstreams = 0;
        let httpsCount = 0;

        routes.forEach(r => {
            totalUpstreams += (r.upstreams.length || 1);
            if (r.isHttps) httpsCount++;
        });

        return { totalRoutes, totalUpstreams, httpsCount };
    }, [routes]);

    // Modal controls
    const openAddModal = () => {
        setEditingRouteId(null);
        setFormDomains('');
        setFormUpstreams('');
        setFormId(`proxy_${Date.now()}`);
        setFormHeaders(true);
        setIsModalOpen(true);
    };

    const openEditModal = (route: CaddyRoute) => {
        setEditingRouteId(route.id);
        setFormDomains(route.hosts.join(', '));
        setFormUpstreams(route.upstreams.join(', '));
        setFormId(route.hasRealId ? route.id : `proxy_${Date.now()}`);
        setFormHeaders(route.hasHeaders);
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setEditingRouteId(null);
    };

    // Save Route
    const handleSaveRoute = async (e: React.FormEvent) => {
        e.preventDefault();
        const domains = formDomains.split(',').map(d => d.trim()).filter(Boolean);
        const upstreamsList = formUpstreams.split(',').map(u => {
            let clean = u.trim().replace(/^https?:\/\//, '');
            return { dial: clean };
        }).filter(u => u.dial);

        if (domains.length === 0 || upstreamsList.length === 0) {
            addAlert(_("Input tidak lengkap"), "danger", _("Harap isi Domain dan Target Upstream"));
            return;
        }

        const routeId = formId.trim() || `proxy_${Date.now()}`;
        const newRoute: any = {
            "@id": routeId,
            match: [{ host: domains }],
            handle: [{ handler: "reverse_proxy", upstreams: upstreamsList }],
            terminal: true
        };

        if (formHeaders) {
            newRoute.handle[0].headers = {
                request: {
                    set: {
                        Host: ["{http.request.host}"],
                        "X-Real-IP": ["{http.request.remote.host}"],
                        "X-Forwarded-For": ["{http.request.remote.host}"],
                        "X-Forwarded-Proto": ["{http.request.scheme}"]
                    }
                }
            };
        }

        setFormSubmitting(true);
        try {
            if (editingRouteId) {
                const existing = routes.find(r => r.id === editingRouteId);
                if (existing && existing.hasRealId) {
                    await caddyRequest(`/id/${existing.id}`, 'PATCH', newRoute);
                } else {
                    await deleteRouteInternal(editingRouteId);
                    await addRouteToCaddy(newRoute);
                }
                addAlert(_("Berhasil!"), "success", `Reverse proxy ${domains[0]} berhasil diperbarui.`);
            } else {
                await addRouteToCaddy(newRoute);
                addAlert(_("Berhasil!"), "success", `Reverse proxy ${domains[0]} berhasil ditambahkan.`);
            }

            closeModal();
            await loadConfig();
        } catch (err: any) {
            console.error('Error saving route:', err);
            addAlert(_("Gagal Menyimpan"), "danger", err.message);
        } finally {
            setFormSubmitting(false);
        }
    };

    const addRouteToCaddy = async (newRoute: any) => {
        const sPath = `/config/apps/http/servers/${serverName}`;
        try {
            await caddyRequest(`${sPath}/routes`, 'POST', newRoute);
        } catch {
            const initialServer = {
                listen: [":443", ":80"],
                routes: [newRoute]
            };
            await caddyRequest(sPath, 'POST', initialServer);
        }
    };

    const deleteRouteInternal = async (routeId: string) => {
        const target = routes.find(r => r.id === routeId);
        if (target && target.hasRealId) {
            await caddyRequest(`/id/${target.id}`, 'DELETE');
        } else if (target) {
            await caddyRequest(`/config/apps/http/servers/${target.serverKey}/routes/${target.routeIndex}`, 'DELETE');
        }
    };

    const handleDeleteRoute = async (route: CaddyRoute) => {
        const domainStr = route.hosts.join(', ');
        if (!confirm(`Apakah Anda yakin ingin menghapus proxy untuk "${domainStr}"?`)) {
            return;
        }

        try {
            await deleteRouteInternal(route.id);
            addAlert(_("Terhapus"), "success", `Proxy ${domainStr} berhasil dihapus.`);
            await loadConfig();
        } catch (err: any) {
            console.error('Failed to delete route:', err);
            addAlert(_("Gagal Menghapus"), "danger", err.message);
        }
    };

    // Reload Caddy
    const handleReloadCaddy = async () => {
        addAlert(_("Memuat ulang Caddy..."), "info");
        try {
            const isCockpit = typeof cockpit !== 'undefined' && typeof cockpit.spawn === 'function';
            if (isCockpit) {
                await cockpit.spawn(['systemctl', 'reload', 'caddy'], { superuser: 'try' });
                addAlert(_("Sukses!"), "success", _("Caddy berhasil di-reload via systemctl"));
            } else {
                await caddyRequest('/load', 'POST', rawConfig);
                addAlert(_("Sukses!"), "success", _("Caddy config reloaded via Admin API"));
            }
            await loadConfig();
        } catch (err: any) {
            addAlert(_("Gagal Reload Caddy"), "danger", err.message);
        }
    };

    // Save Raw Config JSON
    const handleSaveRawConfig = async () => {
        setSavingRaw(true);
        try {
            const parsed = JSON.parse(rawEditorText);
            await caddyRequest('/load', 'POST', parsed);
            addAlert(_("Konfigurasi Diterapkan"), "success", _("Caddy JSON config berhasil diperbarui"));
            await loadConfig();
        } catch (err: any) {
            addAlert(_("Format JSON Tidak Valid"), "danger", err.message);
        } finally {
            setSavingRaw(false);
        }
    };

    // Download Backup
    const handleDownloadBackup = () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(rawConfig, null, 2));
        const a = document.createElement('a');
        a.href = dataStr;
        a.download = `caddy_config_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        addAlert(_("Download Dimulai"), "info", _("File konfigurasi backup diunduh."));
    };

    // Generate Caddyfile preview
    const caddyfilePreview = useMemo(() => {
        if (routes.length === 0) {
            return '# Belum ada proxy terdaftar di Caddy';
        }
        let out = '# Representasi Caddyfile dari reverse_proxy yang aktif:\n\n';
        routes.forEach(r => {
            out += `${r.hosts.join(', ')} {\n`;
            out += `    reverse_proxy ${r.upstreams.join(' ')}\n`;
            out += '}\n\n';
        });
        return out;
    }, [routes]);

    return (
        <Page className="pf-m-no-sidebar" style={{ background: 'var(--pf-v6-global--BackgroundColor--100, #ffffff)' }}>
            {/* Notification Toast AlertGroup */}
            <div style={{ position: 'fixed', top: '16px', right: '16px', zIndex: 9999, minWidth: '320px' }}>
                <AlertGroup isToast isLiveRegion>
                    {alerts.map(a => (
                        <Alert
                            key={a.id}
                            variant={a.variant}
                            title={a.title}
                            actionClose={
                                <Button
                                    variant="plain"
                                    onClick={() => setAlerts(prev => prev.filter(item => item.id !== a.id))}
                                >
                                    &times;
                                </Button>
                            }
                        >
                            {a.message}
                        </Alert>
                    ))}
                </AlertGroup>
            </div>

            {/* Page Header */}
            <PageSection padding={{ default: 'padding' }} style={{ borderBottom: '1px solid var(--pf-v6-global--BorderColor--100, #d2d2d2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <ServerIcon style={{ fontSize: '1.5rem', color: 'var(--pf-v6-global--primary-color--100, #0066cc)' }} />
                            <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 600 }}>Caddy Reverse Proxy</h1>
                            {connected ? (
                                <Label color="green" icon={<CheckCircleIcon />}>API Online</Label>
                            ) : (
                                <Label color="red" icon={<ExclamationCircleIcon />}>API Terputus</Label>
                            )}
                        </div>
                        <p style={{ margin: '4px 0 0 0', color: 'var(--pf-v6-global--Color--200, #6a6e73)', fontSize: '0.9rem' }}>
                            Kelola host reverse proxy, upstream backend, dan sertifikat TLS otomatis melalui Caddy Engine.
                        </p>
                    </div>

                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <Button
                            variant="secondary"
                            icon={<SyncAltIcon />}
                            onClick={() => { loadConfig(); addAlert(_("Data diperbarui"), "info"); }}
                            isLoading={loading}
                        >
                            Segarkan
                        </Button>
                        <Button
                            variant="secondary"
                            icon={<RedoIcon />}
                            onClick={handleReloadCaddy}
                        >
                            Reload Caddy
                        </Button>
                        <Button
                            variant="primary"
                            icon={<PlusCircleIcon />}
                            onClick={openAddModal}
                        >
                            Tambah Proxy
                        </Button>
                    </div>
                </div>
            </PageSection>

            {/* Stats Dashboard */}
            <PageSection padding={{ default: 'padding' }}>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                    gap: '16px',
                    marginBottom: '20px'
                }}>
                    <Card isCompact>
                        <CardHeader>
                            <span style={{ fontSize: '0.85rem', color: 'var(--pf-v6-global--Color--200, #6a6e73)' }}>Total Reverse Proxies</span>
                        </CardHeader>
                        <CardBody>
                            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--pf-v6-global--Color--100, #151515)' }}>
                                {stats.totalRoutes}
                            </div>
                        </CardBody>
                    </Card>

                    <Card isCompact>
                        <CardHeader>
                            <span style={{ fontSize: '0.85rem', color: 'var(--pf-v6-global--Color--200, #6a6e73)' }}>Target Upstreams</span>
                        </CardHeader>
                        <CardBody>
                            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--pf-v6-global--primary-color--100, #0066cc)' }}>
                                {stats.totalUpstreams}
                            </div>
                        </CardBody>
                    </Card>

                    <Card isCompact>
                        <CardHeader>
                            <span style={{ fontSize: '0.85rem', color: 'var(--pf-v6-global--Color--200, #6a6e73)' }}>HTTPS Otomatis</span>
                        </CardHeader>
                        <CardBody>
                            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--pf-v6-global--success-color--100, #3e8635)' }}>
                                {stats.httpsCount} Aktif
                            </div>
                        </CardBody>
                    </Card>

                    <Card isCompact>
                        <CardHeader>
                            <span style={{ fontSize: '0.85rem', color: 'var(--pf-v6-global--Color--200, #6a6e73)' }}>Status Admin API</span>
                        </CardHeader>
                        <CardBody>
                            <div style={{
                                fontSize: '1.75rem',
                                fontWeight: 700,
                                color: connected ? 'var(--pf-v6-global--success-color--100, #3e8635)' : 'var(--pf-v6-global--danger-color--100, #c9190b)'
                            }}>
                                {connected ? 'Online' : 'Offline'}
                            </div>
                        </CardBody>
                    </Card>
                </div>

                {/* Main Content Tabs */}
                <Tabs
                    activeKey={activeTab}
                    onSelect={(_event, tabIndex) => setActiveTab(tabIndex)}
                    usePageInsets
                    style={{ marginBottom: '16px' }}
                >
                    <Tab eventKey={0} title={<TabTitleText>Daftar Reverse Proxy</TabTitleText>} />
                    <Tab eventKey={1} title={<TabTitleText>Konfigurasi JSON (Raw)</TabTitleText>} />
                    <Tab eventKey={2} title={<TabTitleText>Caddyfile Preview</TabTitleText>} />
                </Tabs>

                {/* TAB 0: Reverse Proxy List */}
                {activeTab === 0 && (
                    <Card>
                        <CardBody>
                            <Toolbar id="caddy-toolbar" style={{ padding: '0 0 16px 0' }}>
                                <ToolbarContent>
                                    <ToolbarItem>
                                        <TextInput
                                            type="search"
                                            id="proxy-search"
                                            placeholder="Cari domain atau port..."
                                            value={searchQuery}
                                            onChange={(_e, val) => setSearchQuery(val)}
                                            style={{ minWidth: '280px' }}
                                        />
                                    </ToolbarItem>
                                    <ToolbarItem align={{ default: 'alignEnd' }}>
                                        <Badge isRead>{filteredRoutes.length} dari {routes.length} item</Badge>
                                    </ToolbarItem>
                                </ToolbarContent>
                            </Toolbar>

                            {loading ? (
                                <div style={{ textAlign: 'center', padding: '40px' }}>
                                    <Spinner size="lg" />
                                    <p style={{ marginTop: '12px', color: 'var(--pf-v6-global--Color--200, #6a6e73)' }}>Memuat data Caddy...</p>
                                </div>
                            ) : filteredRoutes.length === 0 ? (
                                <EmptyState>
                                    <EmptyStateBody>
                                        {routes.length === 0
                                            ? "Belum ada Reverse Proxy yang terkonfigurasi di Caddy."
                                            : "Tidak ditemukan proxy yang sesuai dengan pencarian."}
                                    </EmptyStateBody>
                                    <EmptyStateActions style={{ marginTop: '16px' }}>
                                        <Button variant="primary" icon={<PlusCircleIcon />} onClick={openAddModal}>
                                            Tambah Proxy Sekarang
                                        </Button>
                                    </EmptyStateActions>
                                </EmptyState>
                            ) : (
                                <div style={{ overflowX: 'auto' }}>
                                    <table className="pf-v6-c-table pf-m-grid-md pf-m-compact" role="grid" style={{ width: '100%' }}>
                                        <thead>
                                            <tr role="row">
                                                <th role="columnheader" style={{ width: '38%' }}>Domain / Host</th>
                                                <th role="columnheader" style={{ width: '32%' }}>Target Upstream</th>
                                                <th role="columnheader" style={{ width: '15%' }}>Fitur</th>
                                                <th role="columnheader" style={{ width: '15%', textAlign: 'right' }}>Aksi</th>
                                            </tr>
                                        </thead>
                                        <tbody role="rowgroup">
                                            {filteredRoutes.map((route) => (
                                                <tr key={route.id} role="row">
                                                    <td role="cell" data-label="Domain / Host">
                                                        <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                                                            {route.hosts.join(', ')}
                                                        </div>
                                                        <div style={{ fontSize: '0.75rem', color: 'var(--pf-v6-global--Color--200, #6a6e73)', marginTop: '2px' }}>
                                                            {route.hasRealId ? `ID: ${route.id}` : `Index #${route.routeIndex}`}
                                                        </div>
                                                    </td>
                                                    <td role="cell" data-label="Target Upstream">
                                                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                                            {route.upstreams.map((u, i) => (
                                                                <span
                                                                    key={i}
                                                                    style={{
                                                                        background: 'var(--pf-v6-global--BackgroundColor--200, #f0f0f0)',
                                                                        border: '1px solid var(--pf-v6-global--BorderColor--100, #d2d2d2)',
                                                                        borderRadius: '3px',
                                                                        padding: '2px 8px',
                                                                        fontFamily: 'monospace',
                                                                        fontSize: '0.85rem'
                                                                    }}
                                                                >
                                                                    {u}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </td>
                                                    <td role="cell" data-label="Fitur">
                                                        <div style={{ display: 'flex', gap: '6px' }}>
                                                            {route.isHttps && (
                                                                <Label color="green" isCompact>SSL</Label>
                                                            )}
                                                            {route.hasHeaders && (
                                                                <Label color="blue" isCompact>Headers</Label>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td role="cell" data-label="Aksi" style={{ textAlign: 'right' }}>
                                                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                                                            <Button
                                                                variant="secondary"
                                                                size="sm"
                                                                icon={<EditIcon />}
                                                                onClick={() => openEditModal(route)}
                                                            >
                                                                Edit
                                                            </Button>
                                                            <Button
                                                                variant="danger"
                                                                size="sm"
                                                                icon={<TrashIcon />}
                                                                onClick={() => handleDeleteRoute(route)}
                                                            >
                                                                Hapus
                                                            </Button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </CardBody>
                    </Card>
                )}

                {/* TAB 1: Raw JSON Config */}
                {activeTab === 1 && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Editor Konfigurasi JSON Caddy</CardTitle>
                        </CardHeader>
                        <CardBody>
                            <p style={{ color: 'var(--pf-v6-global--Color--200, #6a6e73)', marginBottom: '12px' }}>
                                Anda dapat mengedit struktur JSON konfigurasi Caddy secara langsung di bawah ini. Pastikan sintaks JSON valid sebelum menerapkan.
                            </p>
                            <TextArea
                                id="raw-json-editor"
                                value={rawEditorText}
                                onChange={(_e, val) => setRawEditorText(val)}
                                rows={20}
                                style={{
                                    fontFamily: 'monospace',
                                    fontSize: '0.85rem',
                                    marginBottom: '16px'
                                }}
                            />
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <Button
                                    variant="primary"
                                    onClick={handleSaveRawConfig}
                                    isLoading={savingRaw}
                                >
                                    Terapkan Konfigurasi JSON
                                </Button>
                                <Button
                                    variant="secondary"
                                    icon={<DownloadIcon />}
                                    onClick={handleDownloadBackup}
                                >
                                    Download Backup JSON
                                </Button>
                            </div>
                        </CardBody>
                    </Card>
                )}

                {/* TAB 2: Caddyfile Preview */}
                {activeTab === 2 && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Representasi Format Caddyfile</CardTitle>
                        </CardHeader>
                        <CardBody>
                            <p style={{ color: 'var(--pf-v6-global--Color--200, #6a6e73)', marginBottom: '12px' }}>
                                Ini adalah representasi bagaimana rute Caddy di atas ditulis jika menggunakan format file Caddyfile biasa:
                            </p>
                            <CodeBlock>
                                <CodeBlockCode>{caddyfilePreview}</CodeBlockCode>
                            </CodeBlock>
                        </CardBody>
                    </Card>
                )}
            </PageSection>

            {/* Modal Tambah / Edit Route */}
            <Modal
                isOpen={isModalOpen}
                onClose={closeModal}
                style={{ maxWidth: '600px', width: '100%' }}
                aria-labelledby="modal-route-title"
            >
                <ModalHeader
                    title={editingRouteId ? `Edit Reverse Proxy` : `Tambah Reverse Proxy Baru`}
                    labelId="modal-route-title"
                />
                <ModalBody>
                    <Form onSubmit={handleSaveRoute}>
                        <FormGroup
                            label="Domain / Hostname"
                            isRequired
                            fieldId="route-domains"
                        >
                            <TextInput
                                id="route-domains"
                                isRequired
                                placeholder="contoh: app.domain.com, api.domain.com"
                                value={formDomains}
                                onChange={(_e, val) => setFormDomains(val)}
                            />
                            <small style={{ color: 'var(--pf-v6-global--Color--200, #6a6e73)' }}>
                                Pisahkan dengan koma jika menggunakan beberapa domain untuk upstream yang sama.
                            </small>
                        </FormGroup>

                        <FormGroup
                            label="Target Upstream (IP & Port)"
                            isRequired
                            fieldId="route-upstreams"
                        >
                            <TextInput
                                id="route-upstreams"
                                isRequired
                                placeholder="contoh: 127.0.0.1:3000 atau 192.168.1.50:8080"
                                value={formUpstreams}
                                onChange={(_e, val) => setFormUpstreams(val)}
                            />
                            <small style={{ color: 'var(--pf-v6-global--Color--200, #6a6e73)' }}>
                                Masukkan host:port upstream. Pisahkan dengan koma untuk load balancing.
                            </small>
                        </FormGroup>

                        <FormGroup
                            label="Route ID (Opsional)"
                            fieldId="route-id"
                        >
                            <TextInput
                                id="route-id"
                                placeholder="proxy_1"
                                value={formId}
                                readOnly={!!editingRouteId}
                                onChange={(_e, val) => setFormId(val)}
                            />
                        </FormGroup>

                        <FormGroup fieldId="route-headers">
                            <Checkbox
                                id="route-headers"
                                label="Teruskan Client Headers (Host, X-Real-IP, X-Forwarded-For, X-Forwarded-Proto)"
                                isChecked={formHeaders}
                                onChange={(_e, val) => setFormHeaders(val)}
                            />
                        </FormGroup>

                        <ActionGroup style={{ marginTop: '20px' }}>
                            <Button variant="primary" type="submit" isLoading={formSubmitting}>
                                {editingRouteId ? 'Simpan Perubahan' : 'Tambah Proxy'}
                            </Button>
                            <Button variant="link" onClick={closeModal}>
                                Batal
                            </Button>
                        </ActionGroup>
                    </Form>
                </ModalBody>
                <ModalFooter />
            </Modal>
        </Page>
    );
};
