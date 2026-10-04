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

async function getCoinMarketCapMarkets(): Promise<Market[]> {
  // Use CMC's small Simple Price endpoint rather than the 100-asset listings
  // response. It returns exactly the market fields this page needs and avoids
  // the larger provider response that was failing in production.
  const symbols = COINS.map(([, symbol]) => symbol).join(",");
  const url =
    "https://pro-api.coinmarketcap.com/public-api/v2/simple/price" +
    "?symbol=" + encodeURIComponent(symbols) +
    "&convert=USD&include_all=true&skip_invalid=true";

  const response = await httpsJson<{
    data?: Array<{
      id:number;
      name:string;
      symbol:string;
      slug:string;
      quotes?: Array<{
        symbol?:string;
        price?:number;
        market_cap?:number;
        volume_24h?:number;
        percent_change_24h?:number;
      }>;
    }>;
    status?: { error_code?: number; error_message?: string };
  }>(url, 10000);

  if (
    response.status < 200 ||
    response.status >= 300 ||
    !Array.isArray(response.body?.data) ||
    response.body.data.length < 6
  ) {
    throw new Error(
      "CoinMarketCap returned " +
      response.status +
      ": " +
      (response.body?.status?.error_message || "insufficient market data"),
    );
  }

  const fx = await getFxRate();
  if (!fx) throw new Error("Unable to get USD/NGN rate");

  const bySymbol = new Map(
    response.body.data.map(item => [String(item.symbol).toUpperCase(), item]),
  );

  const markets = COINS.map(([id, symbol, name]) => {
    const item = bySymbol.get(symbol);
    const quote = item?.quotes?.find(q => String(q.symbol ?? "").toUpperCase() === "USD")
      ?? item?.quotes?.[0];
    const priceUsd = numberOrZero(quote?.price);
    if (!priceUsd) return null;
    const marketCapUsd = numberOrZero(quote?.market_cap);
    const volumeUsd = numberOrZero(quote?.volume_24h);
    return {
      id,
      symbol,
      name,
      image: "",
      priceUsd,
      priceNgn: priceUsd * fx,
      change24h: numberOrZero(quote?.percent_change_24h),
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
  try {
    const data = await getCoinMarketCapMarkets();
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    res.json({
      provider: "CoinMarketCap",
      updatedAt: new Date().toISOString(),
      data,
    });
    return;
  } catch (error) {
    console.warn("[crypto/markets] CoinMarketCap failed; trying Binance", error);
  }

  try {
    const data = await getBinanceMarkets();
    res.setHeader("Cache-Control", "public, max-age=20, stale-while-revalidate=60");
    res.json({
      provider: "Binance",
      updatedAt: new Date().toISOString(),
      data,
    });
    return;
  } catch (error) {
    console.error("[crypto/markets] Binance fallback failed", error);
  }

  res.status(502).json({
    error: "Live crypto market data is temporarily unavailable. Please try again.",
  });
});

export default router;
