# Shella Wallet — Privacy Policy

**Last updated: 2026-06-28**

## Overview

Shella Wallet ("the Extension") is a Chrome browser extension that provides post-quantum wallet functionality for Shell Chain. We are committed to protecting your privacy.

## Data Collection

**Shella Wallet collects NO personal data.** Specifically:

- We do **not** collect names, email addresses, or any personally identifiable information.
- We do **not** transmit usage analytics or telemetry.
- We do **not** track wallet addresses or transaction history on any remote server.
- We do **not** use third-party analytics services.

## Data Storage

All wallet data is stored **locally on your device** using Chrome's `chrome.storage.local` and `chrome.storage.session` APIs:

- **Keystore data**: Your encrypted private key (encrypted with Argon2id + XChaCha20-Poly1305) is stored in `chrome.storage.local`. It never leaves your device.
- **Session state**: Whether your wallet is unlocked is stored in `chrome.storage.session`, which is cleared when the browser session ends.
- **Network settings**: Your selected network configuration is stored locally.
- **Transaction queue**: Pending transaction records are stored locally for status tracking.
- **Portfolio state**: Portfolio Guard reads configured and preset network balances for your active account and displays the result locally. It does not upload or sell portfolio data.
- **dApp session metadata**: Connected-site grants, WalletConnect sessions, TonConnect sessions, allowed methods, expiry times, and last-used timestamps are stored locally so you can review and revoke permissions.

## Network Requests

The Extension makes network requests to the RPC endpoints you configure or select from built-in network presets. These requests are standard blockchain RPC calls required for wallet interaction, including balance queries, transaction submission, transaction status checks, and Portfolio Guard native-balance summaries. No personal data is included in these requests beyond public wallet addresses and public transaction data.

The Extension does not use analytics, advertising networks, or hosted portfolio indexing services.

## Private Keys

Your private key is:
1. Generated locally in your browser
2. Immediately encrypted before storage
3. Never transmitted to any server
4. Only decrypted temporarily in memory when you unlock your wallet, and zeroed out afterward

## Third-Party Services

Some built-in non-Shell network presets use public third-party blockchain RPC endpoints. These endpoints receive normal public blockchain requests for the selected network, such as balance reads for your public address. Shella Wallet does not integrate advertising networks or analytics platforms.

## Open Source

Shella Wallet is open source. You can review all code at: https://github.com/ShellDAO/shella-chrome-wallet

## Contact

For privacy questions or concerns, please open an issue on GitHub or contact the ShellDAO team at https://github.com/ShellDAO.

## Changes

We may update this policy as the Extension evolves. Changes will be reflected in the "Last updated" date above and in the Extension's repository.
