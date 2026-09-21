import {
  CRYPTO_ASSETS,
  CRYPTO_HOURLY_SYMBOLS,
  CRYPTO_SYMBOLS,
  coinOf,
  cryptoAsset,
  validateCryptoAssets,
  type CryptoAsset,
} from '../lib/lambdas/shared/crypto-config';

const full: CryptoAsset = { symbol: 'BTC', name: 'Bitcoin', hourly: true, dailyRungs: ['tight', 'fair', 'wide'] };

describe('the registry', () => {
  it('lists BTC, ETH and SOL with a full daily ladder each', () => {
    expect(CRYPTO_SYMBOLS).toEqual(['BTC', 'ETH', 'SOL']);
    for (const asset of CRYPTO_ASSETS) expect(asset.dailyRungs).toEqual(['tight', 'fair', 'wide']);
  });

  it('carries hourly markets on BTC', () => {
    expect(CRYPTO_HOURLY_SYMBOLS).toContain('BTC');
  });

  it('quotes an asset on its own symbol unless told otherwise', () => {
    expect(coinOf('BTC')).toBe('BTC');
    expect(cryptoAsset('SOL').name).toBe('Solana');
    expect(() => coinOf('DOGE')).toThrow(/not a listed crypto asset/);
  });
});

describe('validateCryptoAssets', () => {
  it('accepts the shipped registry', () => {
    expect(() => validateCryptoAssets(CRYPTO_ASSETS)).not.toThrow();
  });

  it('refuses an empty registry', () => {
    expect(() => validateCryptoAssets([])).toThrow(/empty/);
  });

  /** The program stores eight ASCII bytes and derives addresses from them. */
  it('refuses a symbol the program could not store', () => {
    expect(() => validateCryptoAssets([{ ...full, symbol: 'TOOLONGSYM' }])).toThrow(/1 to 8/);
    expect(() => validateCryptoAssets([{ ...full, symbol: 'btc' }])).toThrow(/1 to 8/);
    expect(() => validateCryptoAssets([{ ...full, symbol: 'xyz:XYZ' }])).toThrow(/1 to 8/);
  });

  it('refuses a symbol listed twice', () => {
    expect(() => validateCryptoAssets([full, { ...full, name: 'again' }])).toThrow(/twice/);
  });

  it('refuses an asset with nothing to list', () => {
    expect(() => validateCryptoAssets([{ ...full, hourly: false, dailyRungs: [] }])).toThrow(/neither/);
  });

  it('refuses a repeated rung and an empty explicit coin', () => {
    expect(() => validateCryptoAssets([{ ...full, dailyRungs: ['fair', 'fair'] }])).toThrow(/repeats/);
    expect(() => validateCryptoAssets([{ ...full, coin: '' }])).toThrow(/must not be empty/);
  });

  /** A HIP-3 asset carries a dex prefix on Hyperliquid that the program cannot store. */
  it('allows a coin name that differs from the symbol', () => {
    expect(() => validateCryptoAssets([{ ...full, symbol: 'XYZ100', coin: 'xyz:XYZ100' }])).not.toThrow();
  });
});
