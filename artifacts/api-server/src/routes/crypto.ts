import { Router, type IRouter, type Request, type Response } from "express";
import { directFetch } from "../lib/direct-fetch";

const router: IRouter = Router();

const COINS = [
  ["bitcoin", "BTC", "Bitcoin"], ["ethereum", "ETH", "Ethereum"], ["solana", "SOL", "Solana"],
  ["tether", "USDT", "Tether"], ["usd-coin", "USDC", "USD Coin"], ["binancecoin", "BNB", "BNB"],
  ["ripple", "XRP", "XRP"], ["dogecoin", "DOGE", "Dogecoin"], ["cardano", "ADA", "Cardano"],
  ["avalanche-2", "AVAX", "Avalanche"], ["tron", "TRX", "TRON"], ["stellar", "XLM", "Stellar"],
] as const;

type Market = { id:string; symbol:string; name:string; image:string; priceUsd:number; priceNgn:number; change24h:number; marketCapUsd:number; marketCapNgn:number; volumeUsd:number; volumeNgn:number };
const numberOrZero = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };

async function getFxRate(): Promise<number> {
  try {
    const response = await directFetch("https://open.er-api.com/v6/latest/USD", { headers:{ accept:"application/json" }, signal:AbortSignal.timeout(8000) });
    if (response.ok) {
      const body = await response.json() as { rates?: { NGN?: number } };
      const rate = numberOrZero(body.rates?.NGN);
      if (rate > 0) return rate;
    }
  } catch {}
  return 0;
}

async function getBinanceMarkets(): Promise<Market[]> {
  const symbols = COINS.map(([, symbol]) => symbol).filter(symbol => symbol !== "USDT" && symbol !== "USDC").map(symbol => symbol + "USDT");
  const response = await directFetch("https://api.binance.com/api/v3/ticker/24hr?symbols=" + encodeURIComponent(JSON.stringify(symbols)), { headers:{ accept:"application/json" }, signal:AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Binance returned " + response.status);
  const rows = await response.json() as Array<{ symbol:string; lastPrice:string; priceChangePercent:string; quoteVolume:string }>;
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

router.get("/crypto/markets", async (_req: Request, res: Response): Promise<void> => {
  const ids = COINS.map(([id]) => id).join(",");
  try {
    const key = process.env.COINGECKO_API_KEY?.trim();
    const host = key && process.env.COINGECKO_API_PLAN === "pro" ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
    const headers: Record<string,string> = { accept:"application/json" };
    if (key) headers[process.env.COINGECKO_API_PLAN === "pro" ? "x-cg-pro-api-key" : "x-cg-demo-api-key"] = key;
    const marketResponse = await directFetch(host + "/coins/markets?vs_currency=usd&ids=" + encodeURIComponent(ids) + "&order=market_cap_desc&per_page=" + COINS.length + "&page=1&sparkline=false&price_change_percentage=24h", { headers, signal:AbortSignal.timeout(10000) });
    if (marketResponse.ok) {
      const marketData = await marketResponse.json() as Array<{id:string;image:string;current_price:number|null;market_cap:number|null;total_volume:number|null;price_change_percentage_24h:number|null}>;
      const fx = await getFxRate();
      if (fx && Array.isArray(marketData)) {
        const byId = new Map(marketData.map(item => [item.id,item]));
        const data = COINS.map(([id,symbol,name]) => {
          const item = byId.get(id), priceUsd=numberOrZero(item?.current_price), marketCapUsd=numberOrZero(item?.market_cap), volumeUsd=numberOrZero(item?.total_volume);
          return {id,symbol,name,image:item?.image??"",priceUsd,priceNgn:priceUsd*fx,change24h:numberOrZero(item?.price_change_percentage_24h),marketCapUsd,marketCapNgn:marketCapUsd*fx,volumeUsd,volumeNgn:volumeUsd*fx};
        }).filter(item=>item.priceUsd>0);
        if (data.length) {
          res.setHeader("Cache-Control","public, max-age=20, stale-while-revalidate=30");
          res.json({provider:key?"CoinGecko":"CoinGecko",updatedAt:new Date().toISOString(),usdNgnRate:fx,data});
          return;
        }
      }
    } else {
      console.warn("[crypto/markets] CoinGecko returned", marketResponse.status);
    }
    const fallback = await getBinanceMarkets();
    res.setHeader("Cache-Control","public, max-age=10, stale-while-revalidate=20");
    res.json({provider:"Binance fallback",updatedAt:new Date().toISOString(),usdNgnRate:fallback.length ? fallback[0].priceNgn/fallback[0].priceUsd : 0,data:fallback});
  } catch (error) {
    console.error("[crypto/markets]", error);
    res.status(502).json({ error:"Live crypto market data is temporarily unavailable. Please try again." });
  }
});

export default router;
