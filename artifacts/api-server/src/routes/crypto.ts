import { Router, type IRouter, type Request, type Response } from "express";
import { directFetch } from "../lib/direct-fetch";

const router: IRouter = Router();
const COINS = [
  ["bitcoin", "BTC", "Bitcoin"], ["ethereum", "ETH", "Ethereum"], ["solana", "SOL", "Solana"],
  ["tether", "USDT", "Tether"], ["usd-coin", "USDC", "USD Coin"], ["binancecoin", "BNB", "BNB"],
  ["ripple", "XRP", "XRP"], ["dogecoin", "DOGE", "Dogecoin"], ["cardano", "ADA", "Cardano"],
  ["avalanche-2", "AVAX", "Avalanche"], ["tron", "TRX", "TRON"], ["stellar", "XLM", "Stellar"],
] as const;
type CoinGeckoMarket = { id: string; symbol: string; name: string; image: string; current_price: number | null; market_cap: number | null; total_volume: number | null; price_change_percentage_24h: number | null };
const numberOrZero = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };

router.get("/crypto/markets", async (_req: Request, res: Response): Promise<void> => {
  const ids = COINS.map(([id]) => id).join(",");
  try {
    const marketUrl = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=" + encodeURIComponent(ids) + "&order=market_cap_desc&per_page=" + COINS.length + "&page=1&sparkline=false&price_change_percentage=24h";
    const [marketResponse, rateResponse] = await Promise.all([
      directFetch(marketUrl, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000) }),
      directFetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,ngn", { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000) }),
    ]);
    if (!marketResponse.ok) throw new Error("CoinGecko markets returned " + marketResponse.status);
    if (!rateResponse.ok) throw new Error("CoinGecko FX returned " + rateResponse.status);
    const marketData = await marketResponse.json() as CoinGeckoMarket[];
    const rateData = await rateResponse.json() as { bitcoin?: { usd?: number; ngn?: number } };
    const usdRate = numberOrZero(rateData.bitcoin?.usd), ngnRate = numberOrZero(rateData.bitcoin?.ngn);
    if (!ngnRate || !usdRate || !Array.isArray(marketData)) throw new Error("CoinGecko returned incomplete market data");
    const ngnPerUsd = ngnRate / usdRate;
    const byId = new Map(marketData.map(item => [item.id, item]));
    const data = COINS.map(([id, symbol, name]) => {
      const item = byId.get(id), priceUsd = numberOrZero(item?.current_price), marketCapUsd = numberOrZero(item?.market_cap), volumeUsd = numberOrZero(item?.total_volume);
      return { id, symbol, name, image: item?.image ?? "", priceUsd, priceNgn: priceUsd * ngnPerUsd, change24h: numberOrZero(item?.price_change_percentage_24h), marketCapUsd, marketCapNgn: marketCapUsd * ngnPerUsd, volumeUsd, volumeNgn: volumeUsd * ngnPerUsd };
    }).filter(item => item.priceUsd > 0);
    if (!data.length) throw new Error("CoinGecko returned no usable assets");
    res.setHeader("Cache-Control", "public, max-age=20, stale-while-revalidate=30");
    res.status(200).json({ provider: "CoinGecko", updatedAt: new Date().toISOString(), usdNgnRate: ngnPerUsd, data });
  } catch (error) {
    console.error("[crypto/markets]", error);
    res.status(502).json({ error: "Live crypto market data is temporarily unavailable. Please try again." });
  }
});
export default router;
