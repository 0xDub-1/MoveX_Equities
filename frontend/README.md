# MoveX Equities frontend

The trading interface for the MoveX Equities program on Solana devnet. Next.js 16, App Router, Tailwind 4, wallet adapter, Anchor client. Every number on screen is read from chain; there is no backend.

## Run it

```bash
npm install
cp .env.example .env.local   # optional, set an RPC endpoint
npm run dev
```

Open http://localhost:3000. A wallet on devnet (Phantom or Solflare), a little devnet SOL for fees, and USDX from the faucet on the home page are all that is needed to trade.

## Configuration

| Variable | Reaches the browser | Purpose |
|---|---|---|
| `RPC_URL` | No | The endpoint `/api/rpc` forwards to. Use this one when the URL carries an API key. |
| `NEXT_PUBLIC_RPC_URL` | Yes | An endpoint the browser calls directly, bypassing the proxy. Convenient locally, but the whole URL ships in the bundle. |
| `NEXT_PUBLIC_PROGRAM_ID` | Yes | Override for another deployment of the program. |
| `NEXT_PUBLIC_QUOTE_MINT` | Yes | The USDX mint. |

Set one of the two RPC variables, not both. With neither, both paths end at the public devnet endpoint, which needs no key and rate limits `getProgramAccounts` hard.

### Why the proxy

Anything prefixed `NEXT_PUBLIC_` is compiled into the JavaScript the browser downloads, so a key inside such a URL is public the moment the site is. `RPC_URL` is read only on the server: the browser posts JSON-RPC to the site's own `/api/rpc`, and the route handler forwards it upstream.

The handler forwards every `get*` method plus `sendTransaction` and `simulateTransaction`, and refuses everything else, so it cannot be used as a general relay. Account subscriptions cannot travel through a route handler, so they connect to the public devnet websocket directly; that endpoint needs no key and only ever receives public account addresses.

## Deploy to Vercel

The repository holds the Anchor program and the keeper as well, so the project has to be pointed at this directory.

1. Import the repository at [vercel.com/new](https://vercel.com/new).
2. Set **Root Directory** to `frontend`. Everything else is detected: framework Next.js, build `next build`, install `npm install`.
3. Add one environment variable, for every environment:

   ```
   RPC_URL = https://devnet.helius-rpc.com/?api-key=...
   ```

   Leave `NEXT_PUBLIC_RPC_URL` unset so the browser uses the proxy.
4. Deploy.

`vercel.json` in this directory pins the framework and skips a build when a push changed nothing under `frontend/`, so a commit to the program or the keeper does not redeploy the site.

Nothing else needs configuring: there is no database, no server state, and no build step that reaches outside this directory. The program IDL is committed at `src/lib/idl`, not fetched from the workspace.

## Pages

| Route | What it shows |
|---|---|
| `/` | The portfolio, and the home page. Wallet balances, the USDX faucet, positions with withdraw and claim, realised results, and a shareable result card. Without a wallet, what the product is and how to start. |
| `/trading` | The board. Daily ladders and hourly sessions, filtered by Open, Live and Resolved. |
| `/market/[address]` | One market. The price against its threshold, the two answers, the 20 samples the threshold came from, the timeline, and the deposit panel. |

`/portfolio` redirects to `/`. `/preview` is a component gallery on fixtures and returns a 404 outside development.

## Layout

```
src/
  app/            routes, layout, providers, global styles, the RPC proxy
  components/
    ui/           primitives, navbar, footer, wallet button, toasts
    trading/      the board: ladders, hourly sessions, the move gauge
    market/       the market page: header, deposit panel, timeline
    portfolio/    wallet, faucet, positions, share card
  hooks/          react-query wrappers over the program's accounts
  lib/            config, IDL, PDAs, the market model, formatting, calendar
  store/          toasts
```

## On-chain reads

| Data | How |
|---|---|
| Markets | `program.account.market.all()`, polled every 15 seconds |
| Price feeds | The three PriceFeed PDAs, polled every 8 seconds and subscribed over the websocket |
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
