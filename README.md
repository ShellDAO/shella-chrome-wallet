# shella-chrome-wallet

Post-quantum Chrome wallet extension for [Shell Chain](https://github.com/LucienSong/shell-chain).

## Features

- 🔐 ML-DSA-65 (Dilithium) post-quantum key generation
- 🗝️ Keystore import/export (argon2id + xchacha20-poly1305)
- 💸 Send / receive Shell Chain transactions
- 🌐 Configurable RPC endpoint (devnet / testnet / mainnet)
- ⚡ Built on Manifest V3

## Project Structure

```
manifest.json          Chrome extension manifest (MV3)
popup.html / popup.css Extension popup UI
src/
  popup.ts             Popup entry point
  background.ts        Service worker (signing, RPC)
  store.ts             chrome.storage.local wrapper
```

## Development

```bash
npm install
npm run build        # compile TypeScript → dist/
```

Load `dist/` as an unpacked extension in `chrome://extensions`.

## Dependencies

- [`shell-sdk`](https://github.com/LucienSong/shell-sdk) — PQ signing + AA tx builders
- [`viem`](https://viem.sh) — Ethereum primitives
- [`@noble/post-quantum`](https://github.com/paulmillr/noble-post-quantum) — ML-DSA-65
