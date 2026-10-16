/*
 * Cockpit Caddy Reverse Proxy Plugin
 * Standard PatternFly 6 Component Architecture
 * LGPL-2.1-or-later
 */

import React, { useEffect, useState, useMemo } from 'react';
import cockpit from 'cockpit';

// PatternFly 6 Core Components
import { Page, PageSection } from '@patternfly/react-core/dist/esm/components/Page/index.js';
import { Card, CardBody, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Button } from '@patternfly/react-core/dist/esm/components/Button/index.js';
import { Label } from '@patternfly/react-core/dist/esm/components/Label/index.js';
import { Alert, AlertGroup, AlertActionCloseButton } from '@patternfly/react-core/dist/esm/components/Alert/index.js';
import { Tabs, Tab, TabTitleText } from '@patternfly/react-core/dist/esm/components/Tabs/index.js';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@patternfly/react-core/dist/esm/components/Modal/index.js';
import { Form, FormGroup, FormHelperText } from '@patternfly/react-core/dist/esm/components/Form/index.js';
import { HelperText, HelperTextItem } from '@patternfly/react-core/dist/esm/components/HelperText/index.js';
import { TextInput } from '@patternfly/react-core/dist/esm/components/TextInput/index.js';
import { TextArea } from '@patternfly/react-core/dist/esm/components/TextArea/index.js';
import { Checkbox } from '@patternfly/react-core/dist/esm/components/Checkbox/index.js';
import { Radio } from '@patternfly/react-core/dist/esm/components/Radio/index.js';
import { ExpandableSection } from '@patternfly/react-core/dist/esm/components/ExpandableSection/index.js';
import { SearchInput } from '@patternfly/react-core/dist/esm/components/SearchInput/index.js';
import { EmptyState, EmptyStateBody, EmptyStateFooter, EmptyStateActions } from '@patternfly/react-core/dist/esm/components/EmptyState/index.js';
import { Toolbar, ToolbarContent, ToolbarItem } from '@patternfly/react-core/dist/esm/components/Toolbar/index.js';
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner/index.js';
import { CodeBlock, CodeBlockCode } from '@patternfly/react-core/dist/esm/components/CodeBlock/index.js';
import { Content } from '@patternfly/react-core/dist/esm/components/Content/index.js';
import { Flex, FlexItem } from '@patternfly/react-core/dist/esm/layouts/Flex/index.js';
import { Table, Thead, Tbody, Tr, Th, Td, ActionsColumn } from '@patternfly/react-table/dist/esm/components/Table/index.js';

// PatternFly Icons
import SyncAltIcon from '@patternfly/react-icons/dist/esm/icons/sync-alt-icon.js';
import PlusCircleIcon from '@patternfly/react-icons/dist/esm/icons/plus-circle-icon.js';
import RedoIcon from '@patternfly/react-icons/dist/esm/icons/redo-icon.js';
import DownloadIcon from '@patternfly/react-icons/dist/esm/icons/download-icon.js';
import CheckCircleIcon from '@patternfly/react-icons/dist/esm/icons/check-circle-icon.js';
import ExclamationCircleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon.js';
import { v4 as uuidv4 } from 'uuid';

const _ = cockpit.gettext;

// Card penuh tanpa sudut membulat
const flatCard: React.CSSProperties = { borderRadius: 0 };

const HSTS_VALUE = "max-age=31536000; includeSubDomains; preload";

// Tahan WebSocket tetap hidup saat Caddy reload config (penting agar Cockpit yang diakses lewat Caddy tidak putus)
const STREAM_CLOSE_DELAY = "1h";

type RouteKind = 'proxy' | 'static';

interface CaddyRoute {
    id: string;
    hasRealId: boolean;
    serverKey: string;
    routeIndex: number;
    kind: RouteKind;
    hosts: string[];
    upstreams: string[];
    rawRoute: any;
    isHttps: boolean;
    isUpstreamHttps: boolean;
    insecureSkipVerify: boolean;
    hasWebsocket: boolean;
    hasHeaders: boolean;
    hasCompression: boolean;
    hasHsts: boolean;
    // khusus situs statis
    root: string;
    hasSpa: boolean;
    hasBrowse: boolean;
    hasStreamDelay: boolean;
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
                        reject(new Error(`HTTP ${statusCode}: ${responseBody || _("Permintaan gagal")}`));
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

// Cek path di server lewat cockpit (test -d / test -f). Di luar Cockpit selalu dianggap ada.
async function pathTest(flag: '-d' | '-f', path: string): Promise<boolean> {
    if (typeof cockpit === 'undefined' || typeof cockpit.spawn !== 'function') return true;
    try {
        await cockpit.spawn(['test', flag, path], { superuser: 'try' });
        return true;
    } catch {
        return false;
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

    // Modal state (tambah / edit)
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
    const [formKind, setFormKind] = useState<RouteKind>('proxy');
    const [formDomains, setFormDomains] = useState<string>('');
    const [formUpstreams, setFormUpstreams] = useState<string>('');
    const [formUpstreamScheme, setFormUpstreamScheme] = useState<'http' | 'https'>('http');
    const [formInsecureSkipVerify, setFormInsecureSkipVerify] = useState<boolean>(true);
    const [formRoot, setFormRoot] = useState<string>('');
    const [formSpa, setFormSpa] = useState<boolean>(false);
    const [formBrowse, setFormBrowse] = useState<boolean>(false);
    const [formId, setFormId] = useState<string>('');
    const [formHeaders, setFormHeaders] = useState<boolean>(true);
    const [formWebsocket, setFormWebsocket] = useState<boolean>(true);
    const [formCompression, setFormCompression] = useState<boolean>(true);
    const [formHsts, setFormHsts] = useState<boolean>(false);
    const [formSubmitting, setFormSubmitting] = useState<boolean>(false);
    const [modalError, setModalError] = useState<string | null>(null);
    const [advancedOpen, setAdvancedOpen] = useState<boolean>(false);

    // Modal konfirmasi hapus
    const [routeToDelete, setRouteToDelete] = useState<CaddyRoute | null>(null);
    const [deleting, setDeleting] = useState<boolean>(false);

    // Raw JSON text state
    const [rawEditorText, setRawEditorText] = useState<string>('');
    const [savingRaw, setSavingRaw] = useState<boolean>(false);

    const addAlert = (title: string, variant: 'success' | 'danger' | 'warning' | 'info' = 'info', message?: string) => {
        const id = Date.now() + Math.random();
        setAlerts(prev => [...prev, { id, title, variant, message }]);
    };

    const removeAlert = (id: number) => {
        setAlerts(prev => prev.filter(a => a.id !== id));
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
                            const fileHandler = handleList.find((h: any) => h.handler === 'file_server');

                            if (proxyHandler || fileHandler) {
                                const kind: RouteKind = proxyHandler ? 'proxy' : 'static';

                                const hosts: string[] = [];
                                if (route.match && Array.isArray(route.match)) {
                                    route.match.forEach((m: any) => {
                                        if (m.host && Array.isArray(m.host)) {
                                            hosts.push(...m.host);
                                        }
                                    });
                                }

                                const upstreams: string[] = [];
                                if (proxyHandler?.upstreams && Array.isArray(proxyHandler.upstreams)) {
                                    upstreams.push(...proxyHandler.upstreams.map((u: any) => u.dial));
                                }

                                const hasHeaders = !!(proxyHandler?.headers && proxyHandler.headers.request);
                                const isHttps = hosts.some(h => !h.includes(':') && h !== '*' && !h.endsWith('.localhost'));
                                const isUpstreamHttps = !!(proxyHandler?.transport && proxyHandler.transport.tls);
                                const insecureSkipVerify = !!(proxyHandler?.transport?.tls?.insecure_skip_verify);
                                const hasWebsocket = proxyHandler?.flush_interval === -1;
                                const hasCompression = handleList.some((h: any) => h.handler === 'encode');
                                const hasHsts = !!(
                                    proxyHandler?.headers?.response?.set?.['Strict-Transport-Security'] ||
                                    handleList.some((h: any) => h.handler === 'headers' && h.response?.set?.['Strict-Transport-Security'])
                                );
                                const hasSpa = handleList.some((h: any) =>
                                    h.handler === 'subroute' &&
                                    h.routes?.some((r: any) => r.match?.some((m: any) => m.file?.try_files))
                                );

                                parsedRoutes.push({
                                    id: route['@id'] || `srv_${sKey}_route_${index}`,
                                    hasRealId: !!route['@id'],
                                    serverKey: sKey,
                                    routeIndex: index,
                                    kind,
                                    hosts: hosts.length > 0 ? hosts : [_("* (Semua host)")],
                                    upstreams,
                                    rawRoute: route,
                                    isHttps,
                                    isUpstreamHttps,
                                    insecureSkipVerify,
                                    hasWebsocket,
                                    hasHeaders,
                                    hasCompression,
                                    hasHsts,
                                    root: fileHandler?.root || '',
                                    hasSpa,
                                    hasBrowse: !!fileHandler?.browse,
                                    hasStreamDelay: !!proxyHandler?.stream_close_delay
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
            r.root.toLowerCase().includes(query) ||
            r.id.toLowerCase().includes(query)
        );
    }, [routes, searchQuery]);

    // Modal controls
    const openAddModal = () => {
        setModalError(null);
        setAdvancedOpen(false);
        setEditingRouteId(null);
        setFormKind('proxy');
        setFormDomains('');
        setFormUpstreams('');
        setFormUpstreamScheme('http');
        setFormInsecureSkipVerify(true);
        setFormRoot('');
        setFormSpa(false);
        setFormBrowse(false);
        setFormId(uuidv4());
        setFormHeaders(true);
        setFormWebsocket(true);
        setFormCompression(true);
        setFormHsts(false);
        setIsModalOpen(true);
    };

    const openEditModal = (route: CaddyRoute) => {
        setModalError(null);
        setAdvancedOpen(false);
        setEditingRouteId(route.id);
        setFormKind(route.kind);
        setFormDomains(route.hosts.join(', '));
        setFormUpstreams(route.upstreams.join(', '));
        setFormUpstreamScheme(route.isUpstreamHttps ? 'https' : 'http');
        setFormInsecureSkipVerify(route.insecureSkipVerify);
        setFormRoot(route.root);
        setFormSpa(route.hasSpa);
        setFormBrowse(route.hasBrowse);
        setFormId(route.hasRealId ? route.id : uuidv4());
        setFormHeaders(route.hasHeaders);
        setFormWebsocket(route.hasWebsocket);
        setFormCompression(route.hasCompression);
        setFormHsts(route.hasHsts);
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setEditingRouteId(null);
        setModalError(null);
    };

    // Auto-fix server configuration: ensure :443 listen port for Automatic HTTPS, and clean Debian dummy route
    const ensureServerConfig = async (sPath: string) => {
        try {
            const currentListen = await caddyRequest(`${sPath}/listen`);
            if (Array.isArray(currentListen)) {
                const has443 = currentListen.some(p => p.includes('443'));
                if (!has443) {
                    // Update server listen to :443 via PATCH so Caddy activates Automatic HTTPS
                    await caddyRequest(`${sPath}/listen`, 'PATCH', [":443"]);
                }
            }
        } catch (err) {
            console.warn('Failed to update listen port to :443:', err);
        }

        try {
            const existingRoutes = await caddyRequest(`${sPath}/routes`);
            if (Array.isArray(existingRoutes)) {
                const dummyIdx = existingRoutes.findIndex(
                    (r: any) => (!r.match || r.match.length === 0) &&
                        r.handle?.some((h: any) => h.handler === 'file_server' || h.handler === 'vars')
                );
                if (dummyIdx !== -1) {
                    await caddyRequest(`${sPath}/routes/${dummyIdx}`, 'DELETE');
                }
            }
        } catch {
            // Ignore if cleanup not applicable
        }
    };

    // Bangun daftar handler untuk rute reverse proxy
    const buildProxyHandlers = (upstreamsList: { dial: string }[]): any[] => {
        const handlers: any[] = [];
        if (formCompression) {
            handlers.push({ handler: "encode", encodings: { gzip: {}, zstd: {} } });
        }

        const proxyHandler: any = {
            handler: "reverse_proxy",
            upstreams: upstreamsList
        };

        // Cegah koneksi WebSocket (termasuk Cockpit sendiri) putus saat config di-reload
        proxyHandler.stream_close_delay = STREAM_CLOSE_DELAY;

        if (formWebsocket) {
            proxyHandler.flush_interval = -1;
        }

        if (formUpstreamScheme === 'https') {
            proxyHandler.transport = {
                protocol: "http",
                tls: formInsecureSkipVerify ? { insecure_skip_verify: true } : {}
            };
        }

        const headersObj: any = {};
        if (formHeaders) {
            headersObj.request = {
                set: {
                    Host: ["{http.request.host}"],
                    "X-Real-IP": ["{http.request.remote.host}"],
                    "X-Forwarded-For": ["{http.request.remote.host}"],
                    "X-Forwarded-Proto": ["{http.request.scheme}"]
                }
            };
        }
        if (formHsts) {
            headersObj.response = { set: { "Strict-Transport-Security": [HSTS_VALUE] } };
        }
        if (headersObj.request || headersObj.response) {
            proxyHandler.headers = headersObj;
        }

        handlers.push(proxyHandler);
        return handlers;
    };

    // Bangun daftar handler untuk rute situs statis (folder)
    const buildStaticHandlers = (rootPath: string): any[] => {
        const handlers: any[] = [];
        if (formCompression) {
            handlers.push({ handler: "encode", encodings: { gzip: {}, zstd: {} } });
        }
        if (formHsts) {
            handlers.push({
                handler: "headers",
                response: { set: { "Strict-Transport-Security": [HSTS_VALUE] } }
            });
        }
        if (formSpa) {
            // Setara dengan: try_files {path} /index.html
            handlers.push({
                handler: "subroute",
                routes: [{
                    match: [{
                        file: {
                            root: rootPath,
                            try_files: ["{http.request.uri.path}", "/index.html"]
                        }
                    }],
                    handle: [{ handler: "rewrite", uri: "{http.matchers.file.relative}" }]
                }]
            });
        }
        const fileServer: any = { handler: "file_server", root: rootPath };
        if (formBrowse) {
            fileServer.browse = {};
        }
        handlers.push(fileServer);
        return handlers;
    };

    // Save Route
    const handleSaveRoute = async (e: React.FormEvent) => {
        e.preventDefault();
        const domains = formDomains.split(',').map(d => d.trim()).filter(Boolean);

        let handlers: any[] = [];

        if (formKind === 'proxy') {
            const upstreamsList = formUpstreams.split(',').map(u => {
                const clean = u.trim().replace(/^https?:\/\//i, '');
                return { dial: clean };
            }).filter(u => u.dial);

            if (domains.length === 0 || upstreamsList.length === 0) {
                setModalError(_("Harap isi Domain dan Target Upstream"));
                return;
            }
            handlers = buildProxyHandlers(upstreamsList);
        } else {
            const rootPath = formRoot.trim().replace(/\/+$/, '') || '/';

            if (domains.length === 0 || !formRoot.trim()) {
                setModalError(_("Harap isi Domain dan Folder root"));
                return;
            }
            if (!rootPath.startsWith('/')) {
                setModalError(_("Folder root harus berupa path absolut, misalnya /var/www/situs"));
                return;
            }

            setFormSubmitting(true);
            const dirOk = await pathTest('-d', rootPath);
            if (!dirOk) {
                setFormSubmitting(false);
                setModalError(cockpit.format(_("Folder $0 tidak ditemukan di server."), rootPath));
                return;
            }
            if (!formBrowse) {
                const indexOk = await pathTest('-f', `${rootPath}/index.html`);
                if (!indexOk) {
                    addAlert(
                        _("index.html tidak ditemukan"),
                        "warning",
                        cockpit.format(_("Tidak ada $0/index.html. Pengunjung akan melihat 404."), rootPath)
                    );
                }
            }
            handlers = buildStaticHandlers(rootPath);
        }

        const routeId = formId.trim() || uuidv4();
        const newRoute: any = {
            "@id": routeId,
            match: [{ host: domains }],
            handle: handlers,
            terminal: true
        };

        setFormSubmitting(true);
        setModalError(null);
        try {
            const sPath = `/config/apps/http/servers/${serverName}`;
            await ensureServerConfig(sPath);

            if (editingRouteId) {
                const existing = routes.find(r => r.id === editingRouteId);
                if (existing && existing.hasRealId) {
                    await caddyRequest(`/id/${existing.id}`, 'PATCH', newRoute);
                } else {
                    await deleteRouteInternal(editingRouteId);
                    await addRouteToCaddy(newRoute);
                }
                addAlert(_("Berhasil"), "success", `Rute ${domains[0]} berhasil diperbarui.`);
            } else {
                await addRouteToCaddy(newRoute);
                addAlert(_("Berhasil"), "success", `Rute ${domains[0]} berhasil ditambahkan.`);
            }

            closeModal();
            await loadConfig();
        } catch (err: any) {
            console.error('Error saving route:', err);
            setModalError(err.message || _("Gagal menyimpan konfigurasi"));
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

    const handleConfirmDelete = async () => {
        if (!routeToDelete) return;
        const domainStr = routeToDelete.hosts.join(', ');

        setDeleting(true);
        try {
            await deleteRouteInternal(routeToDelete.id);
            addAlert(_("Terhapus"), "success", `Rute ${domainStr} berhasil dihapus.`);
            setRouteToDelete(null);
            await loadConfig();
        } catch (err: any) {
            console.error('Failed to delete route:', err);
            addAlert(_("Gagal menghapus"), "danger", err.message);
        } finally {
            setDeleting(false);
        }
    };

    // Reload Caddy
    const handleReloadCaddy = async () => {
        addAlert(_("Memuat ulang Caddy..."), "info");
        try {
            const isCockpit = typeof cockpit !== 'undefined' && typeof cockpit.spawn === 'function';
            if (isCockpit) {
                await cockpit.spawn(['systemctl', 'reload', 'caddy'], { superuser: 'try' });
                addAlert(_("Sukses"), "success", _("Caddy berhasil di-reload via systemctl"));
            } else {
                await caddyRequest('/load', 'POST', rawConfig);
                addAlert(_("Sukses"), "success", _("Konfigurasi Caddy dimuat ulang via Admin API"));
            }
            await loadConfig();
        } catch (err: any) {
            addAlert(_("Gagal reload Caddy"), "danger", err.message);
        }
    };

    // Save Raw Config JSON
    const handleSaveRawConfig = async () => {
        setSavingRaw(true);
        try {
            const parsed = JSON.parse(rawEditorText);
            await caddyRequest('/load', 'POST', parsed);
            addAlert(_("Konfigurasi diterapkan"), "success", _("Konfigurasi JSON Caddy berhasil diperbarui"));
            await loadConfig();
        } catch (err: any) {
            addAlert(_("Gagal menerapkan konfigurasi"), "danger", err.message);
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
        addAlert(_("Unduhan dimulai"), "info", _("File konfigurasi backup diunduh."));
    };

    // Generate Caddyfile preview
    const caddyfilePreview = useMemo(() => {
        if (routes.length === 0) {
            return '# Belum ada rute terdaftar di Caddy';
        }
        let out = '# Representasi Caddyfile dari rute yang aktif:\n\n';
        routes.forEach(r => {
            out += `${r.hosts.join(', ')} {\n`;

            if (r.kind === 'static') {
                out += `    root * ${r.root}\n`;
                if (r.hasCompression) {
                    out += `    encode gzip zstd\n`;
                }
                if (r.hasHsts) {
                    out += `    header Strict-Transport-Security "${HSTS_VALUE}"\n`;
                }
                if (r.hasSpa) {
                    out += `    try_files {path} /index.html\n`;
                }
                out += r.hasBrowse ? `    file_server browse\n` : `    file_server\n`;
                out += '}\n\n';
                return;
            }

            if (r.hasCompression) {
                out += `    encode gzip zstd\n`;
            }
            if (r.hasHsts) {
                out += `    header Strict-Transport-Security "${HSTS_VALUE}"\n`;
            }
            if (r.isUpstreamHttps || r.hasWebsocket || r.hasStreamDelay) {
                out += `    reverse_proxy ${r.upstreams.join(' ')} {\n`;
                if (r.isUpstreamHttps) {
                    out += `        transport http {\n`;
                    if (r.insecureSkipVerify) {
                        out += `            tls_insecure_skip_verify\n`;
                    } else {
                        out += `            tls\n`;
                    }
                    out += `        }\n`;
                }
                if (r.hasWebsocket) {
                    out += `        flush_interval -1\n`;
                }
                if (r.hasStreamDelay) {
                    out += `        stream_close_delay ${STREAM_CLOSE_DELAY}\n`;
                }
                out += `    }\n`;
            } else {
                out += `    reverse_proxy ${r.upstreams.join(' ')}\n`;
            }
            out += '}\n\n';
        });
        return out;
    }, [routes]);

    // Ringkasan fitur sebagai teks biasa (tanpa label berwarna)
    const featureSummary = (route: CaddyRoute) => {
        const list = route.kind === 'static'
            ? [
                route.isHttps && _("Auto-TLS"),
                route.hasSpa && "SPA",
                route.hasBrowse && _("Daftar folder"),
                route.hasCompression && _("Kompresi"),
                route.hasHsts && "HSTS",
            ]
            : [
                route.isHttps && _("Auto-TLS"),
                route.hasWebsocket && "WebSocket",
                route.hasCompression && _("Kompresi"),
                route.hasHsts && "HSTS",
                route.hasHeaders && _("Header klien"),
            ];
        const filtered = list.filter(Boolean);
        return filtered.length > 0 ? filtered.join(', ') : '-';
    };

    const renderRouteList = () => {
        if (loading) {
            return (
                <EmptyState titleText={_("Memuat data Caddy...")} headingLevel="h4" icon={Spinner} />
            );
        }

        if (filteredRoutes.length === 0) {
            return (
                <EmptyState
                    titleText={routes.length === 0 ? _("Belum ada rute") : _("Tidak ada hasil")}
                    headingLevel="h4"
                >
                    <EmptyStateBody>
                        {routes.length === 0
                            ? _("Belum ada reverse proxy atau situs statis yang terkonfigurasi di Caddy.")
                            : _("Tidak ditemukan rute yang sesuai dengan pencarian.")}
                    </EmptyStateBody>
                    {routes.length === 0 && (
                        <EmptyStateFooter>
                            <EmptyStateActions>
                                <Button variant="primary" icon={<PlusCircleIcon />} onClick={openAddModal}>
                                    {_("Tambah rute")}
                                </Button>
                            </EmptyStateActions>
                        </EmptyStateFooter>
                    )}
                </EmptyState>
            );
        }

        return (
            <Table aria-label={_("Daftar rute")} variant="compact">
                <Thead>
                    <Tr>
                        <Th>{_("Domain")}</Th>
                        <Th>{_("Tipe")}</Th>
                        <Th>{_("Tujuan")}</Th>
                        <Th>{_("Fitur")}</Th>
                        <Th screenReaderText={_("Aksi")} />
                    </Tr>
                </Thead>
                <Tbody>
                    {filteredRoutes.map(route => (
                        <Tr key={route.id}>
                            <Td dataLabel={_("Domain")}>
                                <div>{route.hosts.join(', ')}</div>
                                <Content component="small">
                                    {route.hasRealId ? route.id : `${_("Indeks")} #${route.routeIndex}`}
                                </Content>
                            </Td>
                            <Td dataLabel={_("Tipe")}>
                                {route.kind === 'static' ? _("Situs statis") : _("Reverse proxy")}
                            </Td>
                            <Td dataLabel={_("Tujuan")}>
                                {route.kind === 'static'
                                    ? <div>{route.root || '-'}</div>
                                    : route.upstreams.map((u, i) => (
                                        <div key={i}>{route.isUpstreamHttps ? `https://${u}` : u}</div>
                                    ))}
                            </Td>
                            <Td dataLabel={_("Fitur")}>
                                {featureSummary(route)}
                            </Td>
                            <Td isActionCell>
                                <ActionsColumn
                                    items={[
                                        { title: _("Edit"), onClick: () => openEditModal(route) },
                                        { isSeparator: true },
                                        { title: _("Hapus"), onClick: () => setRouteToDelete(route) },
                                    ]}
                                />
                            </Td>
                        </Tr>
                    ))}
                </Tbody>
            </Table>
        );
    };

    return (
        <Page className="pf-m-no-sidebar">
            {/* Notifikasi toast */}
            <AlertGroup isToast isLiveRegion>
                {alerts.map(a => (
                    <Alert
                        key={a.id}
                        variant={a.variant}
                        title={a.title}
                        timeout={4000}
                        onTimeout={() => removeAlert(a.id)}
                        actionClose={<AlertActionCloseButton onClose={() => removeAlert(a.id)} />}
                    >
                        {a.message}
                    </Alert>
                ))}
            </AlertGroup>

            {/* Tab (pola sama dengan halaman Services Cockpit) */}
            <PageSection type="tabs" hasBodyWrapper={false} padding={{ default: 'noPadding' }}>
                <Tabs
                    activeKey={activeTab}
                    onSelect={(_event, tabIndex) => setActiveTab(tabIndex)}
                    hasNoBorderBottom
                    usePageInsets
                    aria-label={_("Bagian plugin Caddy")}
                >
                    <Tab eventKey={0} title={<TabTitleText>{_("Rute")}</TabTitleText>} aria-label={_("Rute")} />
                    <Tab eventKey={1} title={<TabTitleText>{_("Konfigurasi JSON")}</TabTitleText>} aria-label={_("Konfigurasi JSON")} />
                    <Tab eventKey={2} title={<TabTitleText>{_("Pratinjau Caddyfile")}</TabTitleText>} aria-label={_("Pratinjau Caddyfile")} />
                </Tabs>
            </PageSection>

            <PageSection hasBodyWrapper={false} padding={{ default: 'noPadding' }}>
                {/* TAB 0: Daftar rute */}
                {activeTab === 0 && (
                    <Card style={flatCard}>
                        <CardBody>
                            <Toolbar id="caddy-toolbar">
                                <ToolbarContent>
                                    <ToolbarItem>
                                        <SearchInput
                                            id="proxy-search"
                                            placeholder={_("Cari domain, upstream, atau folder")}
                                            value={searchQuery}
                                            onChange={(_event, val) => setSearchQuery(val)}
                                            onClear={() => setSearchQuery('')}
                                        />
                                    </ToolbarItem>
                                    <ToolbarItem>
                                        <Button variant="primary" icon={<PlusCircleIcon />} onClick={openAddModal}>
                                            {_("Tambah rute")}
                                        </Button>
                                    </ToolbarItem>
                                    <ToolbarItem align={{ default: 'alignEnd' }}>
                                        <Button variant="secondary" icon={<RedoIcon />} onClick={handleReloadCaddy}>
                                            {_("Reload Caddy")}
                                        </Button>
                                    </ToolbarItem>
                                    <ToolbarItem>
                                        <Button
                                            variant="plain"
                                            aria-label={_("Segarkan")}
                                            icon={<SyncAltIcon />}
                                            onClick={loadConfig}
                                            isDisabled={loading}
                                        />
                                    </ToolbarItem>
                                    <ToolbarItem>
                                        {connected
                                            ? <Label color="green" icon={<CheckCircleIcon />}>{_("API online")}</Label>
                                            : <Label color="red" icon={<ExclamationCircleIcon />}>{_("API terputus")}</Label>}
                                    </ToolbarItem>
                                </ToolbarContent>
                            </Toolbar>
                            {renderRouteList()}
                        </CardBody>
                    </Card>
                )}

                {/* TAB 1: Raw JSON */}
                {activeTab === 1 && (
                    <Card style={flatCard}>
                        <CardTitle>{_("Editor konfigurasi JSON Caddy")}</CardTitle>
                        <CardBody>
                            <Form>
                                <FormGroup label={_("Konfigurasi JSON")} fieldId="raw-json-editor">
                                    <TextArea
                                        id="raw-json-editor"
                                        value={rawEditorText}
                                        onChange={(_event, val) => setRawEditorText(val)}
                                        rows={20}
                                        resizeOrientation="vertical"
                                        spellCheck={false}
                                        style={{ fontFamily: 'var(--pf-t--global--font--family--mono)' }}
                                    />
                                    <FormHelperText>
                                        <HelperText>
                                            <HelperTextItem>
                                                {_("Pastikan sintaks JSON valid sebelum menerapkan.")}
                                            </HelperTextItem>
                                        </HelperText>
                                    </FormHelperText>
                                </FormGroup>
                                <Flex>
                                    <FlexItem>
                                        <Button variant="primary" onClick={handleSaveRawConfig} isLoading={savingRaw}>
                                            {_("Terapkan konfigurasi")}
                                        </Button>
                                    </FlexItem>
                                    <FlexItem>
                                        <Button variant="secondary" icon={<DownloadIcon />} onClick={handleDownloadBackup}>
                                            {_("Unduh backup JSON")}
                                        </Button>
                                    </FlexItem>
                                </Flex>
                            </Form>
                        </CardBody>
                    </Card>
                )}

                {/* TAB 2: Pratinjau Caddyfile */}
                {activeTab === 2 && (
                    <Card style={flatCard}>
                        <CardTitle>{_("Representasi Caddyfile")}</CardTitle>
                        <CardBody>
                            <Content component="p">
                                {_("Beginilah rute Caddy di atas jika ditulis dalam format Caddyfile biasa:")}
                            </Content>
                            <CodeBlock>
                                <CodeBlockCode>{caddyfilePreview}</CodeBlockCode>
                            </CodeBlock>
                        </CardBody>
                    </Card>
                )}
            </PageSection>

            {/* Modal tambah / edit: satu form, tanpa tab */}
            <Modal
                variant="medium"
                isOpen={isModalOpen}
                onClose={closeModal}
                aria-labelledby="modal-route-title"
            >
                <ModalHeader
                    title={editingRouteId ? _("Edit rute") : _("Tambah rute")}
                    labelId="modal-route-title"
                />
                <ModalBody>
                    <Form id="route-form" onSubmit={handleSaveRoute}>
                        {modalError && (
                            <Alert variant="danger" isInline title={_("Gagal menyimpan")}>
                                {modalError}
                            </Alert>
                        )}

                        <FormGroup role="radiogroup" isInline fieldId="route-kind" label={_("Tipe")}>
                            <Radio
                                id="kind-proxy"
                                name="route-kind"
                                label={_("Reverse proxy")}
                                isChecked={formKind === 'proxy'}
                                onChange={() => setFormKind('proxy')}
                            />
                            <Radio
                                id="kind-static"
                                name="route-kind"
                                label={_("Situs statis (folder)")}
                                isChecked={formKind === 'static'}
                                onChange={() => setFormKind('static')}
                            />
                        </FormGroup>

                        <FormGroup label={_("Domain")} isRequired fieldId="route-domains">
                            <TextInput
                                id="route-domains"
                                isRequired
                                placeholder="app.domain.com, www.domain.com"
                                value={formDomains}
                                onChange={(_event, val) => setFormDomains(val)}
                            />
                            <FormHelperText>
                                <HelperText>
                                    <HelperTextItem>{_("Pisahkan dengan koma untuk beberapa domain.")}</HelperTextItem>
                                </HelperText>
                            </FormHelperText>
                        </FormGroup>

                        {formKind === 'proxy' ? (
                            <>
                                <FormGroup label={_("Upstream")} isRequired fieldId="route-upstreams">
                                    <TextInput
                                        id="route-upstreams"
                                        isRequired
                                        placeholder="127.0.0.1:3000, 192.168.1.50:8080"
                                        value={formUpstreams}
                                        onChange={(_event, val) => {
                                            setFormUpstreams(val);
                                            if (val.toLowerCase().includes('https://')) {
                                                setFormUpstreamScheme('https');
                                            }
                                        }}
                                    />
                                    <FormHelperText>
                                        <HelperText>
                                            <HelperTextItem>{_("Format host:port. Pisahkan dengan koma untuk load balancing.")}</HelperTextItem>
                                        </HelperText>
                                    </FormHelperText>
                                </FormGroup>

                                <FormGroup role="radiogroup" isInline fieldId="route-scheme" label={_("Protokol backend")}>
                                    <Radio
                                        id="scheme-http"
                                        name="upstream-scheme"
                                        label="HTTP"
                                        isChecked={formUpstreamScheme === 'http'}
                                        onChange={() => setFormUpstreamScheme('http')}
                                    />
                                    <Radio
                                        id="scheme-https"
                                        name="upstream-scheme"
                                        label="HTTPS"
                                        isChecked={formUpstreamScheme === 'https'}
                                        onChange={() => setFormUpstreamScheme('https')}
                                    />
                                    <FormHelperText>
                                        <HelperText>
                                            <HelperTextItem>
                                                {_("Pilih HTTPS jika backend memakai TLS, misalnya Cockpit :9090 atau Proxmox :8006.")}
                                            </HelperTextItem>
                                        </HelperText>
                                    </FormHelperText>
                                </FormGroup>
                            </>
                        ) : (
                            <FormGroup label={_("Folder root")} isRequired fieldId="route-root">
                                <TextInput
                                    id="route-root"
                                    isRequired
                                    placeholder="/var/www/situs"
                                    value={formRoot}
                                    onChange={(_event, val) => setFormRoot(val)}
                                />
                                <FormHelperText>
                                    <HelperText>
                                        <HelperTextItem>
                                            {_("Folder di server yang berisi index.html, CSS, dan JS. User caddy harus bisa membacanya.")}
                                        </HelperTextItem>
                                    </HelperText>
                                </FormHelperText>
                            </FormGroup>
                        )}

                        <FormGroup role="group" isStack fieldId="route-options" label={_("Opsi")}>
                            {formKind === 'proxy' ? (
                                <>
                                    <Checkbox
                                        id="route-websocket"
                                        label="WebSocket"
                                        description={_("Untuk koneksi dua arah, misalnya terminal web atau Socket.io.")}
                                        isChecked={formWebsocket}
                                        onChange={(_event, val) => setFormWebsocket(val)}
                                    />
                                    <Checkbox
                                        id="route-headers"
                                        label={_("Teruskan header klien")}
                                        description="Host, X-Real-IP, X-Forwarded-For, X-Forwarded-Proto"
                                        isChecked={formHeaders}
                                        onChange={(_event, val) => setFormHeaders(val)}
                                    />
                                    {formUpstreamScheme === 'https' && (
                                        <Checkbox
                                            id="route-insecure-tls"
                                            label={_("Abaikan verifikasi sertifikat backend")}
                                            description={_("Diperlukan untuk sertifikat self-signed.")}
                                            isChecked={formInsecureSkipVerify}
                                            onChange={(_event, val) => setFormInsecureSkipVerify(val)}
                                        />
                                    )}
                                </>
                            ) : (
                                <>
                                    <Checkbox
                                        id="route-spa"
                                        label={_("Mode SPA")}
                                        description={_("Path yang tidak ada diarahkan ke index.html (React, Vue, dan sejenisnya).")}
                                        isChecked={formSpa}
                                        onChange={(_event, val) => setFormSpa(val)}
                                    />
                                    <Checkbox
                                        id="route-browse"
                                        label={_("Tampilkan daftar isi folder")}
                                        description={_("Jika tidak ada index.html, isi folder ditampilkan ke pengunjung.")}
                                        isChecked={formBrowse}
                                        onChange={(_event, val) => setFormBrowse(val)}
                                    />
                                </>
                            )}
                            <Checkbox
                                id="route-compression"
                                label={_("Kompresi respons (gzip, zstd)")}
                                isChecked={formCompression}
                                onChange={(_event, val) => setFormCompression(val)}
                            />
                            <Checkbox
                                id="route-hsts"
                                label="HSTS"
                                description={_("Browser akan selalu memakai HTTPS untuk domain ini.")}
                                isChecked={formHsts}
                                onChange={(_event, val) => setFormHsts(val)}
                            />
                        </FormGroup>

                        <ExpandableSection
                            toggleText={_("Lanjutan")}
                            isExpanded={advancedOpen}
                            onToggle={(_event, expanded) => setAdvancedOpen(expanded)}
                        >
                            <FormGroup label={_("Route ID")} fieldId="route-id">
                                <TextInput
                                    id="route-id"
                                    placeholder="550e8400-e29b-41d4-a716-446655440000"
                                    value={formId}
                                    {...(editingRouteId ? { readOnlyVariant: 'default' as const } : {})}
                                    onChange={(_event, val) => setFormId(val)}
                                />
                                <FormHelperText>
                                    <HelperText>
                                        <HelperTextItem>{_("Pengenal unik rute ini di Caddy.")}</HelperTextItem>
                                    </HelperText>
                                </FormHelperText>
                            </FormGroup>
                        </ExpandableSection>
                    </Form>
                </ModalBody>
                <ModalFooter>
                    <Button variant="primary" type="submit" form="route-form" isLoading={formSubmitting} isDisabled={formSubmitting}>
                        {editingRouteId ? _("Simpan perubahan") : _("Tambah rute")}
                    </Button>
                    <Button variant="link" onClick={closeModal}>
                        {_("Batal")}
                    </Button>
                </ModalFooter>
            </Modal>

            {/* Modal konfirmasi hapus */}
            <Modal
                variant="small"
                isOpen={routeToDelete !== null}
                onClose={() => setRouteToDelete(null)}
                aria-labelledby="modal-delete-title"
            >
                <ModalHeader
                    title={_("Hapus rute?")}
                    titleIconVariant="warning"
                    labelId="modal-delete-title"
                />
                <ModalBody>
                    {routeToDelete && cockpit.format(
                        _("Rute untuk $0 akan dihapus dari konfigurasi Caddy. File di folder tidak ikut dihapus."),
                        routeToDelete.hosts.join(', ')
                    )}
                </ModalBody>
                <ModalFooter>
                    <Button variant="danger" onClick={handleConfirmDelete} isLoading={deleting} isDisabled={deleting}>
                        {_("Hapus")}
                    </Button>
                    <Button variant="link" onClick={() => setRouteToDelete(null)}>
                        {_("Batal")}
                    </Button>
                </ModalFooter>
            </Modal>
        </Page>
    );
};