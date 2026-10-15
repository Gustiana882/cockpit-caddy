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
import { Form, FormGroup } from '@patternfly/react-core/dist/esm/components/Form/index.js';
import { FormHelperText } from '@patternfly/react-core/dist/esm/components/Form/index.js';
import { HelperText, HelperTextItem } from '@patternfly/react-core/dist/esm/components/HelperText/index.js';
import { TextInput } from '@patternfly/react-core/dist/esm/components/TextInput/index.js';
import { TextArea } from '@patternfly/react-core/dist/esm/components/TextArea/index.js';
import { Checkbox } from '@patternfly/react-core/dist/esm/components/Checkbox/index.js';
import { SearchInput } from '@patternfly/react-core/dist/esm/components/SearchInput/index.js';
import { EmptyState, EmptyStateBody, EmptyStateFooter, EmptyStateActions } from '@patternfly/react-core/dist/esm/components/EmptyState/index.js';
import { Toolbar, ToolbarContent, ToolbarItem } from '@patternfly/react-core/dist/esm/components/Toolbar/index.js';
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner/index.js';
import { CodeBlock, CodeBlockCode } from '@patternfly/react-core/dist/esm/components/CodeBlock/index.js';
import { Content } from '@patternfly/react-core/dist/esm/components/Content/index.js';
import { Title } from '@patternfly/react-core/dist/esm/components/Title/index.js';
import { Flex, FlexItem } from '@patternfly/react-core/dist/esm/layouts/Flex/index.js';
import { Table, Thead, Tbody, Tr, Th, Td, ActionsColumn } from '@patternfly/react-table/dist/esm/components/Table/index.js';

// PatternFly Icons
import SyncAltIcon from '@patternfly/react-icons/dist/esm/icons/sync-alt-icon.js';
import PlusCircleIcon from '@patternfly/react-icons/dist/esm/icons/plus-circle-icon.js';
import RedoIcon from '@patternfly/react-icons/dist/esm/icons/redo-icon.js';
import DownloadIcon from '@patternfly/react-icons/dist/esm/icons/download-icon.js';
import CheckCircleIcon from '@patternfly/react-icons/dist/esm/icons/check-circle-icon.js';
import ExclamationCircleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon.js';

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
    const [formDomains, setFormDomains] = useState<string>('');
    const [formUpstreams, setFormUpstreams] = useState<string>('');
    const [formId, setFormId] = useState<string>('');
    const [formHeaders, setFormHeaders] = useState<boolean>(true);
    const [formSubmitting, setFormSubmitting] = useState<boolean>(false);

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
                                    hosts: hosts.length > 0 ? hosts : [_("* (Semua host)")],
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
            const clean = u.trim().replace(/^https?:\/\//, '');
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
                addAlert(_("Berhasil"), "success", `Reverse proxy ${domains[0]} berhasil diperbarui.`);
            } else {
                await addRouteToCaddy(newRoute);
                addAlert(_("Berhasil"), "success", `Reverse proxy ${domains[0]} berhasil ditambahkan.`);
            }

            closeModal();
            await loadConfig();
        } catch (err: any) {
            console.error('Error saving route:', err);
            addAlert(_("Gagal menyimpan"), "danger", err.message);
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
            addAlert(_("Terhapus"), "success", `Proxy ${domainStr} berhasil dihapus.`);
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

    const renderRouteList = () => {
        if (loading) {
            return (
                <EmptyState titleText={_("Memuat data Caddy...")} headingLevel="h4" icon={Spinner} />
            );
        }

        if (filteredRoutes.length === 0) {
            return (
                <EmptyState
                    titleText={routes.length === 0 ? _("Belum ada reverse proxy") : _("Tidak ada hasil")}
                    headingLevel="h4"
                >
                    <EmptyStateBody>
                        {routes.length === 0
                            ? _("Belum ada reverse proxy yang terkonfigurasi di Caddy.")
                            : _("Tidak ditemukan proxy yang sesuai dengan pencarian.")}
                    </EmptyStateBody>
                    {routes.length === 0 && (
                        <EmptyStateFooter>
                            <EmptyStateActions>
                                <Button variant="primary" icon={<PlusCircleIcon />} onClick={openAddModal}>
                                    {_("Tambah proxy")}
                                </Button>
                            </EmptyStateActions>
                        </EmptyStateFooter>
                    )}
                </EmptyState>
            );
        }

        return (
            <Table aria-label={_("Daftar reverse proxy")} variant="compact">
                <Thead>
                    <Tr>
                        <Th>{_("Domain / Host")}</Th>
                        <Th>{_("Target upstream")}</Th>
                        <Th>{_("Fitur")}</Th>
                        <Th screenReaderText={_("Aksi")} />
                    </Tr>
                </Thead>
                <Tbody>
                    {filteredRoutes.map(route => (
                        <Tr key={route.id}>
                            <Td dataLabel={_("Domain / Host")}>
                                <div>{route.hosts.join(', ')}</div>
                                <Content component="small">
                                    {route.hasRealId ? `ID: ${route.id}` : `${_("Indeks")} #${route.routeIndex}`}
                                </Content>
                            </Td>
                            <Td dataLabel={_("Target upstream")}>
                                <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                                    {route.upstreams.map((u, i) => (
                                        <FlexItem key={i}>
                                            <Label variant="outline" isCompact>{u}</Label>
                                        </FlexItem>
                                    ))}
                                </Flex>
                            </Td>
                            <Td dataLabel={_("Fitur")}>
                                <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                                    {route.isHttps && (
                                        <FlexItem><Label color="green" isCompact>HTTPS</Label></FlexItem>
                                    )}
                                    {route.hasHeaders && (
                                        <FlexItem><Label color="blue" isCompact>{_("Header")}</Label></FlexItem>
                                    )}
                                </Flex>
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

            {/* Header */}
            <PageSection>
                <Flex
                    justifyContent={{ default: 'justifyContentSpaceBetween' }}
                    alignItems={{ default: 'alignItemsCenter' }}
                >
                    <FlexItem>
                        <Flex alignItems={{ default: 'alignItemsCenter' }}>
                            <FlexItem>
                                <Title headingLevel="h1">{_("Caddy Reverse Proxy")}</Title>
                            </FlexItem>
                            <FlexItem>
                                {connected
                                    ? <Label color="green" icon={<CheckCircleIcon />}>{_("API online")}</Label>
                                    : <Label color="red" icon={<ExclamationCircleIcon />}>{_("API terputus")}</Label>}
                            </FlexItem>
                        </Flex>
                        <Content component="p">
                            {_("Kelola host reverse proxy, upstream backend, dan sertifikat TLS otomatis melalui Caddy.")}
                        </Content>
                    </FlexItem>
                    <FlexItem>
                        <Flex>
                            <FlexItem>
                                <Button
                                    variant="secondary"
                                    icon={<SyncAltIcon />}
                                    onClick={loadConfig}
                                    isLoading={loading}
                                >
                                    {_("Segarkan")}
                                </Button>
                            </FlexItem>
                            <FlexItem>
                                <Button variant="secondary" icon={<RedoIcon />} onClick={handleReloadCaddy}>
                                    {_("Reload Caddy")}
                                </Button>
                            </FlexItem>
                        </Flex>
                    </FlexItem>
                </Flex>
            </PageSection>

            {/* Tab */}
            <PageSection type="tabs">
                <Tabs
                    activeKey={activeTab}
                    onSelect={(_event, tabIndex) => setActiveTab(tabIndex)}
                    usePageInsets
                    aria-label={_("Bagian plugin Caddy")}
                >
                    <Tab eventKey={0} title={<TabTitleText>{_("Reverse proxy")}</TabTitleText>} aria-label={_("Reverse proxy")} />
                    <Tab eventKey={1} title={<TabTitleText>{_("Konfigurasi JSON")}</TabTitleText>} aria-label={_("Konfigurasi JSON")} />
                    <Tab eventKey={2} title={<TabTitleText>{_("Pratinjau Caddyfile")}</TabTitleText>} aria-label={_("Pratinjau Caddyfile")} />
                </Tabs>
            </PageSection>

            <PageSection>
                {/* TAB 0: Daftar reverse proxy */}
                {activeTab === 0 && (
                    <Card>
                        <CardBody>
                            <Toolbar id="caddy-toolbar">
                                <ToolbarContent>
                                    <ToolbarItem>
                                        <SearchInput
                                            id="proxy-search"
                                            placeholder={_("Cari domain, upstream, atau ID")}
                                            value={searchQuery}
                                            onChange={(_event, val) => setSearchQuery(val)}
                                            onClear={() => setSearchQuery('')}
                                        />
                                    </ToolbarItem>
                                    <ToolbarItem>
                                        <Button variant="primary" icon={<PlusCircleIcon />} onClick={openAddModal}>
                                            {_("Tambah proxy")}
                                        </Button>
                                    </ToolbarItem>
                                    <ToolbarItem align={{ default: 'alignEnd' }}>
                                        {cockpit.format(_("$0 dari $1 proxy"), filteredRoutes.length, routes.length)}
                                    </ToolbarItem>
                                </ToolbarContent>
                            </Toolbar>
                            {renderRouteList()}
                        </CardBody>
                    </Card>
                )}

                {/* TAB 1: Raw JSON */}
                {activeTab === 1 && (
                    <Card>
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
                    <Card>
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

            {/* Modal tambah / edit */}
            <Modal
                variant="medium"
                isOpen={isModalOpen}
                onClose={closeModal}
                aria-labelledby="modal-route-title"
            >
                <ModalHeader
                    title={editingRouteId ? _("Edit reverse proxy") : _("Tambah reverse proxy")}
                    labelId="modal-route-title"
                />
                <ModalBody>
                    <Form id="route-form" onSubmit={handleSaveRoute} isHorizontal>
                        <FormGroup label={_("Domain / Hostname")} isRequired fieldId="route-domains">
                            <TextInput
                                id="route-domains"
                                isRequired
                                placeholder="app.domain.com, api.domain.com"
                                value={formDomains}
                                onChange={(_event, val) => setFormDomains(val)}
                            />
                            <FormHelperText>
                                <HelperText>
                                    <HelperTextItem>
                                        {_("Pisahkan dengan koma untuk beberapa domain pada upstream yang sama.")}
                                    </HelperTextItem>
                                </HelperText>
                            </FormHelperText>
                        </FormGroup>

                        <FormGroup label={_("Target upstream")} isRequired fieldId="route-upstreams">
                            <TextInput
                                id="route-upstreams"
                                isRequired
                                placeholder="127.0.0.1:3000, 192.168.1.50:8080"
                                value={formUpstreams}
                                onChange={(_event, val) => setFormUpstreams(val)}
                            />
                            <FormHelperText>
                                <HelperText>
                                    <HelperTextItem>
                                        {_("Format host:port. Pisahkan dengan koma untuk load balancing.")}
                                    </HelperTextItem>
                                </HelperText>
                            </FormHelperText>
                        </FormGroup>

                        <FormGroup label={_("Route ID")} fieldId="route-id">
                            <TextInput
                                id="route-id"
                                placeholder="proxy_1"
                                value={formId}
                                {...(editingRouteId ? { readOnlyVariant: 'default' } : {})}
                                onChange={(_event, val) => setFormId(val)}
                            />
                        </FormGroup>

                        <FormGroup role="group" fieldId="route-headers" label={_("Opsi")}>
                            <Checkbox
                                id="route-headers"
                                label={_("Teruskan header klien")}
                                description="Host, X-Real-IP, X-Forwarded-For, X-Forwarded-Proto"
                                isChecked={formHeaders}
                                onChange={(_event, val) => setFormHeaders(val)}
                            />
                        </FormGroup>
                    </Form>
                </ModalBody>
                <ModalFooter>
                    <Button variant="primary" type="submit" form="route-form" isLoading={formSubmitting} isDisabled={formSubmitting}>
                        {editingRouteId ? _("Simpan perubahan") : _("Tambah proxy")}
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
                    title={_("Hapus reverse proxy?")}
                    titleIconVariant="warning"
                    labelId="modal-delete-title"
                />
                <ModalBody>
                    {routeToDelete && cockpit.format(
                        _("Proxy untuk $0 akan dihapus dari konfigurasi Caddy."),
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