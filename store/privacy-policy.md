# Shella Wallet — Privacy Policy

**Last updated: 2025-01-01**

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

## Network Requests

The Extension makes network requests **only** to the RPC endpoint you configure (default: Shell Chain nodes). These requests are standard JSON-RPC calls required for blockchain interaction (balance queries, transaction submission). No personal data is included in these requests beyond your public wallet address.

## Private Keys

Your private key is:
1. Generated locally in your browser
2. Immediately encrypted before storage
3. Never transmitted to any server
4. Only decrypted temporarily in memory when you unlock your wallet, and zeroed out afterward

## Third-Party Services

Shella Wallet does not integrate any third-party services, advertising networks, or analytics platforms.

## Open Source

Shella Wallet is open source. You can review all code at: https://github.com/ShellDAO/shella-chrome-wallet

## Contact

For privacy questions or concerns, please open an issue on GitHub or contact the ShellDAO team at https://github.com/ShellDAO.

## Changes

We may update this policy as the Extension evolves. Changes will be reflected in the "Last updated" date above and in the Extension's repository.
