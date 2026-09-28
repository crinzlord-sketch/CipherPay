import { Check, Copy, Inbox, LoaderCircle, Mail, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useAnimatedDialog } from '../components/animated-dialog';
import { apiRequest, userFacingApiError } from './page-api';

const MAILBOX_API = 'https://mailboxtemp.com';

type Mailbox = {
  id: number;
  address: string;
  inboxId: string;
  expiresAt: string;
  status: 'active' | 'unavailable';
  createdAt: string;
};
type MailMessage = {
  id: string;
  from_address?: string;
  from_name?: string;
  subject?: string;
  preview?: string;
  body_text?: string;
  otp_code?: string | null;
  received_at?: string;
  read?: boolean;
};
type MailDetail = MailMessage & { body_html?: string };

async function mailRequest<T>(path: string): Promise<T> {
  const response = await fetch(`${MAILBOX_API}${path}`, { headers: { Accept: 'application/json' } });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(userFacingApiError(body, response.status));
  return body as T;
}

function messageText(message: MailDetail) {
  return message.body_text?.trim() || 'This message has no readable text body.';
}

function validExternalUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function linkedMessageText(text: string) {
  const parts: ReactNode[] = [];
  const pattern = /https?:\/\/[^\s<>"')\]]+/gi;
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const index = match.index;
    const displayUrl = raw.replace(/[.,!?;:]+$/, '');
    const url = validExternalUrl(displayUrl);
    if (index === undefined || !url) continue;
    parts.push(text.slice(cursor, index));
    parts.push(<a key={`${url}-${index}`} href={url} target="_blank" rel="noopener noreferrer">{displayUrl}</a>);
    parts.push(raw.slice(displayUrl.length));
    cursor = index + raw.length;
  }

  parts.push(text.slice(cursor));
  return parts;
}

function emailDocument(html: string) {
  const base = '<base target="_blank" rel="noopener noreferrer">';
  const style = '<style>html{background:#fff}body{max-width:100%;margin:0;padding:4px;color:#241b2f;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;overflow-wrap:anywhere}img{max-width:100%;height:auto}a{color:#7c3aed;text-decoration:underline}</style>';
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (tag) => `${tag}${base}${style}`);
  }
  return `<!doctype html><html><head>${base}${style}</head><body>${html}</body></html>`;
}

export default function TemporaryEmail() {
  const { confirm } = useAnimatedDialog();
  const [inboxes, setInboxes] = useState<Mailbox[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [selected, setSelected] = useState<MailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const selectedMailbox = useMemo(
    () => inboxes.find((inbox) => inbox.id === selectedId) ?? null,
    [inboxes, selectedId],
  );
  const loadInboxes = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiRequest<{ data: Mailbox[] }>('/api/temporary-email/inboxes');
      const next = response.data ?? [];
      setInboxes(next);
      setSelectedId((current) => current && next.some((inbox) => inbox.id === current) ? current : next[0]?.id ?? null);
    } catch (reason: any) {
      setError(reason?.message ?? 'Could not load your temporary inboxes.');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshInbox = useCallback(async (current: Mailbox | null, quiet = false) => {
    if (!current || current.status !== 'active') return;
    if (quiet) setRefreshing(true);
    try {
      const response = await mailRequest<{ emails: MailMessage[] }>(
        `/api/inbox/${encodeURIComponent(current.address)}/emails`,
      );
      setMessages(response.emails ?? []);
      setError('');
    } catch (reason: any) {
      setError(reason?.message ?? 'Could not refresh this inbox.');
    } finally {
      if (quiet) setRefreshing(false);
    }
  }, []);

  useEffect(() => { void loadInboxes(); }, [loadInboxes]);

  useEffect(() => {
    setMessages([]);
    setSelected(null);
    if (selectedMailbox) void refreshInbox(selectedMailbox);
  }, [selectedMailbox?.id, refreshInbox]);

  useEffect(() => {
    if (!selectedMailbox || selectedMailbox.status !== 'active') return;
    const socket = new WebSocket(`wss://mailboxtemp.com/ws/inbox?address=${encodeURIComponent(selectedMailbox.address)}`);
    socket.onmessage = () => void refreshInbox(selectedMailbox, true);
    socket.onerror = () => { /* the timed refresh below remains available */ };
    const interval = window.setInterval(() => void refreshInbox(selectedMailbox, true), 25_000);
    return () => {
      socket.close();
      window.clearInterval(interval);
    };
  }, [selectedMailbox?.id, selectedMailbox?.address, selectedMailbox?.status, refreshInbox]);

  const createMailbox = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setError('');
    try {
      const created = await apiRequest<Mailbox>('/api/temporary-email/inboxes', { method: 'POST' });
      setInboxes((current) => [...current, created]);
      setSelectedId(created.id);
    } catch (reason: any) {
      setError(reason?.message ?? 'Could not create an inbox.');
    } finally {
      setCreating(false);
    }
  };

  const removeMailbox = async (id: number) => {
    const shouldRemove = await confirm({
      title: 'Remove this inbox?',
      description: 'This inbox will no longer be renewed and its messages will no longer be available here.',
      confirmLabel: 'Remove inbox',
      destructive: true,
    });
    if (!shouldRemove) return;
    try {
      await apiRequest(`/api/temporary-email/inboxes/${id}`, { method: 'DELETE' });
      const remaining = inboxes.filter((inbox) => inbox.id !== id);
      setInboxes(remaining);
      setSelectedId((current) => current === id ? remaining[0]?.id ?? null : current);
      setSelected(null);
      setMessages([]);
    } catch (reason: any) {
      setError(reason?.message ?? 'Could not remove this inbox.');
    }
  };

  const openMessage = async (message: MailMessage) => {
    if (!selectedMailbox) return;
    setSelected({ ...message });
    try {
      const response = await mailRequest<{ email: MailDetail }>(
        `/api/email/${encodeURIComponent(selectedMailbox.address)}/${encodeURIComponent(message.id)}`,
      );
      setSelected(response.email);
      setMessages((current) => current.map((item) => item.id === response.email.id ? { ...item, read: true } : item));
    } catch (reason: any) {
      setError(reason?.message ?? 'Could not open this message.');
    }
  };

  const copyAddress = async () => {
    if (!selectedMailbox) return;
    try {
      await navigator.clipboard.writeText(selectedMailbox.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('Clipboard access is unavailable in this browser.');
    }
  };

  if (loading) return <div className="loading-state"><LoaderCircle size={20} className="spin" /> Loading your inboxes…</div>;

  return (
    <>
      <div className="page-title">
        <div><div className="eyebrow">TOOLS / TEMPORARY EMAIL</div><h1>Keep two quiet inboxes.</h1><p>Your inboxes are attached to this account and renewed while they remain active.</p></div>
        {inboxes.length < 2 && <form onSubmit={createMailbox}><button className="btn btn-primary" type="submit" disabled={creating} data-testid="button-create-temp-email"><Plus size={16} /> {creating ? 'Creating…' : 'New inbox'}</button></form>}
      </div>
      {error && <div className="error-box" role="alert">{error}</div>}
      {!inboxes.length ? (
        <div className="temp-start-grid">
          <form className="panel temp-create-panel" onSubmit={createMailbox}>
            <span className="temp-icon"><Mail size={22} /></span><h2>Create a temporary inbox</h2>
            <p>Keep up to two receive-only addresses for low-risk sign-ups and short-lived verification emails.</p>
            <button className="btn btn-primary full-btn" type="submit" disabled={creating} data-testid="button-create-temp-email">{creating ? <><LoaderCircle size={17} className="spin" /> Creating inbox…</> : <>Create inbox <Inbox size={17} /></>}</button>
            <p className="temp-disclaimer">The service can purge expired inboxes. Do not use them for banking, recovery, or sensitive information.</p>
          </form>
        </div>
      ) : (
        <div className="temp-inbox-layout">
          <section className="panel temp-inbox-panel">
            <div className="temp-inbox-tabs" role="tablist" aria-label="Your temporary inboxes">
              {inboxes.map((inbox, index) => <button key={inbox.id} type="button" role="tab" aria-selected={selectedId === inbox.id} className={selectedId === inbox.id ? 'active' : ''} onClick={() => setSelectedId(inbox.id)} data-testid={`button-temp-inbox-${index + 1}`}>
                <Mail size={15} /><span>Inbox {index + 1}</span><small>{inbox.status === 'active' ? 'Active' : 'Unavailable'}</small>
              </button>)}
            </div>
            {selectedMailbox && <><div className="temp-address-block"><span className="temp-icon"><Mail size={20} /></span><div><small>{selectedMailbox.status === 'active' ? `Renews before ${new Date(selectedMailbox.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'This address is no longer available'}</small><strong>{selectedMailbox.address}</strong></div><button className="icon-btn" type="button" onClick={copyAddress} aria-label="Copy temporary email">{copied ? <Check size={18} /> : <Copy size={18} />}</button><button className="icon-btn" type="button" onClick={() => void removeMailbox(selectedMailbox.id)} aria-label="Remove temporary inbox"><Trash2 size={17} /></button></div>
              <div className="temp-inbox-toolbar"><span>{messages.length} {messages.length === 1 ? 'message' : 'messages'}</span><button type="button" className="text-link" onClick={() => void refreshInbox(selectedMailbox)} disabled={refreshing} data-testid="button-refresh-temp-inbox"><RefreshCw size={15} className={refreshing ? 'spin' : ''} /> {refreshing ? 'Refreshing…' : 'Refresh'}</button></div></>}
            {messages.length ? <div className="temp-message-list">{messages.map((message) => <button key={message.id} type="button" className={`temp-message-row ${selected?.id === message.id ? 'selected' : ''} ${message.read ? '' : 'unread'}`} onClick={() => void openMessage(message)} data-testid={`button-temp-message-${message.id}`}><span className="temp-message-mark"><Mail size={16} /></span><span className="temp-message-copy"><b>{message.from_name || message.from_address || 'Unknown sender'}</b><strong>{message.subject || '(no subject)'}</strong><small>{message.preview || message.body_text || 'Open to read this message'}</small></span><time>{message.received_at ? new Date(message.received_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</time></button>)}</div> : <div className="temp-empty"><Inbox size={24} /><b>{selectedMailbox?.status === 'active' ? 'Your inbox is empty' : 'Inbox unavailable'}</b><span>{selectedMailbox?.status === 'active' ? 'New messages appear here automatically.' : 'Remove this inbox and create a new one.'}</span></div>}
          </section>
          <section className="panel temp-message-detail">
            {selected ? <div className="temp-detail-content">
              <div className="temp-detail-head">
                <div className="temp-detail-kicker"><span>MESSAGE</span><button className="temp-detail-close" type="button" onClick={() => setSelected(null)} aria-label="Close message"><X size={16} /></button></div>
                <h2>{selected.subject || '(no subject)'}</h2>
                <div className="temp-detail-meta"><span>From {selected.from_name ? `${selected.from_name} · ` : ''}{selected.from_address || 'Unknown sender'}</span><span>{selected.received_at ? new Date(selected.received_at).toLocaleString() : ''}</span></div>
                {selected.otp_code && <div className="temp-otp"><span>Detected code</span><strong>{selected.otp_code}</strong></div>}
              </div>
              <div className="temp-body-label">Email content</div>
              {selected.body_html ? <iframe className="temp-message-html" title="Email content" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={emailDocument(selected.body_html)} /> : <div className="temp-message-body">{linkedMessageText(messageText(selected))}</div>}
            </div> : <div className="temp-detail-empty"><Mail size={23} /><b>Select a message</b><span>Its contents and links will appear here.</span></div>}
          </section>
        </div>
      )}
    </>
  );
}