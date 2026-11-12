# Serveras Balance Tracker for SillyTavern & TauriTavern

A SillyTavern and TauriTavern extension to track, monitor, and calculate available balance, generation costs, prepaid packs, and real-time model pricing from [serveras.click](https://serveras.click) and [serverasai.com](https://serverasai.com).

---

## Key Features

### 1. Real-Time Balance & Cost Tracking
- **Live Endpoint Monitoring**: Queries `https://serveras.click/v1/balance` using your Serveras asAi API key (`Authorization: Bearer asai_sk_...`).
- **Post-Generation Cost Calculation**: Measures the exact credit deduction after each message turn and displays the turn cost in red/green pills.
- **Session Spent Counter**: Aggregates all credit deductions across the current chat session.
- **Low Balance Notification**: Proactively notifies you via toast alerts when available balance falls below your chosen threshold.

### 2. Official Serveras asAi Pricing & Billing Rules
Implemented strictly according to the official documentation at [serverasai.com/docs/billing](https://serverasai.com/docs/billing) and [serverasai.com/docs/models](https://serverasai.com/docs/models):
- **Pricing Formula**:
  $$\text{credits} = \max\left(1000,\, \lceil(\text{input} - \text{cache\_read}) \cdot m_{\text{in}} + \text{cache\_read} \cdot m_{\text{cache}} + \text{output} \cdot m_{\text{out}}\rceil\right)$$
- **Minimum Charge**: Hard minimum of **1,000 credits** per successful API call.
- **Cache Read Multiplier**: Dedicated prompt caching rates ($m_{\text{cache}}$, typically $0.25 \times m_{\text{in}}$).
- **Free Models**: 4 completely free models (e.g. `asai/space-bunny`, `gemini-2.5-flash-thinking`, `glm-4.5-flash`, `deepseek-r1-distill-llama-70b-free`) with 0 multipliers, subject only to the standard 1,000 credits minimum charge.

### 3. Prepaid Pack System (MYR / RM)
Supports all 5 official Serveras prepaid tiers with automatic credits-to-Ringgit conversion:

| Pack Tier | Price (MYR) | Total Credits | Conversion Rate | Validity |
| :--- | :--- | :--- | :--- | :--- |
| **RM5** | RM 5.00 | 80,000,000 | 16.0M credits / RM | 720h (30 days) |
| **RM8** | RM 8.00 | 140,000,000 | 17.5M credits / RM | 720h (30 days) |
| **RM10** | RM 10.00 | 200,000,000 | 20.0M credits / RM | 720h (30 days) |
| **RM50** | RM 50.00 | 1,100,000,000 | 22.0M credits / RM | 720h (30 days) |
| **RM100** | RM 100.00 | 2,250,000,000 | 22.5M credits / RM *(Best Value)* | 720h (30 days) |

- **Currency Unit Selector**: Switch between Malaysian Ringgit (`RM`), US Dollar (`$`), or dual display (`RM (USD)`).
- **Adjustable Exchange Rate**: Configurable USD/MYR rate (default `4.45`).

### 4. 54-Model Pricing Catalog & Active Model Detection
- **Active Model Detection**: Automatically identifies the active model selected in SillyTavern (`claude-sonnet-4.6`, `gpt-6-sol`, `deepseek-v4.1-flash`, etc.).
- **Live Rate Multipliers**: Displays the exact Input, Output, and Cache multipliers in the Hero Card.
- **Remaining Replies Estimator**: Computes approximately how many prompt turns remain on your current balance for the active model.
- **Interactive Catalog**: Searchable and filterable table in the Settings Drawer:
  - Filter by category: **All**, **Free (4)**, **Anthropic**, **OpenAI**, **DeepSeek**, **Vision**, **1M Context**.
  - 1-click button to copy model IDs into clipboard.
  - **"Sync Rates"** button: Dynamically queries `GET https://serveras.click/v1/models` to pull down newly released models and updated multipliers.

### 5. TauriTavern & Mobile Optimizations
- **Mobile Micro-Pill**: Compact floating badge designed specifically for mobile screens without obstructing top navigation buttons.
- **Touch Drag & Drop**: Freely reposition the floating badge anywhere on screen with finger or mouse dragging; position is persisted across reloads.
- **Position Reset**: Reset badge position with one tap from the settings drawer.
- **Direct Fetch & Safe Insets**: Optimized for Android webviews with `--tt-inset-top` support and direct CORS fetch support.

### 6. OpenCode IDE Integration
- Automatically injects into the bottom status bar of the OpenCode IDE theme (`#opencode-status-bar`).

---

## Slash Commands

Type `/balance` or `/serveras` in chat to interact with the extension:

| Command | Description |
| :--- | :--- |
| `/balance` | Displays current balance, active model, multipliers, and remaining replies estimate. |
| `/balance refresh` | Forces an immediate balance sync from `serveras.click`. |
| `/balance models [query]` | Searches the 54-model catalog with rates, context windows, and estimated turn costs. |
| `/balance model <name>` | Displays a full pricing and specification card for a specific model (e.g. `/balance model sonnet-4.6`). |
| `/balance cost <in> <out> [model]` | Calculates exact request credits using the official formula (e.g. `/balance cost 3000 600 claude-sonnet-4.6`). |
| `/balance pack <rm5\|rm8\|rm10\|rm50\|rm100>` | Switches active prepaid pack tier for currency calculations. |
| `/balance key <api_key>` | Updates and saves the Serveras asAi API key. |
| `/balance proxy <proxy_url>` | Updates the custom CORS proxy URL. |

---

## Installation

### SillyTavern
1. Open **Extensions** (puzzle piece icon in top bar).
2. Click **Install Extension** and paste the Git repository URL:
   ```text
   git@github.com:TheUnawsomeGuy/STTT-Serveras-Balance-Tracker.git
   ```
   *or* download and extract `Serveras-Balance-Tracker.zip` into `data/default-user/extensions/Serveras-Balance-Tracker`.
3. Reload SillyTavern.

### TauriTavern (Android & Desktop)
1. Copy or extract `Serveras-Balance-Tracker` into your TauriTavern extensions directory.
2. Open TauriTavern -> **Extensions** -> **Serveras Balance & Pricing**.
3. Click **Auto-Fill** to automatically retrieve your `asai_sk_...` key from active settings or the secret manager.
4. If connecting from a remote mobile device without direct internet access to `serveras.click`, click **Auto-Detect** to connect through your local SillyTavern server proxy.
