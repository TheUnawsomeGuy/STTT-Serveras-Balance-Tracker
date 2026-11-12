# Serveras Balance Tracker for SillyTavern & TauriTavern

A SillyTavern and TauriTavern extension designed to track and monitor available credits, generation costs, and usage from the `https://serveras.click/v1/balance` API endpoint.

## Features

- **Real-Time Balance Tracking**: Queries `https://serveras.click/v1/balance` using your API key (`Authorization: Bearer <API_KEY>`).
- **TauriTavern & Mobile Compatibility**:
  - Automatically detects TauriTavern environment lifecycle (`window.__TAURITAVERN__`).
  - Supports TauriTavern secret store resolution (`/api/secrets/find`, `/api/secrets/view`, and Tauri IPC `find_secret`).
  - Mobile safe-area insets (`--tt-inset-top`, `--tt-inset-right`) and `data-tt-mobile-surface="free-window"` positioning.
  - Multi-candidate CORS proxy resolution with fallback to direct fetch or local SillyTavern proxies.
- **Generation Cost Tracking**: Automatically calculates prompt and generation costs by tracking the balance delta after each AI response.
- **Session Spent Counter**: Displays the cumulative credits spent in the current browsing session.
- **Multiple Display Formats**:
  - Compact credits (e.g., `185.47M` or `150.2k`)
  - Full exact credits (e.g., `185,468,200 credits`)
  - Estimated USD value (e.g., `$185.47` based on configurable ratio, default 1,000,000 credits = $1.00 USD)
  - Both (e.g., `185.47M ($185.47)`)
- **Seamless UI Integration**:
  - **OpenCode IDE Theme**: Displays in the status bar (`#opencode-status-bar`) at the bottom with a coin badge and last cost pill.
  - **Standard SillyTavern & TauriTavern UI**: Displays as a sleek floating top badge widget.
  - **Extensions Drawer (`#extensions_settings2`)**: Full management panel with hero card, environment badge, quick refresh button, masked API key input, CORS proxy configuration with Auto-Detect, configuration toggles, and recent activity log.
- **Auto-Detection**: Can automatically detect and auto-fill your `asai_sk_...` key from existing SillyTavern settings, connection profiles, or TauriTavern Secret Store.
- **Slash Commands**:
  - `/balance`: Displays current balance, last prompt cost, and session spend.
  - `/balance refresh`: Forces an immediate balance query.
  - `/balance key <api_key>`: Saves and sets a new API key.
  - `/balance proxy <proxy_url>`: Sets custom CORS proxy URL or clears it (`/balance proxy clear`).
- **Low Balance Warning**: Alerts you via toast notifications when your available balance drops below a configurable threshold.
- **CORS Bypass**: Seamlessly utilizes SillyTavern's backend proxy (`/proxy/`) or custom proxy with automatic fallback to prevent browser CORS blocks.

## Installation & Configuration

The extension is installed at:
`data/default-user/extensions/Serveras-Balance-Tracker/`

Open SillyTavern or TauriTavern -> Extensions Panel (Puzzle Piece Icon) -> **Serveras Balance Tracker** to customize:
1. **API Key**: Click **Auto-Fill** to automatically retrieve from active settings or the Tauri secret store.
2. **Endpoint URL**: Defaults to `https://serveras.click/v1/balance`.
3. **Custom Proxy URL**: On TauriTavern (mobile/desktop), click **Auto-Detect** to scan for your local SillyTavern proxy (e.g. `http://localhost:8008/proxy/` or LAN IP).
4. **Auto-refresh toggles & polling intervals**: Configure auto-refresh on generation completion and background interval.
5. **Display format & currency conversion ratio**: Customize display format and credit-to-USD conversion.
