import { useEffect, useRef, useState } from "react";
import { ChevronRight, Clock3, LoaderCircle, MessageSquare, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { apiRequest } from "./page-api";
import "./LongTermNumbersPage.css";

type Rental = { rental_code?: string; code?: string; number?: string; country?: string; service?: string; expiry?: string; expires_at?: string; status?: string; [key: string]: any };

export default function LongTermNumbersPage() {
  const [stock, setStock] = useState<any[]>([]);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [selected, setSelected] = useState<Rental | null>(null);
  const [selectedStock, setSelectedStock] = useState<any | null>(null);
  const [pricing, setPricing] = useState<{ days: number; amount: number }[]>([]);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [buying, setBuying] = useState(false);
  const [confirmPurchase, setConfirmPurchase] = useState<{ days: number; amount: number } | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const purchaseRef = useRef<HTMLElement | null>(null);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [stockResult, activeResult] = await Promise.allSettled([
        apiRequest<any>("/api/sms/rentals/stock"),
        apiRequest<any>("/api/sms/rentals/active"),
      ]);

      const failures: string[] = [];
      if (stockResult.status === "fulfilled") {
        const stockData = stockResult.value;
        setStock(Array.isArray(stockData) ? stockData : stockData?.data ?? stockData?.stock ?? []);
      } else {
        failures.push(stockResult.reason?.message ?? "Rental stock is temporarily unavailable.");
        setStock([]);
      }

      if (activeResult.status === "fulfilled") {
        const activeData = activeResult.value;
        setRentals(Array.isArray(activeData) ? activeData : activeData?.data ?? activeData?.rentals ?? []);
      } else {
        failures.push(activeResult.reason?.message ?? "Active rentals are temporarily unavailable.");
        setRentals([]);
      }

      if (failures.length) setError(failures.join(" "));
    } catch (e: any) {
      setError(e?.message ?? "Long-term numbers are temporarily unavailable.");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const selectStock = async (item: any) => {
    const id = String(item?.id ?? item?.code ?? "");
    if (!id) return;
    setSelectedStock(item);
    setPricing([]);
    requestAnimationFrame(() => purchaseRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    setPricingLoading(true);
    setError("");
    try {
      const result = await apiRequest<any>(`/api/sms/rentals/pricing?id=${encodeURIComponent(id)}`);
      setPricing(Array.isArray(result?.options) ? result.options : []);
    } catch (e: any) {
      setError(e?.message ?? "Could not load rental pricing.");
    } finally {
      setPricingLoading(false);
      requestAnimationFrame(() => purchaseRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    }
  };

  const requestPurchase = (days: number, amount: number) => {
    if (!selectedStock || !days || buying) return;
    setConfirmPurchase({ days, amount });
    requestAnimationFrame(() => {
      document.getElementById("rental-purchase-review")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const buyRental = async (days: number) => {
    const id = String(selectedStock?.id ?? selectedStock?.code ?? "");
    if (!id || !days) return;
    setConfirmPurchase(null);
    setBuying(true); setError(""); setNotice("");
    try {
      const result = await apiRequest<any>("/api/sms/rentals/buy", { method: "POST", body: { id, days } });
      setNotice(result?.message ?? "Long-term number purchased successfully.");
      setSelectedStock(null);
      setPricing([]);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Could not purchase this long-term number.");
    } finally {
      setBuying(false);
    }
  };

  const openMessages = async (rental: Rental) => {
    const code = String(rental.rental_code ?? rental.code ?? "");
    if (!code) return;
    setSelected(rental); setMessages([]); setError("");
    try {
      const result = await apiRequest<any>(`/api/sms/rentals/messages?code=${encodeURIComponent(code)}`);
      setMessages(Array.isArray(result) ? result : result?.data ?? result?.messages ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Could not load rental messages.");
    }
  };

  const autoExtend = async (rental: Rental) => {
    const code = String(rental.rental_code ?? rental.code ?? "");
    if (!code) return;
    setNotice(""); setError("");
    try {
      const result = await apiRequest<any>("/api/sms/rentals/auto-extend", { method: "POST", body: { code } });
      setNotice(result?.message ?? "Auto-extension updated.");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Could not update auto-extension.");
    }
  };

  return <div className="rentals-page">
    <section className="rentals-hero">
      <div>
        <span className="rentals-badge"><Smartphone size={14} /> LONG-TERM NUMBERS</span>
        <h1>A number that stays<br /><span>with you.</span></h1>
        <p>Choose a long-term number, select how long you want to keep it, then manage messages and extensions from one workspace.</p>
        <div className="rentals-trust"><span><ShieldCheck size={15} /> Secure rental</span><span><Clock3 size={15} /> Long-term rental</span><span><MessageSquare size={15} /> Messages in one place</span></div>
      </div>
      <div className="rentals-visual"><div className="rentals-phone"><div className="rentals-screen"><span>ACTIVE NUMBER</span><b>+•••• ••••</b><small>Long-term rental</small><i>● Connected</i></div></div></div>
    </section>

    <section className="rentals-grid">
      <div className="rentals-panel panel">
        <div className="rentals-head"><div><span className="rentals-kicker">01 / YOUR NUMBERS</span><h2>Active rentals</h2></div><button onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} /></button></div>
        {loading ? <div className="rentals-empty"><LoaderCircle className="spin" /> Loading rentals…</div> :
          rentals.length ? <div className="rental-list">{rentals.map((rental, index) => {
            const code = String(rental.rental_code ?? rental.code ?? index);
            return <div className={selected === rental ? "rental-card active" : "rental-card"} key={code}>
              <div className="rental-icon"><Smartphone size={18} /></div><div className="rental-copy"><b>{rental.number ?? "Long-term number"}</b><small>{rental.country ?? "International"} · {rental.service ?? "SMS"}</small><em>{rental.expiry ?? rental.expires_at ?? rental.status ?? "Active"}</em></div>
              <button onClick={() => void openMessages(rental)}><MessageSquare size={15} /> Messages</button>
              <button onClick={() => void autoExtend(rental)}><RefreshCw size={15} /> Auto-extend</button>
            </div>;
          })}</div> :
          <div className="rentals-empty"><Smartphone size={25} /><p>No active long-term numbers yet.</p></div>}
      </div>

      <aside className="rentals-side">
        <section className="panel rental-stock"><div className="rentals-head"><div><span className="rentals-kicker">02 / AVAILABILITY</span><h2>Rental stock</h2></div></div>
          {stock.length ? <div className="stock-list">{stock.slice(0, 12).map((item: any, index) => <button type="button" className={selectedStock === item ? "stock-row selected" : "stock-row"} key={String(item.id ?? item.code ?? index)} onClick={() => void selectStock(item)}><span><b>{item.country ?? item.name ?? item.country_name ?? "International"}</b><small>{item.region ?? "Long-term number"}</small></span><em>{item.stockKnown && Number(item.stock ?? item.available ?? item.quantity ?? item.count ?? item.available_stock) > 0 ? `${Number(item.stock ?? item.available ?? item.quantity ?? item.count ?? item.available_stock)} available` : "Available"}</em><ChevronRight size={15} /></button>)}</div> : <p className="stock-empty">Live rental stock will appear here when available.</p>}
        </section>
        <section ref={purchaseRef} className="panel rental-purchase"><div className="rentals-head"><div><span className="rentals-kicker">03 / PURCHASE</span><h2>{selectedStock ? (selectedStock.country ?? selectedStock.name ?? "Long-term number") : "Select a number"}</h2></div></div>{!selectedStock ? <p className="stock-empty">Click a country above to view available rental durations and purchase.</p> : pricingLoading ? <div className="rentals-empty"><LoaderCircle className="spin" /> Loading rental options…</div> : pricing.length ? <><div className="rental-pricing-grid">{pricing.map((option) => <button type="button" key={option.days} className={confirmPurchase?.days === option.days ? "rental-price-option selected" : "rental-price-option"} disabled={buying} onClick={() => requestPurchase(option.days, Number(option.amount))}><span>{option.days} days</span><b>₦{Number(option.amount).toLocaleString("en-NG")}</b><small>{confirmPurchase?.days === option.days ? "Selected" : "Select & review"}</small><ChevronRight size={15} /></button>)}</div>{confirmPurchase && <div className="rental-purchase-review" id="rental-purchase-review"><div><span className="rentals-kicker">REVIEW BEFORE PAYMENT</span><h3>{selectedStock.country ?? selectedStock.name ?? "Long-term number"}</h3><p>{confirmPurchase.days} days rental</p></div><div className="rental-review-total"><span>Total to charge</span><b>₦{confirmPurchase.amount.toLocaleString("en-NG")}</b></div><div className="rental-review-actions"><button type="button" className="rental-cancel-btn" disabled={buying} onClick={() => setConfirmPurchase(null)}>Change</button><button type="button" className="rental-confirm-btn" disabled={buying} onClick={() => void buyRental(confirmPurchase.days)}>{buying ? "Processing…" : "Confirm & buy"}</button></div></div>}</> : <p className="stock-empty">No rental durations are available for this number right now.</p>}</section>
      </aside>
    </section>

    {selected && <section className="panel rental-messages"><div className="rentals-head"><div><span className="rentals-kicker">04 / MESSAGES</span><h2>{selected.number ?? "Rental messages"}</h2></div><button onClick={() => setSelected(null)}>Close</button></div>{messages.length ? messages.map((message, i) => <div className="message-row" key={String(message.id ?? i)}><b>{message.code ?? message.sms ?? message.message ?? "Message"}</b><small>{message.created_at ?? message.createdAt ?? ""}</small></div>) : <div className="rentals-empty"><MessageSquare size={22} /><p>No messages returned for this rental.</p></div>}</section>}


    {(notice || error) && <div className={notice ? "rental-notice" : "rental-notice error"}>{notice || error}</div>}
  </div>;
}
