import { Bell, ExternalLink, MailOpen, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'wouter';
import { useAnimatedDialog } from '../components/animated-dialog';
import { apiRequest, formatWhen } from './page-api';
import { Button, ErrorState, LoadingState, Notice, PageHeading } from './PagePieces';

type Notification = { id: number | string; title: string; body: string; type?: string; link?: string | null; isRead: boolean; createdAt: string };
type NotificationResponse = { data: Notification[]; unread: number };

function notificationLink(link?: string | null) {
  if (!link) return null;
  if (link.startsWith('/admin-support')) return link.replace('/admin-support', '/admin');
  return link;
}

export function NotificationsPage() {
  const { confirm } = useAnimatedDialog();
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const response = await apiRequest<NotificationResponse>('/api/notifications'); setItems(response.data ?? []); setUnread(response.unread ?? 0); }
    catch (reason: any) { setError(reason?.message ?? 'Notifications are unavailable right now.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const markRead = async (id: Notification['id']) => {
    try { await apiRequest(`/api/notifications/${id}/read`, { method: 'POST' }); setItems((current) => current.map((item) => item.id === id ? { ...item, isRead: true } : item)); setUnread((value) => Math.max(0, value - 1)); }
    catch (reason: any) { setNotice(reason?.message ?? 'Could not mark this notification read.'); }
  };
  const remove = async (id: Notification['id']) => {
    try { await apiRequest(`/api/notifications/${id}`, { method: 'DELETE' }); setItems((current) => current.filter((item) => item.id !== id)); setNotice('Notification deleted.'); }
    catch (reason: any) { setNotice(reason?.message ?? 'Could not delete this notification.'); }
  };
  const markAll = async () => {
    try { await apiRequest('/api/notifications/read-all', { method: 'POST' }); setItems((current) => current.map((item) => ({ ...item, isRead: true }))); setUnread(0); setNotice('All notifications marked read.'); }
    catch (reason: any) { setNotice(reason?.message ?? 'Could not mark notifications read.'); }
  };
  const removeAll = async () => {
    const shouldRemove = await confirm({
      title: 'Clear all notifications?',
      description: 'This will permanently remove every notification from your inbox.',
      confirmLabel: 'Clear all',
      destructive: true,
    });
    if (!shouldRemove) return;
    try { await apiRequest('/api/notifications', { method: 'DELETE' }); setItems([]); setUnread(0); setNotice('Notifications cleared.'); }
    catch (reason: any) { setNotice(reason?.message ?? 'Could not clear notifications.'); }
  };
  if (loading) return <div className="cp-page"><PageHeading eyebrow="CIPHERPAY / INBOX" title="Notifications." detail="Account and wallet updates, kept in one place." /><LoadingState label="Loading your notifications" /></div>;
  if (error) return <div className="cp-page"><PageHeading eyebrow="CIPHERPAY / INBOX" title="Notifications." detail="Account and wallet updates, kept in one place." /><ErrorState message={error} retry={() => void load()} /></div>;
  return <div className="cp-page">
    <PageHeading eyebrow="CIPHERPAY / INBOX" title="Notifications." detail={unread ? `${unread} update${unread === 1 ? '' : 's'} need your attention.` : 'You are all caught up.'} actions={<><Button variant="soft" type="button" onClick={() => void markAll()} disabled={!unread} data-testid="button-mark-all-read"><MailOpen size={15} /> Mark all read</Button><Button variant="quiet" type="button" onClick={() => void removeAll()} disabled={!items.length} data-testid="button-delete-all-notifications"><Trash2 size={15} /> Clear all</Button></>} />
    {notice && <div style={{ marginBottom: 14 }}><Notice>{notice}</Notice></div>}
    <section className="cp-card cp-card-pad" aria-label="Notifications list">
      {items.length ? <div className="cp-notification-list">{items.map((item) => <article className={`cp-notification ${item.isRead ? '' : 'unread'}`} key={item.id} data-testid={`row-notification-${item.id}`}>
        <span className="cp-notification-mark"><Bell size={16} /></span><div className="cp-notification-copy"><b>{item.title}</b><p>{item.body}</p><time>{formatWhen(item.createdAt)}</time></div>
        <div className="cp-actions">{!item.isRead && <button className="cp-icon-btn" type="button" onClick={() => void markRead(item.id)} aria-label="Mark notification read" data-testid={`button-mark-read-${item.id}`}><MailOpen size={16} /></button>}{notificationLink(item.link) && <Link className="cp-icon-btn" href={notificationLink(item.link)!} onClick={() => { if (!item.isRead) void markRead(item.id); }} aria-label="Open notification" data-testid={`link-notification-${item.id}`}><ExternalLink size={16} /></Link>}<button className="cp-icon-btn" type="button" onClick={() => void remove(item.id)} aria-label="Delete notification" data-testid={`button-delete-notification-${item.id}`}><Trash2 size={16} /></button></div>
        {!item.isRead && <i className="cp-unread-dot" aria-hidden="true" />}
      </article>)}</div> : <div className="cp-state"><div className="cp-state-inner"><span className="cp-state-icon"><Bell size={20} /></span><h2>No notifications yet</h2><p>Important updates about your wallet will appear here.</p></div></div>}
    </section>
  </div>;
}