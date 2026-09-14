# MoveX Equities frontend

The trading interface for the MoveX Equities program on Solana devnet. Next.js 16, App Router, Tailwind 4, wallet adapter, Anchor client. Every number on screen is read from chain; there is no backend.

## Run it

```bash
npm install
cp .env.example .env.local   # optional, set a Helius devnet URL
npm run dev
```

Open http://localhost:3000. A wallet on devnet (Phantom or Solflare), a little devnet SOL for fees, and USDX from the faucet on the portfolio page are all that is needed to trade.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_RPC_URL` | public devnet | RPC endpoint. A Helius devnet URL is recommended; the public one rate limits `getProgramAccounts`. |
| `NEXT_PUBLIC_PROGRAM_ID` | live deployment | Override for another deployment of the program. |
| `NEXT_PUBLIC_QUOTE_MINT` | live deployment | The USDX mint. |

Anything prefixed `NEXT_PUBLIC_` ships to the browser.

## Pages

| Route | What it shows |
|---|---|
| `/` | The portfolio, and the home page. Wallet balances, the USDX faucet, positions with withdraw and claim, realised results, and a shareable result card. Without a wallet, what the product is and how to start. |
| `/trading` | The board. Live oracle prices, then every market grouped into daily ladders and hourly sessions, filtered by Open, Live and Resolved. |
| `/market/[address]` | One market. The price against its threshold, the pools, the 20 samples the threshold came from, the timeline, and the deposit panel. |

`/portfolio` redirects to `/`.

## Layout

```
src/
  app/            routes, layout, providers, global styles
  components/
    ui/           primitives, navbar, footer, wallet button, toasts
    trading/      the board: ticker strip, ladders, hourly strips, the move gauge
    market/       the market page: header, deposit panel, timeline
    portfolio/    wallet, faucet, positions, share card
  hooks/          react-query wrappers over the program's accounts
  lib/            config, IDL, PDAs, the market model, formatting, calendar
  store/          toasts and the session price history
```

## On-chain reads

| Data | How |
|---|---|
| Markets | `program.account.market.all()`, polled every 15 seconds |
| Price feeds | The three PriceFeed PDAs, polled every 8 seconds and subscribed over the RPC websocket |
| Positions | `program.account.position.all()` filtered by owner, polled every 12 seconds |
| Balances | `getBalance` and `getTokenAccountBalance` on the wallet's USDX account |
| Faucet | The Faucet PDA and the wallet's FaucetClaim PDA |

The IDL is bundled from `src/lib/idl` rather than fetched from chain, because a program upgrade does not update the on-chain IDL.

## Scripts

```bash
npm run dev     # development server
npm run build   # production build
npm run lint    # eslint
npx tsc --noEmit
```
