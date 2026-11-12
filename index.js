/**
 * Serveras Balance Tracker
 * SillyTavern & TauriTavern Extension to track and monitor balance from https://serveras.click/v1/balance
 */

import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

// Try to import SlashCommand if available
let SlashCommand = null;
let SlashCommandParser = null;
try {
    const scModule = await import('../../../slash-commands/SlashCommand.js');
    const scpModule = await import('../../../slash-commands/SlashCommandParser.js');
    SlashCommand = scModule.SlashCommand;
    SlashCommandParser = scpModule.SlashCommandParser;
} catch (e) {
    console.debug('[Serveras Balance] Slash commands not available or failed to load:', e);
}

const MODULE_NAME = 'serveras_balance_tracker';
const DEFAULT_URL = 'https://serveras.click/v1/balance';
const DEFAULT_RATIO = 1000000; // 1M credits = $1.00 USD
const DEFAULT_THRESHOLD = 5000000; // 5M credits alert threshold

// Runtime state
let intervalTimer = null;
let isFetching = false;
let sessionSpent = 0;
let lastBalanceBeforeGen = null;
let preGenTimestamp = 0;
let lastFetchError = null;

/**
 * Check if running under TauriTavern environment
 */
function isTauriHost() {
    return Boolean(
        window.__TAURITAVERN__ ||
        window.__TAURITAVERN_HOST__ ||
        window.__TAURI__ ||
        window.__TAURITAVERN_MAIN_READY__
    );
}

/**
 * Default extension settings
 */
const defaultSettings = {
    enabled: true,
    apiKey: '',
    apiUrl: DEFAULT_URL,
    useCorsProxy: true,
    customProxyUrl: '', // Optional proxy prefix, e.g. "http://localhost:8008/proxy/"
    autoRefreshOnGen: true,
    autoRefreshInterval: 10, // minutes (0 = disabled)
    displayFormat: 'credits_compact', // 'credits_compact', 'credits_full', 'currency', 'both'
    creditsPerDollar: DEFAULT_RATIO,
    lowBalanceNotify: true,
    lowBalanceThreshold: DEFAULT_THRESHOLD,
    showInStatusBar: true,
    showFloatingBadge: true,
    lastKnownBalance: null,
    lastCost: null,
    lastUpdated: null,
    history: []
};

/**
 * Access settings with defaults
 */
function getSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = {};
    }
    for (const [k, v] of Object.entries(defaultSettings)) {
        if (extension_settings[MODULE_NAME][k] === undefined) {
            extension_settings[MODULE_NAME][k] = v;
        }
    }
    return extension_settings[MODULE_NAME];
}

/**
 * Persist settings safely
 */
function saveSettings() {
    try {
        saveSettingsDebounced();
    } catch (e) {
        console.debug('[Serveras Balance] saveSettingsDebounced error:', e);
    }
}

/**
 * Number & Currency Formatting Helpers
 */
function formatNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return '—';
    return Number(num).toLocaleString('en-US');
}

function formatCompact(num) {
    if (num === null || num === undefined || isNaN(num)) return '—';
    const abs = Math.abs(num);
    if (abs >= 1_000_000_000) {
        return (num / 1_000_000_000).toFixed(2) + 'B';
    }
    if (abs >= 1_000_000) {
        return (num / 1_000_000).toFixed(2) + 'M';
    }
    if (abs >= 1_000) {
        return (num / 1_000).toFixed(1) + 'k';
    }
    return String(num);
}

function formatCurrency(credits, ratio = DEFAULT_RATIO) {
    if (credits === null || credits === undefined || isNaN(credits)) return '—';
    const r = Number(ratio) > 0 ? Number(ratio) : DEFAULT_RATIO;
    const usd = Number(credits) / r;
    return '$' + usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function formatDisplay(credits, format = 'credits_compact', ratio = DEFAULT_RATIO) {
    if (credits === null || credits === undefined || isNaN(credits)) return '—';
    switch (format) {
        case 'credits_full':
            return formatNumber(credits) + ' credits';
        case 'currency':
            return formatCurrency(credits, ratio);
        case 'both':
            return `${formatCompact(credits)} (${formatCurrency(credits, ratio)})`;
        case 'credits_compact':
        default:
            return formatCompact(credits);
    }
}

function formatRelativeTime(ts) {
    if (!ts) return 'Never';
    const elapsed = Math.floor((Date.now() - ts) / 1000);
    if (elapsed < 5) return 'Just now';
    if (elapsed < 60) return `${elapsed}s ago`;
    if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
    return new Date(ts).toLocaleTimeString();
}

/**
 * Auto-detect API key from SillyTavern or TauriTavern secret store / DOM / settings
 */
async function detectSillyTavernApiKey() {
    try {
        // 1. Check other extension settings (e.g. summaryception which uses serveras.click)
        const scKey = extension_settings?.summaryception?.openaiKey?.trim();
        if (scKey && scKey.startsWith('asai_')) return scKey;

        // 2. Check connection manager profiles if present
        const connProfiles = extension_settings?.connectionManager?.profiles;
        if (Array.isArray(connProfiles)) {
            for (const p of connProfiles) {
                if (p.custom_url?.includes('serveras.click') && p.api_key) {
                    return p.api_key.trim();
                }
            }
        }

        // 3. Check DOM inputs (SillyTavern classic)
        const domKey = $('#api_key_openai').val()?.trim() || $('#api_key_chatcompletions').val()?.trim();
        if (domKey && domKey.startsWith('asai_')) return domKey;

        // 4. Check OpenAI client module if present
        if (window.oai_settings && window.oai_settings.api_key_openai) {
            const k = String(window.oai_settings.api_key_openai).trim();
            if (k && k.startsWith('asai_')) return k;
        }

        // 5. Check DOM password fields
        const proxyPass = $('#proxy_password').val()?.trim();
        if (proxyPass && proxyPass.startsWith('asai_')) return proxyPass;

        // 6. Query TauriTavern / SillyTavern Secret Store via IPC or /api/secrets/find
        const candidateKeys = ['api_key_openai', 'api_key_custom', 'proxy_password'];
        for (const key of candidateKeys) {
            try {
                // Check via window.__TAURITAVERN__.invoke if available
                if (window.__TAURITAVERN__?.invoke?.safeInvoke) {
                    const res = await window.__TAURITAVERN__.invoke.safeInvoke('find_secret', { dto: { key } });
                    const val = typeof res === 'object' ? res?.value?.trim() : String(res || '').trim();
                    if (val && val.startsWith('asai_')) return val;
                    if (val && !domKey) return val;
                }

                // Check via fetch /api/secrets/find
                const resp = await fetch('/api/secrets/find', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key })
                });
                if (resp.ok) {
                    const data = await resp.json();
                    const val = data?.value?.trim();
                    if (val && val.startsWith('asai_')) return val;
                    if (val && !domKey) return val;
                }
            } catch {
                // Continue to next secret candidate
            }
        }

        // 7. Check /api/secrets/view
        try {
            const resp = await fetch('/api/secrets/view', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            if (resp.ok) {
                const secrets = await resp.json();
                if (secrets && typeof secrets === 'object') {
                    for (const val of Object.values(secrets)) {
                        if (typeof val === 'string' && val.trim().startsWith('asai_')) {
                            return val.trim();
                        }
                    }
                    if (secrets.api_key_openai?.trim()) return secrets.api_key_openai.trim();
                    if (secrets.api_key_custom?.trim()) return secrets.api_key_custom.trim();
                }
            }
        } catch {
            // Ignore view error
        }

        if (scKey) return scKey;
        if (domKey && !domKey.includes('•')) return domKey;
    } catch (e) {
        console.debug('[Serveras Balance] Key auto-detect failed:', e);
    }
    return '';
}

/**
 * Get effective API key (configured or auto-detected)
 */
async function getEffectiveApiKey() {
    const s = getSettings();
    if (s.apiKey && s.apiKey.trim()) {
        return s.apiKey.trim();
    }
    const detected = await detectSillyTavernApiKey();
    if (detected) {
        s.apiKey = detected;
        saveSettings();
        return detected;
    }
    return '';
}

/**
 * Build list of candidate request URLs based on settings and environment
 */
function buildFetchCandidates(targetUrl, settings) {
    const candidates = [];
    const isTauri = isTauriHost();

    // 1. User-configured Custom Proxy (Highest precedence if specified)
    if (settings.customProxyUrl && settings.customProxyUrl.trim()) {
        const customPrefix = settings.customProxyUrl.trim().replace(/\/+$/, '');
        candidates.push({
            url: `${customPrefix}/${targetUrl}`,
            desc: `Custom Proxy (${customPrefix})`,
            isProxy: true
        });
    }

    // 2. Standard SillyTavern relative CORS proxy
    if (settings.useCorsProxy) {
        candidates.push({
            url: `/proxy/${targetUrl}`,
            desc: 'SillyTavern Server Proxy (/proxy/)',
            isProxy: true,
            isRelativeProxy: true
        });
    }

    // 3. Direct Fetch
    candidates.push({
        url: targetUrl,
        desc: 'Direct Endpoint',
        isProxy: false
    });

    // 4. In TauriTavern, auto-probe localhost SillyTavern proxy if running
    if (isTauri) {
        candidates.push({
            url: `http://localhost:8000/proxy/${targetUrl}`,
            desc: 'Local SillyTavern (default port 8000)',
            isProxy: true
        });
        candidates.push({
            url: `http://localhost:8008/proxy/${targetUrl}`,
            desc: 'Local SillyTavern (port 8008)',
            isProxy: true
        });
    }

    return candidates;
}

/**
 * Fetch balance from endpoint with smart retry across candidate URLs
 */
async function fetchBalance({ silent = false, isPostGen = false } = {}) {
    if (isFetching) return null;
    const settings = getSettings();

    if (!settings.enabled) return null;

    const apiKey = await getEffectiveApiKey();
    if (!apiKey) {
        if (!silent) {
            toastr?.warning?.('Please configure or auto-detect your Serveras API key.', 'Serveras Balance');
        }
        updateUI();
        return null;
    }

    isFetching = true;
    updateSpinners(true);

    try {
        const targetUrl = (settings.apiUrl || DEFAULT_URL).trim();
        const candidates = buildFetchCandidates(targetUrl, settings);
        let lastErrorText = '';
        let successfulResp = null;
        let usedCandidate = null;

        for (const candidate of candidates) {
            try {
                console.debug(`[Serveras Balance] Attempting fetch via: ${candidate.desc} (${candidate.url})`);
                const resp = await fetch(candidate.url, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Accept': 'application/json'
                    }
                });

                // If candidate returned 404 with "Unsupported endpoint: /proxy/" (TauriTavern missing route),
                // do NOT consider this a fatal error—skip to next candidate!
                if (!resp.ok && resp.status === 404 && candidate.isRelativeProxy) {
                    const text = await resp.text();
                    if (text.includes('Unsupported endpoint') || text.includes('Cannot GET /proxy')) {
                        console.debug('[Serveras Balance] Host does not support relative /proxy/, skipping to next candidate.');
                        continue;
                    }
                }

                if (resp.status === 401) {
                    const errBody = await resp.text();
                    let detail = 'Invalid API Key';
                    try {
                        const j = JSON.parse(errBody);
                        detail = j.detail || j.message || detail;
                    } catch { /* ignore */ }
                    if (!silent) toastr?.error?.(`Authentication Failed: ${detail}`, 'Serveras Balance');
                    throw new Error(`Authentication Failed (HTTP 401): ${detail}`);
                }

                if (resp.ok) {
                    successfulResp = resp;
                    usedCandidate = candidate;
                    break;
                } else {
                    lastErrorText = `HTTP ${resp.status}: ${resp.statusText || 'Error'}`;
                }
            } catch (fetchErr) {
                // If it's an authentication error, stop immediately
                if (fetchErr.message && fetchErr.message.includes('Authentication Failed')) {
                    throw fetchErr;
                }
                const errStr = String(fetchErr?.message || fetchErr);
                lastErrorText = errStr;
                console.debug(`[Serveras Balance] Candidate ${candidate.desc} failed:`, fetchErr);
                // Continue to next candidate
            }
        }

        if (!successfulResp) {
            const isTauri = isTauriHost();
            let diagnosticMsg = lastErrorText || 'Could not connect to balance endpoint.';
            if (isTauri && (!settings.customProxyUrl || !settings.customProxyUrl.trim())) {
                diagnosticMsg = 'TauriTavern CORS Restriction: Direct access to serveras.click is blocked by browser CORS policy. Set a Custom Proxy URL (e.g. http://localhost:8008/proxy/) in Serveras Balance settings.';
            }

            lastFetchError = diagnosticMsg;
            if (!silent) {
                toastr?.error?.(diagnosticMsg, 'Serveras Balance');
            }
            throw new Error(diagnosticMsg);
        }

        lastFetchError = null;
        const data = await successfulResp.json();
        const availableCredits = data.available_credits ?? data.credits ?? data.balance;

        if (availableCredits === undefined || availableCredits === null) {
            throw new Error('Response JSON missing available_credits field');
        }

        const newBalance = Number(availableCredits);
        const prevBalance = settings.lastKnownBalance !== null ? Number(settings.lastKnownBalance) : null;
        let delta = null;

        if (prevBalance !== null) {
            delta = newBalance - prevBalance;
        }

        let cost = 0;
        if (delta !== null && delta < 0) {
            cost = Math.abs(delta);
            sessionSpent += cost;
            settings.lastCost = cost;
        }

        settings.lastKnownBalance = newBalance;
        settings.lastUpdated = Date.now();

        // Push to history
        if (!Array.isArray(settings.history)) {
            settings.history = [];
        }

        settings.history.unshift({
            timestamp: Date.now(),
            balance: newBalance,
            delta: delta,
            cost: cost,
            isGen: isPostGen,
            source: usedCandidate?.desc || 'online'
        });

        // Cap history to 20 items
        if (settings.history.length > 20) {
            settings.history = settings.history.slice(0, 20);
        }

        saveSettings();
        updateUI();

        // Low balance notification
        if (settings.lowBalanceNotify && newBalance <= (Number(settings.lowBalanceThreshold) || DEFAULT_THRESHOLD)) {
            toastr?.warning?.(
                `Warning: Available balance is low (${formatCompact(newBalance)} credits)!`,
                'Serveras Balance'
            );
        }

        if (!silent) {
            toastr?.success?.(
                `Balance: ${formatCompact(newBalance)} credits (${formatCurrency(newBalance, settings.creditsPerDollar)})`,
                'Serveras Balance'
            );
        }

        return { newBalance, delta, cost };
    } catch (err) {
        console.error('[Serveras Balance] Error fetching balance:', err);
        updateUI();
        return null;
    } finally {
        isFetching = false;
        updateSpinners(false);
    }
}

/**
 * Toggle spinning state on refresh buttons
 */
function updateSpinners(spinning) {
    $('.serveras-refresh-icon').toggleClass('serveras-spinning', spinning);
}

/**
 * Update all UI widgets
 */
function updateUI() {
    const s = getSettings();
    const balance = s.lastKnownBalance;
    const cost = s.lastCost;
    const ratio = s.creditsPerDollar || DEFAULT_RATIO;
    const isLow = balance !== null && balance <= (Number(s.lowBalanceThreshold) || DEFAULT_THRESHOLD);

    const formattedCompact = formatCompact(balance);
    const formattedFull = formatNumber(balance);
    const formattedCurrencyVal = formatCurrency(balance, ratio);
    const formattedDisplayVal = formatDisplay(balance, s.displayFormat, ratio);

    // 1. Update Drawer Settings UI
    $('#serveras_drawer_balance_large').text(formattedFull !== '—' ? formattedFull : '—');
    $('#serveras_drawer_currency_est').text(formattedCurrencyVal !== '—' ? formattedCurrencyVal : '');
    $('#serveras_drawer_last_updated').text(`Updated: ${formatRelativeTime(s.lastUpdated)}`);

    if (cost && cost > 0) {
        $('#serveras_drawer_last_cost').html(`
            <span class="serveras-cost-pill">
                <i class="fa-solid fa-arrow-down"></i> ${formatCompact(cost)} credits (${formatCurrency(cost, ratio)})
            </span>
        `);
    } else {
        $('#serveras_drawer_last_cost').html('<span class="serveras-cost-pill is-zero">—</span>');
    }

    if (sessionSpent > 0) {
        $('#serveras_drawer_session_spent').html(`
            <span class="serveras-session-pill">
                ${formatCompact(sessionSpent)} credits (${formatCurrency(sessionSpent, ratio)})
            </span>
        `);
    } else {
        $('#serveras_drawer_session_spent').html('<span class="serveras-session-pill">0 credits</span>');
    }

    // Diagnostic / Error warning alert in drawer if any
    const $diagBox = $('#serveras_drawer_diagnostic');
    if ($diagBox.length) {
        if (lastFetchError) {
            $diagBox.html(`
                <div class="serveras-warning-box">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <div style="flex: 1;">
                        <b>Connection Notice:</b><br/>
                        <span>${lastFetchError}</span>
                    </div>
                </div>
            `).show();
        } else {
            $diagBox.empty().hide();
        }
    }

    // Render history table
    renderHistoryTable(s.history, ratio);

    // 2. Update OpenCode IDE Status Bar Widget
    const statusBarItem = document.getElementById('serveras-sb-item');
    if (statusBarItem) {
        const valSpan = statusBarItem.querySelector('.serveras-sb-val');
        const costSpan = statusBarItem.querySelector('.serveras-sb-cost');
        if (valSpan) {
            valSpan.textContent = formattedDisplayVal;
            valSpan.classList.toggle('serveras-low-balance', isLow);
        }
        if (costSpan) {
            if (cost && cost > 0) {
                costSpan.textContent = `-${formatCompact(cost)}`;
                costSpan.style.display = 'inline-block';
            } else {
                costSpan.style.display = 'none';
            }
        }
        statusBarItem.title = `Serveras Balance: ${formattedFull} credits (${formattedCurrencyVal})\nLast Prompt Cost: ${cost ? formatCompact(cost) : '0'} credits\nSession Spent: ${formatCompact(sessionSpent)} credits\n(Click to refresh)`;
        statusBarItem.style.display = s.showInStatusBar ? 'inline-flex' : 'none';
    }

    // 3. Update Floating Badge Widget
    const floatingBadge = document.getElementById('serveras-floating-badge');
    if (floatingBadge) {
        const badgeVal = floatingBadge.querySelector('.serveras-badge-val');
        const badgeCost = floatingBadge.querySelector('.serveras-badge-cost');
        if (badgeVal) {
            badgeVal.textContent = formattedDisplayVal;
            badgeVal.classList.toggle('serveras-low-balance', isLow);
        }
        if (badgeCost) {
            if (cost && cost > 0) {
                badgeCost.textContent = `-${formatCompact(cost)}`;
                badgeCost.style.display = 'inline-block';
            } else {
                badgeCost.style.display = 'none';
            }
        }
        floatingBadge.title = `Serveras Balance: ${formattedFull} credits (${formattedCurrencyVal})\n(Click to refresh)`;
        floatingBadge.style.display = s.showFloatingBadge ? 'flex' : 'none';
    }
}

/**
 * Render History Table
 */
function renderHistoryTable(history, ratio) {
    const $tbody = $('#serveras_history_tbody');
    if (!$tbody.length) return;

    if (!Array.isArray(history) || history.length === 0) {
        $tbody.html('<tr><td colspan="4" class="serveras-history-empty">No balance checks recorded yet.</td></tr>');
        return;
    }

    const rows = history.map((item) => {
        const timeStr = new Date(item.timestamp).toLocaleTimeString();
        let deltaHtml = '<span style="opacity: 0.5;">—</span>';
        if (item.delta !== null && item.delta !== undefined) {
            if (item.delta < 0) {
                deltaHtml = `<span class="serveras-history-delta-neg">-${formatCompact(Math.abs(item.delta))}</span>`;
            } else if (item.delta > 0) {
                deltaHtml = `<span class="serveras-history-delta-pos">+${formatCompact(item.delta)}</span>`;
            } else {
                deltaHtml = '<span style="opacity: 0.5;">0</span>';
            }
        }

        const tag = item.isGen ? '<span title="Post-generation check" style="opacity:0.8;">[Gen]</span>' : '<span title="Manual/Scheduled check" style="opacity:0.6;">[Poll]</span>';

        return `
            <tr>
                <td style="opacity: 0.75;">${timeStr}</td>
                <td>${deltaHtml}</td>
                <td style="font-weight: 500;">${formatCompact(item.balance)}</td>
                <td>${tag}</td>
            </tr>
        `;
    }).join('');

    $tbody.html(rows);
}

/**
 * Inject the Settings Drawer UI into #extensions_settings2
 */
function injectDrawerUI() {
    if (document.getElementById('serveras-balance-settings-container')) return;

    const s = getSettings();
    const isTauri = isTauriHost();
    const envBadge = isTauri
        ? '<span class="serveras-env-tag is-tauri" title="Running in TauriTavern Native Runtime"><i class="fa-solid fa-mobile-screen"></i> TauriTavern</span>'
        : '<span class="serveras-env-tag is-st" title="Running in SillyTavern Web"><i class="fa-solid fa-globe"></i> SillyTavern</span>';

    const drawerHtml = `
    <div id="serveras-balance-settings-container" class="extension_container">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><i class="fa-solid fa-wallet" style="color: #f9e2af; margin-right: 6px;"></i> Serveras Balance Tracker</b>
                <div style="display: flex; align-items: center; gap: 8px;">
                    ${envBadge}
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
            </div>
            <div class="inline-drawer-content">
                <div class="serveras-drawer-panel">
                    
                    <!-- Hero Card -->
                    <div class="serveras-hero-card">
                        <div class="serveras-hero-header">
                            <span class="serveras-hero-title">
                                <i class="fa-solid fa-coins" style="color: #f9e2af;"></i> Available Balance
                            </span>
                            <div class="serveras-hero-actions">
                                <button type="button" class="serveras-refresh-btn" id="serveras_btn_refresh">
                                    <i class="fa-solid fa-rotate serveras-refresh-icon"></i> Refresh
                                </button>
                            </div>
                        </div>

                        <div class="serveras-hero-main">
                            <div class="serveras-balance-large">
                                <span id="serveras_drawer_balance_large">—</span>
                                <span class="serveras-currency-est" id="serveras_drawer_currency_est"></span>
                            </div>
                            <span class="serveras-subtext" id="serveras_drawer_last_updated">Never updated</span>
                        </div>

                        <div class="serveras-stats-row">
                            <div class="serveras-stat-item">
                                <span class="serveras-stat-label">Last Generation Cost</span>
                                <div id="serveras_drawer_last_cost">
                                    <span class="serveras-cost-pill is-zero">—</span>
                                </div>
                            </div>
                            <div class="serveras-stat-item">
                                <span class="serveras-stat-label">Session Total Spent</span>
                                <div id="serveras_drawer_session_spent">
                                    <span class="serveras-session-pill">0 credits</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Connection / Diagnostic Alert Box -->
                    <div id="serveras_drawer_diagnostic" style="display: none;"></div>

                    <!-- Configuration Section -->
                    <div class="serveras-section-title">
                        <i class="fa-solid fa-sliders"></i> Configuration
                    </div>

                    <!-- API Key -->
                    <div class="serveras-field-group">
                        <label class="serveras-field-label" for="serveras_input_api_key">
                            <span>API Key:</span>
                            <span class="serveras-subtext">(Stored securely in extension settings)</span>
                        </label>
                        <div class="serveras-input-with-button">
                            <div class="serveras-key-wrapper">
                                <input type="password" id="serveras_input_api_key" class="text_pole" placeholder="asai_sk_..." autocomplete="off" value="${s.apiKey || ''}" />
                                <i class="fa-solid fa-eye serveras-eye-toggle" id="serveras_toggle_key_eye" title="Show/Hide API Key"></i>
                            </div>
                            <button type="button" class="serveras-btn-small" id="serveras_btn_autodetect" title="Auto-detect API key from active settings or secret manager">
                                <i class="fa-solid fa-wand-magic-sparkles"></i> Auto-Fill
                            </button>
                        </div>
                    </div>

                    <!-- API Endpoint -->
                    <div class="serveras-field-group">
                        <label class="serveras-field-label" for="serveras_input_api_url">Balance Endpoint URL:</label>
                        <input type="text" id="serveras_input_api_url" class="text_pole" value="${s.apiUrl || DEFAULT_URL}" placeholder="https://serveras.click/v1/balance" />
                    </div>

                    <!-- Custom Proxy URL (Essential for TauriTavern & Mobile) -->
                    <div class="serveras-field-group">
                        <label class="serveras-field-label" for="serveras_input_custom_proxy">
                            <span>Custom CORS Proxy URL (Optional):</span>
                            <span class="serveras-subtext">${isTauri ? '(Recommended for TauriTavern / Mobile)' : '(Optional)'}</span>
                        </label>
                        <div class="serveras-input-with-button">
                            <input type="text" id="serveras_input_custom_proxy" class="text_pole" value="${s.customProxyUrl || ''}" placeholder="e.g. http://localhost:8008/proxy/ or http://192.168.1.235:8008/proxy/" />
                            <button type="button" class="serveras-btn-small" id="serveras_btn_detect_proxy" title="Auto-detect local SillyTavern server proxy">
                                <i class="fa-solid fa-network-wired"></i> Auto-Detect
                            </button>
                        </div>
                        <small style="opacity: 0.65; font-size: 11px; margin-top: 2px;">
                            In TauriTavern, direct browser requests are blocked by CORS. You can route through your SillyTavern server (e.g. <code>http://localhost:8008/proxy/</code>) or leave blank if using a dev server.
                        </small>
                    </div>

                    <!-- Display Format -->
                    <div class="serveras-field-group">
                        <label class="serveras-field-label" for="serveras_select_format">Display Format:</label>
                        <select id="serveras_select_format" class="text_pole">
                            <option value="credits_compact" ${s.displayFormat === 'credits_compact' ? 'selected' : ''}>Compact Credits (e.g. 188.17M)</option>
                            <option value="credits_full" ${s.displayFormat === 'credits_full' ? 'selected' : ''}>Full Number (e.g. 188,174,424 credits)</option>
                            <option value="currency" ${s.displayFormat === 'currency' ? 'selected' : ''}>USD Currency (e.g. $188.17)</option>
                            <option value="both" ${s.displayFormat === 'both' ? 'selected' : ''}>Both (188.17M ($188.17))</option>
                        </select>
                    </div>

                    <!-- Ratio & Threshold Row -->
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <div class="serveras-field-group" style="flex: 1; min-width: 140px;">
                            <label class="serveras-field-label" for="serveras_input_ratio">Credits per $1.00 USD:</label>
                            <input type="number" id="serveras_input_ratio" class="text_pole" min="1" value="${s.creditsPerDollar || DEFAULT_RATIO}" />
                        </div>
                        <div class="serveras-field-group" style="flex: 1; min-width: 140px;">
                            <label class="serveras-field-label" for="serveras_input_threshold">Low Balance Alert Threshold:</label>
                            <input type="number" id="serveras_input_threshold" class="text_pole" min="0" value="${s.lowBalanceThreshold || DEFAULT_THRESHOLD}" />
                        </div>
                    </div>

                    <!-- Auto-refresh interval -->
                    <div class="serveras-field-group">
                        <label class="serveras-field-label" for="serveras_select_interval">Periodic Background Refresh:</label>
                        <select id="serveras_select_interval" class="text_pole">
                            <option value="0" ${s.autoRefreshInterval === 0 ? 'selected' : ''}>Disabled</option>
                            <option value="1" ${s.autoRefreshInterval === 1 ? 'selected' : ''}>Every 1 minute</option>
                            <option value="5" ${s.autoRefreshInterval === 5 ? 'selected' : ''}>Every 5 minutes</option>
                            <option value="10" ${s.autoRefreshInterval === 10 ? 'selected' : ''}>Every 10 minutes</option>
                            <option value="30" ${s.autoRefreshInterval === 30 ? 'selected' : ''}>Every 30 minutes</option>
                        </select>
                    </div>

                    <!-- Checkboxes -->
                    <label class="serveras-checkbox-row">
                        <input type="checkbox" id="serveras_chk_autogen" ${s.autoRefreshOnGen ? 'checked' : ''} />
                        <span>Auto-refresh & track prompt cost after every message generation</span>
                    </label>

                    <label class="serveras-checkbox-row">
                        <input type="checkbox" id="serveras_chk_proxy" ${s.useCorsProxy ? 'checked' : ''} />
                        <span>Use host server proxy (Prevents browser CORS errors on SillyTavern)</span>
                    </label>

                    <label class="serveras-checkbox-row">
                        <input type="checkbox" id="serveras_chk_low_notify" ${s.lowBalanceNotify ? 'checked' : ''} />
                        <span>Notify with warning when balance is below threshold</span>
                    </label>

                    <label class="serveras-checkbox-row">
                        <input type="checkbox" id="serveras_chk_status_bar" ${s.showInStatusBar ? 'checked' : ''} />
                        <span>Show balance in Status Bar (OpenCode IDE / Theme)</span>
                    </label>

                    <label class="serveras-checkbox-row">
                        <input type="checkbox" id="serveras_chk_floating_badge" ${s.showFloatingBadge ? 'checked' : ''} />
                        <span>Show floating top widget</span>
                    </label>

                    <!-- History Section -->
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 10px;">
                        <span class="serveras-section-title" style="margin: 0;">
                            <i class="fa-solid fa-clock-rotate-left"></i> Recent Activity Log
                        </span>
                        <button type="button" class="serveras-btn-small" id="serveras_btn_clear_history" style="font-size: 10.5px; padding: 2px 6px;">
                            <i class="fa-solid fa-trash-can"></i> Clear
                        </button>
                    </div>

                    <div class="serveras-history-wrapper">
                        <table class="serveras-history-table">
                            <thead>
                                <tr>
                                    <th>Time</th>
                                    <th>Cost / Delta</th>
                                    <th>Balance</th>
                                    <th>Type</th>
                                </tr>
                            </thead>
                            <tbody id="serveras_history_tbody">
                                <tr><td colspan="4" class="serveras-history-empty">No balance checks recorded yet.</td></tr>
                            </tbody>
                        </table>
                    </div>

                </div>
            </div>
        </div>
    </div>
    `;

    $('#extensions_settings2').append(drawerHtml);

    // Wire events
    $('#serveras_btn_refresh').on('click', () => fetchBalance({ silent: false }));

    $('#serveras_input_api_key').on('input', function() {
        s.apiKey = $(this).val().trim();
        saveSettings();
        updateUI();
    });

    $('#serveras_toggle_key_eye').on('click', function() {
        const input = document.getElementById('serveras_input_api_key');
        if (!input) return;
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        $(this).toggleClass('fa-eye', !isPassword).toggleClass('fa-eye-slash', isPassword);
    });

    $('#serveras_btn_autodetect').on('click', async function() {
        const detected = await detectSillyTavernApiKey();
        if (detected) {
            $('#serveras_input_api_key').val(detected);
            s.apiKey = detected;
            saveSettings();
            toastr?.success?.('API Key auto-detected and filled!', 'Serveras Balance');
            fetchBalance({ silent: false });
        } else {
            toastr?.info?.('Could not auto-detect API key. Please paste it manually.', 'Serveras Balance');
        }
    });

    $('#serveras_input_custom_proxy').on('input', function() {
        s.customProxyUrl = $(this).val().trim();
        saveSettings();
    });

    $('#serveras_btn_detect_proxy').on('click', async function() {
        const candidates = [];

        // If running in a web browser with HTTP/HTTPS origin, include origin proxy first
        if (typeof window !== 'undefined' && window.location?.origin && /^https?:\/\//i.test(window.location.origin)) {
            candidates.push(`${window.location.origin.replace(/\/+$/, '')}/proxy/`);
        }

        // Standard SillyTavern default port (8000), followed by 8008
        candidates.push(
            'http://localhost:8000/proxy/',
            'http://127.0.0.1:8000/proxy/',
            'http://localhost:8008/proxy/',
            'http://127.0.0.1:8008/proxy/'
        );

        toastr?.info?.('Probing local SillyTavern proxy...', 'Serveras Balance');
        let found = null;
        for (const c of candidates) {
            try {
                const testUrl = c.replace(/\/proxy\/$/, '/version');
                const resp = await fetch(testUrl, { method: 'GET', signal: AbortSignal.timeout(1500) });
                if (resp.ok) {
                    found = c;
                    break;
                }
            } catch { /* continue */ }
        }

        if (found) {
            s.customProxyUrl = found;
            $('#serveras_input_custom_proxy').val(found);
            saveSettings();
            toastr?.success?.(`Found active SillyTavern proxy: ${found}`, 'Serveras Balance');
            fetchBalance({ silent: false });
        } else {
            toastr?.warning?.('Could not auto-detect a local SillyTavern server. You can enter the URL manually if SillyTavern is running on another IP.', 'Serveras Balance');
        }
    });

    $('#serveras_input_api_url').on('input', function() {
        s.apiUrl = $(this).val().trim() || DEFAULT_URL;
        saveSettings();
    });

    $('#serveras_select_format').on('change', function() {
        s.displayFormat = $(this).val();
        saveSettings();
        updateUI();
    });

    $('#serveras_input_ratio').on('input', function() {
        const val = Number($(this).val());
        if (val > 0) {
            s.creditsPerDollar = val;
            saveSettings();
            updateUI();
        }
    });

    $('#serveras_input_threshold').on('input', function() {
        const val = Number($(this).val());
        if (val >= 0) {
            s.lowBalanceThreshold = val;
            saveSettings();
            updateUI();
        }
    });

    $('#serveras_select_interval').on('change', function() {
        s.autoRefreshInterval = Number($(this).val());
        saveSettings();
        restartIntervalTimer();
    });

    $('#serveras_chk_autogen').on('change', function() {
        s.autoRefreshOnGen = $(this).is(':checked');
        saveSettings();
    });

    $('#serveras_chk_proxy').on('change', function() {
        s.useCorsProxy = $(this).is(':checked');
        saveSettings();
    });

    $('#serveras_chk_low_notify').on('change', function() {
        s.lowBalanceNotify = $(this).is(':checked');
        saveSettings();
    });

    $('#serveras_chk_status_bar').on('change', function() {
        s.showInStatusBar = $(this).is(':checked');
        saveSettings();
        updateUI();
    });

    $('#serveras_chk_floating_badge').on('change', function() {
        s.showFloatingBadge = $(this).is(':checked');
        saveSettings();
        updateUI();
    });

    $('#serveras_btn_clear_history').on('click', function() {
        s.history = [];
        saveSettings();
        renderHistoryTable([], s.creditsPerDollar);
        toastr?.info?.('Balance history cleared.', 'Serveras Balance');
    });

    updateUI();
}

/**
 * Inject OpenCode IDE Status Bar Widget
 */
function injectStatusBarWidget() {
    if (document.getElementById('serveras-sb-item')) return;

    const statusBar = document.getElementById('opencode-status-bar');
    if (!statusBar) return;

    document.body.classList.add('opencode-has-status-bar');

    const statusItem = document.createElement('span');
    statusItem.id = 'serveras-sb-item';
    statusItem.className = 'status-item serveras-status-item';
    statusItem.innerHTML = `
        <i class="fa-solid fa-coins"></i>
        <span class="serveras-sb-val">—</span>
        <span class="serveras-sb-cost" style="display:none;"></span>
    `;

    statusItem.addEventListener('click', (e) => {
        e.stopPropagation();
        fetchBalance({ silent: false });
    });

    // Insert into status-right
    const statusRight = statusBar.querySelector('.status-right');
    if (statusRight) {
        statusRight.insertBefore(statusItem, statusRight.firstChild);
    } else {
        statusBar.appendChild(statusItem);
    }

    updateUI();
}

/**
 * Inject Floating Widget with Layout ABI mobile surface support
 */
function injectFloatingWidget() {
    if (document.getElementById('serveras-floating-badge')) return;

    const badge = document.createElement('div');
    badge.id = 'serveras-floating-badge';
    badge.setAttribute('data-tt-mobile-surface', 'free-window');
    badge.innerHTML = `
        <i class="fa-solid fa-coins"></i>
        <span class="serveras-badge-val">—</span>
        <span class="serveras-badge-cost" style="display:none;"></span>
    `;

    badge.addEventListener('click', (e) => {
        e.stopPropagation();
        fetchBalance({ silent: false });
    });

    document.body.appendChild(badge);
    updateUI();
}

/**
 * Setup timer for periodic refresh
 */
function restartIntervalTimer() {
    if (intervalTimer) {
        clearInterval(intervalTimer);
        intervalTimer = null;
    }

    const s = getSettings();
    const minutes = Number(s.autoRefreshInterval);
    if (minutes > 0) {
        intervalTimer = setInterval(() => {
            fetchBalance({ silent: true });
        }, minutes * 60 * 1000);
    }
}

/**
 * Register Slash Commands
 */
function registerSlashCommands() {
    if (!SlashCommandParser || !SlashCommand) return;

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'balance',
        callback: async (namedArgs, unnamedArgs) => {
            const sub = String(unnamedArgs || '').trim();
            const s = getSettings();

            if (sub.toLowerCase() === 'refresh') {
                const res = await fetchBalance({ silent: false });
                if (res) {
                    return `Serveras Balance: ${formatCompact(res.newBalance)} credits (${formatCurrency(res.newBalance, s.creditsPerDollar)})`;
                }
                return 'Failed to refresh balance.';
            }

            if (sub.toLowerCase().startsWith('key ')) {
                const newKey = sub.slice(4).trim();
                s.apiKey = newKey;
                saveSettings();
                $('#serveras_input_api_key').val(newKey);
                toastr?.success?.('API Key updated.', 'Serveras Balance');
                fetchBalance({ silent: false });
                return 'Serveras API Key updated.';
            }

            if (sub.toLowerCase().startsWith('proxy ')) {
                const newProxy = sub.slice(6).trim();
                s.customProxyUrl = newProxy;
                saveSettings();
                $('#serveras_input_custom_proxy').val(newProxy);
                toastr?.success?.('Custom Proxy URL updated.', 'Serveras Balance');
                fetchBalance({ silent: false });
                return `Custom Proxy URL updated to: ${newProxy}`;
            }

            if (s.lastKnownBalance !== null) {
                const msg = `Serveras Balance: ${formatCompact(s.lastKnownBalance)} credits (${formatCurrency(s.lastKnownBalance, s.creditsPerDollar)})\nLast Generation Cost: ${s.lastCost ? formatCompact(s.lastCost) + ' credits' : '—'}\nSession Spent: ${formatCompact(sessionSpent)} credits`;
                toastr?.info?.(msg.replace(/\n/g, '<br>'), 'Serveras Balance');
                return msg;
            } else {
                fetchBalance({ silent: false });
                return 'Fetching Serveras balance...';
            }
        },
        aliases: ['serveras'],
        helpString: 'Check available balance on serveras.click. Usage: `/balance`, `/balance refresh`, `/balance proxy <url>`'
    }));
}

/**
 * Initialization lifecycle
 */
jQuery(async () => {
    console.log('[Serveras Balance Tracker] Initializing extension...');

    // Wait for host ready if in TauriTavern
    if (window.__TAURITAVERN__?.ready || window.__TAURITAVERN_MAIN_READY__) {
        try {
            await (window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__);
            console.log('[Serveras Balance Tracker] TauriTavern host ready.');
        } catch (e) {
            console.debug('[Serveras Balance Tracker] Host ready wait caught:', e);
        }
    }

    const settings = getSettings();

    // Auto-detect API key on launch if not set
    if (!settings.apiKey) {
        const detected = await detectSillyTavernApiKey();
        if (detected) {
            settings.apiKey = detected;
            saveSettings();
            console.log('[Serveras Balance Tracker] Auto-detected API key on startup.');
        }
    }

    // In TauriTavern, if customProxyUrl is empty, probe standard local SillyTavern proxy ports
    if (isTauriHost() && !settings.customProxyUrl) {
        for (const port of [8000, 8008]) {
            try {
                const resp = await fetch(`http://localhost:${port}/version`, {
                    method: 'GET',
                    signal: AbortSignal.timeout(1200)
                });
                if (resp.ok) {
                    settings.customProxyUrl = `http://localhost:${port}/proxy/`;
                    saveSettings();
                    console.log(`[Serveras Balance Tracker] Auto-configured local SillyTavern proxy on port ${port} for TauriTavern.`);
                    break;
                }
            } catch {
                // SillyTavern not running on this port, continue
            }
        }
    }

    // Inject UI
    injectDrawerUI();
    injectFloatingWidget();
    injectStatusBarWidget();

    // Watch for dynamic injection of OpenCode status bar if theme loads later
    const observer = new MutationObserver(() => {
        if (document.getElementById('opencode-status-bar') && !document.getElementById('serveras-sb-item')) {
            injectStatusBarWidget();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Register Slash Commands
    registerSlashCommands();

    // Setup periodic polling timer
    restartIntervalTimer();

    // Setup generation listeners for cost calculation
    const context = window['SillyTavern']?.getContext?.() || {};
    const evtSource = context.eventSource || window['eventSource'];
    const evtTypes = context.event_types || window['event_types'];

    if (evtSource && evtTypes) {
        // Snapshot on generation start
        evtSource.on(evtTypes.GENERATION_STARTED, () => {
            lastBalanceBeforeGen = settings.lastKnownBalance;
            preGenTimestamp = Date.now();
        });

        // Trigger balance check after generation to track cost
        const onGenComplete = () => {
            if (!settings.autoRefreshOnGen) return;
            // Delay 1.5s to let reverse proxy backend finalize billing records
            setTimeout(() => {
                fetchBalance({ silent: true, isPostGen: true });
            }, 1500);
        };

        if (evtTypes.CHARACTER_MESSAGE_RENDERED) {
            evtSource.on(evtTypes.CHARACTER_MESSAGE_RENDERED, onGenComplete);
        }
        if (evtTypes.GENERATION_ENDED) {
            evtSource.on(evtTypes.GENERATION_ENDED, onGenComplete);
        }
    }

    // Initial fetch on startup (after brief pause for SillyTavern setup)
    setTimeout(() => {
        fetchBalance({ silent: true });
    }, 2500);
});
