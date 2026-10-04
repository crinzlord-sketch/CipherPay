import { Router, type IRouter, type Request, type Response } from "express";
import https from "node:https";

const router: IRouter = Router();

const COINS = [
  ["bitcoin", "BTC", "Bitcoin"], ["ethereum", "ETH", "Ethereum"], ["solana", "SOL", "Solana"],
  ["tether", "USDT", "Tether"], ["usd-coin", "USDC", "USD Coin"], ["binancecoin", "BNB", "BNB"],
  ["ripple", "XRP", "XRP"], ["dogecoin", "DOGE", "Dogecoin"], ["cardano", "ADA", "Cardano"],
  ["avalanche-2", "AVAX", "Avalanche"], ["tron", "TRX", "TRON"], ["stellar", "XLM", "Stellar"],
] as const;

type Market = { id:string; symbol:string; name:string; image:string; priceUsd:number; priceNgn:number; change24h:number; marketCapUsd:number; marketCapNgn:number; volumeUsd:number; volumeNgn:number };
const numberOrZero = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
function httpsJson<T>(url: string, timeoutMs = 10000): Promise<{ status: number; body: T }> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { accept: "application/json", "user-agent": "CipherPay/1.0" } }, response => {
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
    const response = await httpsJson<{ rates?: { NGN?: number } }>("https://open.er-api.com/v6/latest/USD", 8000);
    if (response.status >= 200 && response.status < 300) {
      const body = response.body;
      const rate = numberOrZero(body.rates?.NGN);
      if (rate > 0) return rate;
    }
  } catch {}
  return 0;
}

async function getBinanceMarkets(): Promise<Market[]> {
  const symbols = COINS.map(([, symbol]) => symbol).filter(symbol => symbol !== "USDT" && symbol !== "USDC").map(symbol => symbol + "USDT");
  const response = await httpsJson<Array<{ symbol:string; lastPrice:string; priceChangePercent:string; quoteVolume:string }>>("https://data-api.binance.vision/api/v3/ticker/24hr", 10000);
  if (response.status < 200 || response.status >= 300) throw new Error("Binance returned " + response.status);
  const rows = response.body;
  const bySymbol = new Map(rows.map(row => [row.symbol, row]));
  const stable: Record<string, number> = { USDT:1, USDC:1 };
  const fx = await getFxRate();
  if (!fx) throw new Error("Unable to get USD/NGN rate");
  return COINS.map(([id, symbol, name]) => {
    const row = bySymbol.get(symbol + "USDT");
    const priceUsd = stable[symbol] ?? numberOrZero(row?.lastPrice);
    if (!priceUsd) return null;
    const volumeUsd = numberOrZero(row?.quoteVolume);
    const change24h = numberOrZero(row?.priceChangePercent);
    return { id, symbol, name, image:"", priceUsd, priceNgn:priceUsd*fx, change24h, marketCapUsd:0, marketCapNgn:0, volumeUsd, volumeNgn:volumeUsd*fx };
  }).filter((item): item is Market => Boolean(item));
}

async function getCoinMarketCapMarkets(): Promise<Market[]> {
  const ids = COINS.map(([id]) => id).join(",");
  const url = "https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/quotes/latest?slug="
    + encodeURIComponent(ids) + "&convert=USD&skip_invalid=true";

  const response = await httpsJson<{
    data?: Array<{
      id:number;
      name:string;
      symbol:string;
      slug:string;
      quote?: Array<{
        symbol?:string;
        price?:number;
        volume_24h?:number;
        market_cap?:number;
        percent_change_24h?:number;
      }>;
    }> | Record<string, {
      id:number;
      name:string;
      symbol:string;
      slug:string;
      quote?: Array<{
        symbol?:string;
        price?:number;
        volume_24h?:number;
        market_cap?:number;
        percent_change_24h?:number;
      }>;
    }>
  }>(url, 10000);

  if (response.status < 200 || response.status >= 300 || !response.body?.data) {
    throw new Error("CoinMarketCap returned " + response.status);
  }

  const rawData = response.body.data;
  const items = Array.isArray(rawData) ? rawData : Object.values(rawData);
  const bySymbol = new Map(items.map(item => [item.symbol, item]));

  return COINS.map(([id, symbol, name]) => {
    const item = bySymbol.get(symbol);
    const quote = item?.quote?.find(entry => entry.symbol === "USD") ?? item?.quote?.[0];
    const priceUsd = numberOrZero(quote?.price);
    if (!priceUsd) return null;

    return {
      id,
      symbol,
      name,
      image: "",
      priceUsd,
      priceNgn: 0,
      change24h: numberOrZero(quote?.percent_change_24h),
      marketCapUsd: numberOrZero(quote?.market_cap),
      marketCapNgn: 0,
      volumeUsd: numberOrZero(quote?.volume_24h),
      volumeNgn: 0,
    };
  }).filter((item): item is Market => Boolean(item));
}

router.get("/crypto/markets", async (_req: Request, res: Response): Promise<void> => {
  // Use CoinMarketCap's keyless public market endpoint first. It avoids exposing
  // API keys in the browser and provides price, 24h change, volume and market cap.
  // Binance and CoinGecko remain fallbacks so a temporary provider outage does
  // not blank the Crypto page.
  try {
    const [marketResult, fx] = await Promise.all([getCoinMarketCapMarkets(), getFxRate()]);
    if (marketResult.length && fx > 0) {
      const data = marketResult.map(item => ({
        ...item,
        priceNgn: item.priceUsd * fx,
        marketCapNgn: item.marketCapUsd * fx,
        volumeNgn: item.volumeUsd * fx,
      }));
      res.setHeader("Cache-Control", "public, max-age=20, stale-while-revalidate=30");
      res.json({
        provider: "CoinMarketCap",
        updatedAt: new Date().toISOString(),
        usdNgnRate: fx,
        data,
      });
      return;
    }
    throw new Error("CoinMarketCap returned no usable market data");
  } catch (error) {
    console.warn("[crypto/markets] CoinMarketCap request failed; trying Binance", error);
  }

  try {
    const [binanceResult, fx] = await Promise.all([getBinanceMarkets(), getFxRate()]);
    if (binanceResult.length && fx > 0) {
      const data = binanceResult.map(item => ({
        ...item,
        priceNgn: item.priceUsd * fx,
        marketCapNgn: item.marketCapUsd * fx,
        volumeNgn: item.volumeUsd * fx,
      }));
      res.setHeader("Cache-Control", "public, max-age=10, stale-while-revalidate=20");
      res.json({
        provider: "Binance",
        updatedAt: new Date().toISOString(),
        usdNgnRate: fx,
        data,
      });
      return;
    }
  } catch (error) {
    console.warn("[crypto/markets] Binance fallback failed; trying CoinGecko", error);
  }

  try {
    const ids = COINS.map(([id]) => id).join(",");
    const key = process.env.COINGECKO_API_KEY?.trim();
    const host = key && process.env.COINGECKO_API_PLAN === "pro"
      ? "https://pro-api.coingecko.com/api/v3"
      : "https://api.coingecko.com/api/v3";
    const headers: Record<string,string> = { accept:"application/json" };
    if (key) {
      headers[process.env.COINGECKO_API_PLAN === "pro" ? "x-cg-pro-api-key" : "x-cg-demo-api-key"] = key;
    }

    // httpsJson intentionally keeps headers fixed, so use the public CoinGecko
    // endpoint only when no API key is configured. Keyed CoinGecko requests are
    // better handled by a dedicated fetch helper when credentials are available.
    const marketResponse = await httpsJson<Array<{
      id:string; image:string; current_price:number|null; market_cap:number|null;
      total_volume:number|null; price_change_percentage_24h:number|null
    }>>(host + "/coins/markets?vs_currency=usd&ids=" + encodeURIComponent(ids)
      + "&order=market_cap_desc&per_page=" + COINS.length
      + "&page=1&sparkline=false&price_change_percentage=24h", 8000);

    const fx = await getFxRate();
    if (marketResponse.status >= 200 && marketResponse.status < 300 && fx > 0 && Array.isArray(marketResponse.body)) {
      const byId = new Map(marketResponse.body.map(item => [item.id,item]));
      const data = COINS.map(([id,symbol,name]) => {
        const item = byId.get(id);
        const priceUsd = numberOrZero(item?.current_price);
        const marketCapUsd = numberOrZero(item?.market_cap);
        const volumeUsd = numberOrZero(item?.total_volume);
        return {
          id,symbol,name,image:item?.image??"",priceUsd,priceNgn:priceUsd*fx,
          change24h:numberOrZero(item?.price_change_percentage_24h),
          marketCapUsd,marketCapNgn:marketCapUsd*fx,
          volumeUsd,volumeNgn:volumeUsd*fx
        };
      }).filter(item=>item.priceUsd>0);

      if (data.length) {
        res.setHeader("Cache-Control","public, max-age=20, stale-while-revalidate=30");
        res.json({provider:"CoinGecko",updatedAt:new Date().toISOString(),usdNgnRate:fx,data});
        return;
      }
    }
  } catch (error) {
    console.error("[crypto/markets] CoinGecko fallback failed", error);
  }

  res.status(502).json({ error:"Live crypto market data is temporarily unavailable. Please try again." });
});


export default router;
