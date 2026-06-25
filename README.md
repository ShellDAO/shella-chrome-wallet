# shella-chrome-wallet

Chrome wallet for [Shell Chain](https://github.com/LucienSong/shell-chain) — quantum-safe key management built for the era before Q-Day.

## Features

- 🔐 **ML-DSA-65 key management** — generate or import post-quantum keypairs; addresses in canonical Shell format (`0x` + 64 lowercase hex, BLAKE3-derived)
- 🔑 **Password-protected keystore** — argon2id KDF + xchacha20-poly1305 encryption; compatible with Shell CLI keystore format
- 🔒 **Auto-lock** — configurable inactivity timeout via chrome.alarms; unlocked signer stays only in service-worker memory and browser restart re-locks the wallet
- 💸 **Send transactions** — input recipient + amount → build → sign → broadcast via shell-sdk
- 📥 **Receive** — display full address with one-click copy
- 📜 **Transaction history** — query `shell_getTransactionsByAddress`, display reward-aware Shell tx labels, and preserve STARK reward metadata from address history summaries
- 🌐 **Multi-network** — switch between devnet / testnet / mainnet or configure a custom RPC URL
- 🧭 **Multi-chain foundation** — HD-derived Tron, Solana, Bitcoin, Cosmos SDK, TON, and Aptos accounts; Tron/Solana/Bitcoin/Cosmos/Aptos support native balance/send flows, TON has Wallet V4-derived receive addresses, toncenter-compatible balance reads, active Wallet V4R2 `seqno` lookup, local BOC signing, `sendBoc` broadcast, and pending TON transfer history, Cosmos signs ATOM/OSMO transfers, staking delegate/undelegate/redelegate, rewards-withdraw, and governance vote transactions with SIGN_MODE_DIRECT via Cosmos REST, simulate-based gas/fee estimation, network metadata for bech32 prefix + native denom, read-only multi-denom bank balance, staking delegation overview, in-flight redelegation cooldown display with transitive redelegation blocking, validator discovery with commission/status/max-rate/change-rate/self-delegation/slashing risk details and actionable risk guidance, read-only governance proposal summaries with vote tally plus current-account vote option and staking power display, WalletConnect Cosmos namespace requests (`cosmos_chainId`, `cosmos_accounts`, `cosmos_getBalance`, approval-gated `cosmos_signDirect`/`cosmos_signAmino`) with approval summaries for common direct, Amino, IBC transfer, and unknown custom protobuf payloads, readable failed `raw_log` history errors, and IBC route memo prechecks, Shell/EVM ERC20, Tron TRC20, and Solana SPL token info/add/balance/send flows share the token provider registry; Bitcoin sends include UTXO coin control with sorting, labels, and persistent locks, fee priority presets, manual sat/vB fee rate, address reuse warnings, opt-in RBF, fee-bump replacement, receiver-side multi-parent CPFP with package fee-rate targeting and mempool policy checks, selected UTXO details, fee, change, dust preview, change/dust confirmation, Esplora transaction links, and remote Esplora history; Aptos uses SLIP-10 Ed25519 derivation, CoinStore balance reads, BCS RawTransaction signing, live ledger chain-id reads before signing, sequence/gas/expiration plus amount+max-gas balance preflight, unfunded-account errors, local pending history, REST status polling, and a gated `window.aptos` provider that only submits preview-recognized native APT transfer payloads with approval risk details
- 🔌 **dApp connectivity foundation** — injected `window.shella` + EIP-1193-compatible `window.ethereum` bridge for connect / read-only RPC / chain switching
- ⚡ **Manifest V3** — service worker background, strict CSP, no eval

## Project Structure

```
manifest.json          MV3 manifest (minimal permissions: storage, alarms)
popup.html             Extension popup shell (360×600)
popup.css              Dark-theme styles
icons/                 Extension icons (16, 48, 128px)
src/
  popup.ts             Multi-view SPA entry point
  background.ts        Service worker — key lifecycle, signing, RPC
  content.ts           Content-script bridge between web pages and the extension
  inpage.ts            Injected provider (`window.shella` / `window.ethereum`)
  store.ts             chrome.storage.local/session wrapper
  crypto.ts            Pure-JS keystore create/decrypt (no WASM)
scripts/
  bundle.js            esbuild bundler → dist/
dist/                  Built extension (load as unpacked)
```

## Development

```bash
# Local development pulls shell-sdk via npm or a local file path; see package.json
npm install
npm run build        # esbuild → dist/popup.js + dist/background.js
npm run build:prod   # minified production bundle
npm run check:bundle-size
npm run check:core-release
npm run check:extension-smoke
npm run check:live-chain-smoke
npm run check:tonconnect-smoke
npm run check:walletconnect-smoke
npm run check:release-metadata
npm run release:bundle
npm run typecheck    # tsc --noEmit
npm run lint         # eslint src/
npm test             # build + node --test tests/*.test.mjs
npm run smoke:extension
npm run smoke:live-chain
npm run smoke:tonconnect
npm run smoke:walletconnect
```

Load the project root as an **unpacked extension** in `chrome://extensions` (enable Developer mode).

> **Note:** the development build uses inline sourcemaps, so `dist/background.js` can look several MB locally. The production build (`npm run build:prod`) is the real release artifact and is kept under CI size guard.
> **Security note:** dApp connectivity now requires `http://*/*` + `https://*/*` host access so the provider bridge can be injected into web pages. No third-party analytics, remote scripts, or broad extension permissions were added beyond `storage` and `alarms`.

### WalletConnect smoke

### Release tracks

Default release validation uses the `core-extension` track:

```bash
npm run check:core-release

# Equivalent expanded smoke checks:
npm run smoke:extension && npm run check:extension-smoke
npm run smoke:tonconnect && npm run check:tonconnect-smoke
npm run check:release-metadata
```

WalletConnect QR/cross-device pairing is an optional `optional-walletconnect-qr` track. It is only release-blocking when explicitly required with `REQUIRE_WC_REAL_SMOKE=1`.

`npm run smoke:walletconnect` builds the extension and runs a real WalletConnect v2 smoke when `WC_PROJECT_ID` is set. It pairs a local dApp SignClient with the extension, approves a proposal, verifies `eth_chainId`, rejects an `eth_sendTransaction` approval, and disconnects the session.

```bash
WC_PROJECT_ID=your_project_id npm run smoke:walletconnect
# Optional:
WC_RELAY_URL=wss://relay.walletconnect.com WC_PROJECT_ID=your_project_id npm run smoke:walletconnect
```

Without `WC_PROJECT_ID`, the command exits successfully and writes a skipped artifact. Real runs write `output/playwright/shella-wallet-walletconnect-smoke.json` plus a screenshot for release review.

Validate the artifact with:

```bash
npm run check:walletconnect-smoke
REQUIRE_WC_REAL_SMOKE=1 npm run check:walletconnect-smoke
```

The first command accepts a skipped artifact for local/offline checks. The second requires a real passed WalletConnect run and is intended for release gates.

### Optional live-chain smoke

`smoke:live-chain` is an optional RPC health check for free/public testnet endpoints. It is not part of `check:core-release` and does not require faucet funds or private keys.

```bash
# Default local/offline path: writes a skipped artifact.
npm run smoke:live-chain && npm run check:live-chain-smoke

# Optional public RPC health checks:
LIVE_CHAIN_SMOKE=1 LIVE_SMOKE_CHAIN=solanaDevnet npm run smoke:live-chain
LIVE_SMOKE_CHAIN=solanaDevnet REQUIRE_LIVE_CHAIN_SMOKE=1 npm run check:live-chain-smoke

LIVE_CHAIN_SMOKE=1 LIVE_SMOKE_CHAIN=tronShasta npm run smoke:live-chain
LIVE_SMOKE_CHAIN=tronShasta REQUIRE_LIVE_CHAIN_SMOKE=1 npm run check:live-chain-smoke

LIVE_CHAIN_SMOKE=1 LIVE_SMOKE_CHAIN=aptosTestnet npm run smoke:live-chain
LIVE_SMOKE_CHAIN=aptosTestnet REQUIRE_LIVE_CHAIN_SMOKE=1 npm run check:live-chain-smoke
```

Artifacts are written under `output/playwright/` with the `optional-live-chain` release track.

## Connecting to the Shell test node

The wallet ships with four preset networks:

| Key | Name | Chain ID | RPC |
|---|---|---|---|
| `devnet` | Shell Devnet | 424242 | `http://127.0.0.1:8545` |
| `localdev` | Shell Testnet (local) | 10 | `http://127.0.0.1:8545` |
| `testnet` | Shell Testnet | 10 | `https://rpc.testnet.shell.network` |
| `mainnet` | Shell Mainnet | 100000 | `https://rpc.mainnet.shell.network` |

### Connecting to SG3 testnet via SSH tunnel (recommended for development)

The SG3 testnet node exposes RPC on port 8545. Since the wallet only accepts
HTTP for `localhost`, forward the port locally before loading the extension:

```bash
# Keep this running in a separate terminal
ssh -N -L 8545:127.0.0.1:8545 root@47.237.195.95 \
  -i ~/.ssh/shell-testnet-sg-20260504035712.pem
```

Then in the wallet popup:

1. Open **Settings → Network** and select **Shell Testnet — local (10, localhost)**.
2. The wallet will probe `shell_getNodeInfo` on boot and display the node version,
   block height, and peer count in the wallet panel when connected.
3. Confirmed chain ID `10` should appear in the RPC chain row of the wallet meta section.

### Using a custom HTTPS RPC

If an HTTPS endpoint is available (e.g., behind a reverse proxy):

1. Go to **Settings → Network → Custom RPC…**
2. Set **Chain ID** to `10`, **RPC URL** to your HTTPS endpoint, and **Network Name**.
3. Click **Save Custom RPC**.

The wallet enforces HTTPS for all non-localhost RPC URLs.

### Verifying connectivity

When connected, the wallet header panel shows:

- 📦 Node version (e.g., `ShellChain/v0.23.0/rust`)
- 🧱 Current block height
- 🔗 Peer count

If the RPC is unreachable a yellow warning banner appears: _"RPC unavailable for …"_.
If chain IDs mismatch a different warning prompts you to switch networks.

## Release engineering

- CI runs on **Node 20 and 22**
- Release metadata is verified so `package.json`, `manifest.json`, and `CHANGELOG.md` stay in sync
- Production bundle size is enforced by `npm run check:bundle-size`
- `npm run release:bundle` creates a deterministic zip in `dist/release/` plus a `.sha256` file for verification

## Dependencies

- [`shell-sdk`](https://github.com/LucienSong/shell-sdk) — ML-DSA-65 adapter, ShellSigner, provider, tx builders
- [`@noble/hashes`](https://github.com/paulmillr/noble-hashes) — Argon2id KDF (pure JS)
- [`@noble/ciphers`](https://github.com/paulmillr/noble-ciphers) — XChaCha20-Poly1305 (pure JS)
- [`viem`](https://viem.sh) — Ethereum primitives (hex, encoding)
