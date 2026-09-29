import { Bot, CheckCircle2, ChevronDown, CircleHelp, Headphones, Image as ImageIcon, MessageCircle, Paperclip, Receipt, RefreshCw, Send, UserRound, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { apiRequest, formatWhen } from './page-api';
import { Button, ErrorState, LoadingState, Notice, PageHeading } from './PagePieces';
import './cipherpay-pages.css';

type FaqItem = { id: string | number; q: string; a: string };
type ChatStatus = 'ai' | 'waiting' | 'live' | 'closed';
type Chat = { id: string | number; userId: string | number; status: ChatStatus; unreadForUser?: number; lastMessageAt?: string; createdAt?: string; agentTypingAt?: string | null };
type ChatMessage = { id: string | number; chatId: string | number; sender: 'user' | 'bot' | 'agent' | 'system'; body: string; imageUrl?: string | null; createdAt?: string };
type ChatResponse = { chat: Chat; messages: ChatMessage[] };
type HistoryItem = { chat: Chat; messages: ChatMessage[] };

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const map = new Map(current.map((message) => [String(message.id), message]));
  incoming.forEach((message) => map.set(String(message.id), message));
  return Array.from(map.values()).sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());
}

export function SupportPage() {
  const [faq, setFaq] = useState<FaqItem[]>([]);
  const [openFaq, setOpenFaq] = useState<string | number | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [faqLoading, setFaqLoading] = useState(true);
  const [chatLoading, setChatLoading] = useState(true);
  const [faqError, setFaqError] = useState('');
  const [chatError, setChatError] = useState('');
  const [networkError, setNetworkError] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [openHistory, setOpenHistory] = useState<string | number | null>(null);
  const [, setLocation] = useLocation();
  const messagesRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const messagesRefData = useRef<ChatMessage[]>([]);

  useEffect(() => { messagesRefData.current = messages; }, [messages]);

  const loadFaq = async () => {
    setFaqLoading(true);
    setFaqError('');
    try {
      const result = await apiRequest<{ items: FaqItem[] }>('/api/support/faq');
      setFaq(result.items ?? []);
    } catch (caught) {
      setFaqError(caught instanceof Error ? caught.message : 'Frequently asked questions are unavailable.');
    } finally {
      setFaqLoading(false);
    }
  };

  const loadChat = async () => {
    setChatLoading(true);
    setChatError('');
    try {
      const result = await apiRequest<ChatResponse>('/api/support/chat');
      setChat(result.chat);
      setMessages(mergeMessages([], result.messages ?? []));
    } catch (caught) {
      setChatError(caught instanceof Error ? caught.message : 'Your support chat could not be loaded.');
    } finally {
      setChatLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      const result = await apiRequest<{ data: HistoryItem[] }>('/api/support/history');
      setHistory(result.data ?? []);
    } catch {
      // History is secondary to the active support desk; keep the chat usable.
    }
  };

  useEffect(() => {
    void loadFaq();
    void loadChat();
    void loadHistory();
  }, []);

  useEffect(() => {
    if (!chat || chat.status === 'closed') return undefined;
    const poll = async () => {
      try {
        const last = messagesRefData.current[messagesRefData.current.length - 1];
        const query = last ? `?since=${encodeURIComponent(String(last.id))}` : '';
        const result = await apiRequest<ChatResponse>(`/api/support/chat/${chat.id}/poll${query}`);
        setChat(result.chat);
        setMessages((current) => mergeMessages(current, result.messages ?? []));
        setNetworkError('');
      } catch (caught) {
        setNetworkError(caught instanceof Error ? caught.message : 'We could not refresh the chat. Your message is safe.');
      }
    };
    const interval = window.setInterval(() => void poll(), 7000);
    return () => window.clearInterval(interval);
  }, [chat?.id, chat?.status]);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages.length]);

  const chatLabel = useMemo(() => {
    if (chat?.status === 'live') return 'A support specialist is here';
    if (chat?.status === 'waiting') return 'You are in the support queue';
    if (chat?.status === 'closed') return 'Chat closed';
    return 'CipherPay assistant';
  }, [chat?.status]);

  const sendMessage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !chat || chat.status === 'closed' || sending) return;
    setSending(true);
    setNetworkError('');
    try {
       const result = await apiRequest<ChatResponse>(`/api/support/chat/${chat.id}/message`, { method: 'POST', body: { body } });
      setMessages((current) => mergeMessages(current, result.messages ?? []));
      setChat(result.chat);
      setDraft('');
    } catch (caught) {
      setNetworkError(caught instanceof Error ? caught.message : 'Your message could not be sent. It is still in the box.');
    } finally {
      setSending(false);
    }
  };

  const uploadImage = async (file: File) => {
    if (!chat || chat.status === 'closed' || uploading || sending) return;
    if (!file.type.startsWith('image/')) {
      setNetworkError('Please choose an image file.');
      return;
    }
    setUploading(true);
    setNetworkError('');
    try {
      const imageData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read image.'));
        reader.onerror = () => reject(new Error('Could not read image.'));
        reader.readAsDataURL(file);
      });
      const uploaded = await apiRequest<{ url: string }>(`/api/support/chat/${chat.id}/upload-image`, { method: 'POST', body: { imageData } });
      const result = await apiRequest<ChatResponse>(`/api/support/chat/${chat.id}/message`, { method: 'POST', body: { body: '📷 Image', imageUrl: uploaded.url } });
      setMessages((current) => mergeMessages(current, result.messages ?? []));
      setChat(result.chat);
    } catch (caught) {
      setNetworkError(caught instanceof Error ? caught.message : 'The image could not be sent.');
    } finally {
      setUploading(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const chatAction = async (action: 'request-agent' | 'close') => {
    if (!chat || actionBusy) return;
    setActionBusy(true);
    setNetworkError('');
    try {
      const result = await apiRequest<{ chat?: Chat; messages?: ChatMessage[] }>(`/api/support/chat/${chat.id}/${action}`, { method: 'POST' });
      if (action === 'close') {
        setChat(null);
        setMessages([]);
        setDraft('');
        setLocation('/');
        return;
      }
      setChat(result.chat ?? { ...chat, status: 'waiting' });
      if (result.messages) setMessages((current) => mergeMessages(current, result.messages ?? []));
    } catch (caught) {
      setNetworkError(caught instanceof Error ? caught.message : 'That chat action could not be completed.');
    } finally {
      setActionBusy(false);
    }
  };

  if (chatLoading) return <main className="cp-page"><LoadingState label="Opening your support desk" /></main>;
  if (chatError && !chat) return <main className="cp-page"><ErrorState message={chatError} retry={() => void loadChat()} /></main>;

  return (
    <main className="cp-page cp-page-reveal">
      <PageHeading eyebrow="Account / support" title="A steady hand when you need one" detail="Find a quick answer or continue with the CipherPay support desk. Your conversation stays attached to your account." />
      <div className="cp-grid cp-grid-two cp-support-layout">
        <section className="cp-card cp-chat">
          <header className="cp-chat-head">
            <div className="cp-chat-title">
              <div className="cp-agent-mark">{chat?.status === 'live' ? <Headphones size={18} /> : <Bot size={18} />}</div>
              <div>
                <h2>Support desk</h2>
                <p>{chatLabel}</p>
                <span className={`cp-chat-status ${chat?.status === 'closed' ? 'closed' : ''}`}><i /> {chat?.status ?? 'ai'}</span>
              </div>
            </div>
            <div className="cp-actions">
              {chat?.status !== 'live' && chat?.status !== 'closed' && <Button variant="soft" type="button" onClick={() => void chatAction('request-agent')} disabled={actionBusy} data-testid="button-request-agent"><Headphones size={15} /> Talk to a person</Button>}
              {chat?.status !== 'closed' && <button className="cp-icon-btn" type="button" title="Close chat" onClick={() => void chatAction('close')} disabled={actionBusy} data-testid="button-close-chat"><X size={17} /></button>}
            </div>
          </header>
          {networkError && <div className="cp-chat-alert"><Notice tone="error">{networkError}</Notice></div>}
          <div className="cp-messages" ref={messagesRef} aria-live="polite" data-testid="list-chat-messages">
            {messages.length === 0 ? (
              <div className="cp-chat-empty"><div className="cp-empty-mark"><MessageCircle size={20} /></div><b>Start with a question</b><p>Ask about transfers, wallet funding, or any CipherPay service.</p></div>
            ) : messages.map((message) => (
              <div className={`cp-message ${message.sender === 'user' ? 'mine' : ''}`} key={message.id} data-testid={`message-chat-${message.id}`}>
                {message.sender !== 'user' && <small>{message.sender === 'agent' ? 'Support specialist' : message.sender === 'bot' ? 'CipherPay assistant' : 'CipherPay'}</small>}
                <div className="cp-message-bubble">{message.imageUrl && <img src={message.imageUrl} alt="Attachment from support conversation" />}{message.body !== '📷 Image' && message.body}</div>
                <time>{formatWhen(message.createdAt)}</time>
              </div>
            ))}
            {chat?.agentTypingAt && chat.status === 'live' && <div className="cp-typing" data-testid="status-agent-typing"><span /><span /><span /> Support is typing</div>}
          </div>
           <form className="cp-composer" onSubmit={sendMessage}>
            <label className="sr-only" htmlFor="support-message">Message support</label>
             <input ref={imageInputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImage(file); }} />
             <button className="cp-attach-btn" type="button" title="Attach an image" onClick={() => imageInputRef.current?.click()} disabled={uploading || sending || chat?.status === 'closed'}><Paperclip size={17} /></button>
            <input id="support-message" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={chat?.status === 'closed' ? 'This chat is closed' : 'Write a message…'} disabled={chat?.status === 'closed' || sending} data-testid="input-support-message" />
             <Button type="submit" disabled={!draft.trim() || sending || uploading || chat?.status === 'closed'} data-testid="button-send-message">{sending || uploading ? 'Sending…' : <Send size={16} />}</Button>
          </form>
        </section>

        <aside className="cp-chat-side">
          <section className="cp-card cp-card-pad">
            <div className="cp-card-head"><div><div className="cp-kicker">Quick answers</div><h2>Before you wait</h2><p>These are the questions customers ask most.</p></div><CircleHelp size={20} color="hsl(var(--primary))" /></div>
            {faqError && <Notice tone="error">{faqError} <button className="cp-inline-action" type="button" onClick={() => void loadFaq()} data-testid="button-retry-faq"><RefreshCw size={13} /> Retry</button></Notice>}
            {faqLoading ? <div className="cp-faq-loading"><div className="cp-skeleton" /><div className="cp-skeleton" /><div className="cp-skeleton" /></div> : faq.length === 0 ? (
              <div className="cp-empty-small"><CircleHelp size={18} /><b>No saved answers yet</b><span>Send us a message and we will help.</span></div>
            ) : (
              <div className="cp-faq-list">
                {faq.map((item) => {
                  const isOpen = openFaq === item.id;
                  return <div className={`cp-faq-item ${isOpen ? 'open' : ''}`} key={item.id}>
                    <button type="button" onClick={() => setOpenFaq(isOpen ? null : item.id)} aria-expanded={isOpen} data-testid={`button-faq-${item.id}`}><span>{item.q}</span><ChevronDown size={15} /></button>
                    {isOpen && <p data-testid={`text-faq-answer-${item.id}`}>{item.a}</p>}
                  </div>;
                })}
              </div>
            )}
          </section>
          <section className="cp-card cp-card-pad cp-chat-assurance">
            <div className="cp-help-row"><UserRound size={17} /><div><b>Real people, when it matters</b><p>Request a support specialist for account-sensitive questions.</p></div></div>
            <div className="cp-help-row"><LockKeyholeIcon /><div><b>Your chat is private</b><p>Only you and the CipherPay support team can see this thread.</p></div></div>
            <div className="cp-help-row"><Receipt size={17} /><div><b>Payment issue?</b><p>Send the transaction or funding reference in this chat. Support can use it to locate the exact record and investigate it from the admin console.</p></div></div>
          </section>
           <section className="cp-card cp-card-pad cp-support-history">
             <div className="cp-card-head"><div><div className="cp-kicker">Your records</div><h2>Support history</h2><p>Closed conversations stay available on your account.</p></div><MessageCircle size={20} color="hsl(var(--primary))" /></div>
             {history.length === 0 ? <div className="cp-empty-small"><ImageIcon size={18} /><span>No ended conversations yet.</span></div> : (
               <div className="cp-history-list">
                 {history.map((item) => {
                   const isOpen = openHistory === item.chat.id;
                   return <div className="cp-history-item" key={item.chat.id}>
                     <button type="button" onClick={() => setOpenHistory(isOpen ? null : item.chat.id)} aria-expanded={isOpen}>
                       <span><b>Conversation #{item.chat.id}</b><small>{formatWhen(item.chat.lastMessageAt)} · {item.messages.length} message{item.messages.length === 1 ? '' : 's'}</small></span><ChevronDown size={15} />
                     </button>
                     {isOpen && <div className="cp-history-messages">{item.messages.map((message) => <div className={`cp-message ${message.sender === 'user' ? 'mine' : ''}`} key={message.id}><div className="cp-message-bubble">{message.imageUrl && <img src={message.imageUrl} alt="Attachment from support conversation" />}{message.body !== '📷 Image' && message.body}</div><time>{formatWhen(message.createdAt)}</time></div>)}</div>}
                   </div>;
                 })}
               </div>
             )}
           </section>
        </aside>
      </div>
    </main>
  );
}

function LockKeyholeIcon() {
  return <span className="cp-small-lock" aria-hidden="true"><CheckCircle2 size={15} /></span>;
}
