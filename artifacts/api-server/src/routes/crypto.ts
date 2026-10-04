import { Router, type IRouter, type Request, type Response } from "express";
import https from "node:https";

const router: IRouter = Router();

const COINS = [
  ["bitcoin", "BTC", "Bitcoin"], ["ethereum", "ETH", "Ethereum"], ["solana", "SOL", "Solana"],
  ["tether", "USDT", "Tether"], ["usd-coin", "USDC", "USD Coin"], ["binancecoin", "BNB", "BNB"],
  ["ripple", "XRP", "XRP"], ["dogecoin", "DOGE", "Dogecoin"], ["cardano", "ADA", "Cardano"],
  ["avalanche-2", "AVAX", "Avalanche"], ["tron", "TRX", "TRON"], ["stellar", "XLM", "Stellar"],
] as const;

type Market = {
  id:string; symbol:string; name:string; image:string;
  priceUsd:number; priceNgn:number; change24h:number;
  marketCapUsd:number; marketCapNgn:number; volumeUsd:number; volumeNgn:number;
};

const numberOrZero = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

function httpsJson<T>(url: string, timeoutMs = 10000): Promise<{ status: number; body: T }> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { accept: "application/json", "user-agent": "CipherPay/1.0" },
    }, response => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { raw += chunk; });
      response.on("end", () => {
        try {
          resolve({ status: response.statusCode ?? 0, body: JSON.parse(raw) as T });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("request timeout")));
    request.on("error", reject);
  });
}

async function getFxRate(): Promise<number> {
  try {
    const response = await httpsJson<{ rates?: { NGN?: number } }>(
      "https://open.er-api.com/v6/latest/USD",
      8000,
    );
    if (response.status >= 200 && response.status < 300) {
      const rate = numberOrZero(response.body.rates?.NGN);
      if (rate > 0) return rate;
    }
  } catch (error) {
    console.warn("[crypto/markets] FX request failed", error);
  }
  return 0;
}

async function getCoinLoreMarkets(): Promise<Market[]> {
  const response = await httpsJson<{ data: Array<{
    symbol:string; name:string; price_usd?:string; market_cap_usd?:string;
    volume24?:number|string; percent_change_24h?:string;
  }> }>("https://api.coinlore.net/api/tickers/?start=0&limit=100", 10000);
  if (response.status < 200 || response.status >= 300 || !response.body?.data) {
    throw new Error("CoinLore returned " + response.status);
  }
  const fx = await getFxRate();
  if (!fx) throw new Error("Unable to get USD/NGN rate");
  const bySymbol = new Map(response.body.data.map(item => [item.symbol.toUpperCase(), item]));
  const markets = COINS.map(([id, symbol, name]) => {
    const item = bySymbol.get(symbol);
    const priceUsd = numberOrZero(item?.price_usd);
    if (!priceUsd) return null;
    const marketCapUsd = numberOrZero(item?.market_cap_usd);
    const volumeUsd = numberOrZero(item?.volume24);
    return {
      id, symbol, name,
      image: "https://c2.coinlore.com/img/25x25/" + symbol.toLowerCase() + ".png",
      priceUsd, priceNgn: priceUsd * fx,
      change24h: numberOrZero(item?.percent_change_24h),
      marketCapUsd, marketCapNgn: marketCapUsd * fx,
      volumeUsd, volumeNgn: volumeUsd * fx,
    };
  }).filter((item): item is Market => Boolean(item));
  if (markets.length < 6) throw new Error("CoinLore returned only " + markets.length + " supported assets");
  return markets;
}

async function getCoinGeckoMarkets(): Promise<Market[]> {
  const ids = COINS.map(([id]) => id).join(",");
  const url =
    "https://api.coingecko.com/api/v3/coins/markets" +
    "?vs_currency=usd&ids=" + encodeURIComponent(ids) +
    "&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h";

  const response = await httpsJson<Array<{
    id:string;
    name:string;
    symbol:string;
    image?:string;
    current_price?:number;
    market_cap?:number;
    total_volume?:number;
    price_change_percentage_24h?:number;
  }>>(url, 10000);

  if (
    response.status < 200 ||
    response.status >= 300 ||
    !Array.isArray(response.body) ||
    response.body.length < 6
  ) {
    throw new Error("CoinGecko returned " + response.status + ": insufficient market data");
  }

  const fx = await getFxRate();
  if (!fx) throw new Error("Unable to get USD/NGN rate");

  const byId = new Map(response.body.map(item => [item.id, item]));

  const markets = COINS.map(([id, symbol, name]) => {
    const item = byId.get(id);
    const priceUsd = numberOrZero(item?.current_price);
    if (!priceUsd) return null;
    const marketCapUsd = numberOrZero(item?.market_cap);
    const volumeUsd = numberOrZero(item?.total_volume);
    return {
      id,
      symbol,
      name,
      image: item?.image || "",
      priceUsd,
      priceNgn: priceUsd * fx,
      change24h: numberOrZero(item?.price_change_percentage_24h),
      marketCapUsd,
      marketCapNgn: marketCapUsd * fx,
      volumeUsd,
      volumeNgn: volumeUsd * fx,
    };
  }).filter((item): item is Market => Boolean(item));

  if (markets.length < 6) {
    throw new Error("CoinMarketCap returned only " + markets.length + " supported assets");
  }
  return markets;
}

async function getBinanceMarkets(): Promise<Market[]> {
  const response = await httpsJson<Array<{
    symbol:string;
    lastPrice:string;
    priceChangePercent:string;
    quoteVolume:string;
  }>>("https://data-api.binance.vision/api/v3/ticker/24hr", 10000);

  if (response.status < 200 || response.status >= 300 || !Array.isArray(response.body)) {
    throw new Error("Binance returned " + response.status);
  }

  const fx = await getFxRate();
  if (!fx) throw new Error("Unable to get USD/NGN rate");

  const bySymbol = new Map(response.body.map(row => [row.symbol, row]));
  const stable: Record<string, number> = { USDT: 1, USDC: 1 };

  const markets = COINS.map(([id, symbol, name]) => {
    const row = bySymbol.get(symbol + "USDT");
    const priceUsd = stable[symbol] ?? numberOrZero(row?.lastPrice);
    if (!priceUsd) return null;
    const volumeUsd = numberOrZero(row?.quoteVolume);
    return {
      id, symbol, name, image: "",
      priceUsd, priceNgn: priceUsd * fx,
      change24h: numberOrZero(row?.priceChangePercent),
      marketCapUsd: 0, marketCapNgn: 0,
      volumeUsd, volumeNgn: volumeUsd * fx,
    };
  }).filter((item): item is Market => Boolean(item));

  if (markets.length < 6) {
    throw new Error("Binance returned only " + markets.length + " supported assets");
  }
  return markets;
}

router.get("/crypto/markets", async (_req: Request, res: Response): Promise<void> => {
  const providers = [
    ["CoinLore", getCoinLoreMarkets],
    ["CoinGecko", getCoinGeckoMarkets],
    ["Binance", getBinanceMarkets],
  ] as const;
  for (const [provider, loader] of providers) {
    try {
      const data = await loader();
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
      res.json({ provider, updatedAt: new Date().toISOString(), data });
      return;
    } catch (error) {
      console.warn("[crypto/markets] " + provider + " failed", error);
    }
  }
  res.status(502).json({ error: "Live crypto market data is temporarily unavailable. Please try again." });
});

export default router;
