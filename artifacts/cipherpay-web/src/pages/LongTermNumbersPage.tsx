import { useEffect, useState } from "react";
import { ChevronRight, Clock3, LoaderCircle, MessageSquare, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { apiRequest } from "./page-api";
import "./LongTermNumbersPage.css";

type Rental = { rental_code?: string; code?: string; number?: string; country?: string; service?: string; expiry?: string; expires_at?: string; status?: string; [key: string]: any };

export default function LongTermNumbersPage() {
  const [stock, setStock] = useState<any[]>([]);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [selected, setSelected] = useState<Rental | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [stockData, activeData] = await Promise.all([
        apiRequest<any>("/api/sms/rentals/stock"),
        apiRequest<any>("/api/sms/rentals/active"),
      ]);
      setStock(Array.isArray(stockData) ? stockData : stockData?.data ?? stockData?.stock ?? []);
      setRentals(Array.isArray(activeData) ? activeData : activeData?.data ?? activeData?.rentals ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Long-term numbers are temporarily unavailable.");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

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
        <p>Manage long-term SMS rental numbers separately from international eSIM data plans. Keep the number active, check messages, and manage extensions from one workspace.</p>
        <div className="rentals-trust"><span><ShieldCheck size={15} /> Provider-connected</span><span><Clock3 size={15} /> Long-term rental</span><span><MessageSquare size={15} /> Messages in one place</span></div>
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
          {stock.length ? <div className="stock-list">{stock.slice(0, 12).map((item: any, index) => <div className="stock-row" key={String(item.id ?? item.code ?? index)}><span>{item.country ?? item.name ?? item.country_name ?? "International"}</span><b>{item.price ?? item.cost ?? item.amount ? String(item.price ?? item.cost ?? item.amount) : "Available"}</b><ChevronRight size={15} /></div>)}</div> : <p className="stock-empty">Live rental stock will appear here when the provider returns inventory.</p>}
        </section>
        <section className="rental-note"><ShieldCheck size={18} /><div><b>Separate from eSIM.</b><p>eSIM is for mobile data. Long-term numbers are for keeping a rental number and managing its messages and extensions.</p></div></section>
      </aside>
    </section>

    {selected && <section className="panel rental-messages"><div className="rentals-head"><div><span className="rentals-kicker">03 / MESSAGES</span><h2>{selected.number ?? "Rental messages"}</h2></div><button onClick={() => setSelected(null)}>Close</button></div>{messages.length ? messages.map((message, i) => <div className="message-row" key={String(message.id ?? i)}><b>{message.code ?? message.sms ?? message.message ?? "Message"}</b><small>{message.created_at ?? message.createdAt ?? ""}</small></div>) : <div className="rentals-empty"><MessageSquare size={22} /><p>No messages returned for this rental.</p></div>}</section>}

    {(notice || error) && <div className={notice ? "rental-notice" : "rental-notice error"}>{notice || error}</div>}
  </div>;
}
