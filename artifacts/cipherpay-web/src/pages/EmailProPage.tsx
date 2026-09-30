import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  FileText,
  Globe2,
  LockKeyhole,
  Mail,
  Plus,
  RefreshCw,
  Send,
  Server,
  Settings2,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
  Zap,
} from 'lucide-react';
import { apiRequest, formatWhen } from './page-api';
import { Button, ErrorState, LoadingState, Notice, PageHeading } from './PagePieces';
import { Link } from 'wouter';

type Provider = 'gmail' | 'outlook' | 'custom';
type ContentType = 'text' | 'html';

type EmailAccount = {
  id: number;
  provider: string;
  email: string;
  displayName: string;
  replyTo?: string | null;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  verifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type SentCampaign = {
  id: number;
  subject: string;
  fromName: string;
  fromEmail: string;
  recipientCount: number;
  acceptedCount: number;
  status: string;
  createdAt: string;
};

type SentRecipient = {
  id: number;
  email: string;
  status: string;
  smtpMessageId?: string | null;
  error?: string | null;
  acceptedAt?: string | null;
  createdAt: string;
};

type SentCampaignDetail = {
  campaign: SentCampaign & {
    replyTo?: string | null;
    body: string;
    contentType: ContentType;
    completedAt?: string | null;
  };
  recipients: SentRecipient[];
};

type AccountForm = {
  provider: Provider;
  host: string;
  port: string;
  secure: boolean;
  username: string;
  appPassword: string;
};

type SendForm = {
  accountId: string;
  fromName: string;
  replyTo: string;
  recipients: string;
  subject: string;
  body: string;
  contentType: ContentType;
};

type GuideKey = 'gmail' | 'outlook' | 'custom';
type ConnectionState = 'verified' | 'invalid' | 'idle';

const emptyAccountForm: AccountForm = {
  provider: 'gmail',
  host: 'smtp.gmail.com',
  port: '465',
  secure: true,
  username: '',
  appPassword: '',
};

const initialSendForm: SendForm = {
  accountId: '',
  fromName: '',
  replyTo: '',
  recipients: '',
  subject: '',
  body: '',
  contentType: 'text',
};

const providerDefaults: Record<Provider, { host: string; port: string; secure: boolean }> = {
  gmail: { host: 'smtp.gmail.com', port: '465', secure: true },
  outlook: { host: 'smtp.office365.com', port: '587', secure: false },
  custom: { host: '', port: '587', secure: false },
};

const guideContent: Record<GuideKey, { title: string; eyebrow: string; steps: string[]; note: string }> = {
  gmail: {
    title: 'Gmail with an app password',
    eyebrow: 'Google Workspace or personal Gmail',
    steps: [
      'Open myaccount.google.com/security and turn on 2-Step Verification.',
      'Open myaccount.google.com/apppasswords, create “CipherPay Email Pro”, and copy the 16-character code.',
      'Use your Gmail address as the username. Paste the code without the spaces Google displays.',
    ],
    note: 'Your regular Google password will not work. Gmail may still apply its own sending limits.',
  },
  outlook: {
    title: 'Outlook or Microsoft 365',
    eyebrow: 'Microsoft accounts and hosted mail',
    steps: [
      'Open account.microsoft.com/security and turn on two-step verification.',
      'Create an app password from Advanced security options, then copy it into the form.',
      'Use smtp.office365.com, port 587, and secure connection off for STARTTLS.',
    ],
    note: 'Some work or school tenants restrict SMTP AUTH. Your administrator may need to allow it.',
  },
  custom: {
    title: 'Custom-domain SMTP',
    eyebrow: 'Your domain, your mail host',
    steps: [
      'Copy the SMTP host, port, and encryption values from your mail host. Namecheap Private Email commonly uses smtp.privateemail.com.',
      'Use the full mailbox address as the username and an app-specific password when your host supports one.',
      'Use port 465 with secure connection on, or port 587 with it off, then test and check SPF/DKIM.',
    ],
    note: 'Delivery and inbox placement depend on your provider, domain reputation, and recipient systems.',
  },
};

function parseRecipients(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\s,;]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function providerLabel(provider: string) {
  if (provider === 'gmail') return 'Gmail';
  if (provider === 'outlook') return 'Outlook / Microsoft';
  return 'Custom SMTP';
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function maskedAddress(email: string) {
  const [name, domain] = email.split('@');
  if (!domain || name.length < 3) return email;
  return `${name.slice(0, 2)}•••@${domain}`;
}

function SentHistoryPanel({
  campaigns,
  sentHasMore,
  loadingMoreSent,
  lastSyncedAt,
  onLoadMore,
  onOpenCampaign,
}: {
  campaigns: SentCampaign[];
  sentHasMore: boolean;
  loadingMoreSent: boolean;
  lastSyncedAt: Date | null;
  onLoadMore: () => void;
  onOpenCampaign: (campaignId: number) => void;
}) {
  return (
    <section className="cp-card cp-card-pad email-pro-history-card">
      <div className="cp-card-head email-pro-card-head">
        <div><span className="email-pro-section-number">02 / ACTIVITY</span><h2>Sent history</h2><p>Open a campaign to see its message and every recipient.</p></div>
        <span className="email-pro-history-limit" data-testid="status-history-sync"><span className="email-pro-sync-dot" /> Auto-refreshing {lastSyncedAt ? `· ${formatWhen(lastSyncedAt.toISOString())}` : ''}</span>
      </div>
      {campaigns.length === 0 ? (
        <div className="email-pro-empty-state"><span className="email-pro-empty-mark"><Send size={18} /></span><strong>No campaigns yet</strong><p>Your first send will appear here with its provider acceptance status.</p></div>
      ) : (
        <div className="email-pro-history-list">
          {campaigns.map((campaign) => (
            <button type="button" className="email-pro-history-row email-pro-history-button" key={campaign.id} onClick={() => onOpenCampaign(campaign.id)} data-testid={`row-campaign-${campaign.id}`} aria-label={`View details for ${campaign.subject}`}>
              <span className="email-pro-history-icon"><Mail size={16} /></span>
              <span className="email-pro-history-copy"><strong data-testid={`text-campaign-subject-${campaign.id}`}>{campaign.subject}</strong><span>{campaign.fromName} · {maskedAddress(campaign.fromEmail)}</span><time dateTime={campaign.createdAt}>Sent {formatWhen(campaign.createdAt)}</time></span>
              <span className="email-pro-history-metrics"><span><Check size={13} /> <b>{campaign.acceptedCount}</b> / {campaign.recipientCount} accepted</span></span>
              <span className={`email-pro-status email-pro-status-${campaign.status.toLowerCase()}`}>{campaign.status}</span>
            </button>
          ))}
        </div>
      )}
      {campaigns.length > 0 && sentHasMore && <Button variant="soft" type="button" className="email-pro-load-more" onClick={onLoadMore} disabled={loadingMoreSent} data-testid="button-load-more-campaigns">{loadingMoreSent ? <><RefreshCw size={14} className="email-pro-spin" /> Loading history</> : 'Load more history'}</Button>}
    </section>
  );
}

function CampaignDetailDialog({
  detail,
  loading,
  error,
  onClose,
}: {
  detail: SentCampaignDetail | null;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  if (!loading && !detail && !error) return null;
  return (
    <div className="email-pro-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="email-pro-dialog cp-card" role="dialog" aria-modal="true" aria-labelledby="email-pro-dialog-title">
        <div className="email-pro-dialog-head">
          <div><span className="email-pro-section-number">CAMPAIGN DETAILS</span><h2 id="email-pro-dialog-title">{detail?.campaign.subject || 'Sent campaign'}</h2></div>
          <button type="button" className="cp-icon-btn" onClick={onClose} aria-label="Close campaign details" data-testid="button-close-campaign-details"><X size={17} /></button>
        </div>
        {loading ? <LoadingState label="Loading campaign details" /> : error ? <Notice tone="error">{error}</Notice> : detail ? (
          <div className="email-pro-dialog-body">
            <div className="email-pro-detail-grid">
              <div><span>From</span><strong>{detail.campaign.fromName}</strong><small>{detail.campaign.fromEmail}</small></div>
              <div><span>Reply-To</span><strong>{detail.campaign.replyTo || 'Same as sender'}</strong></div>
              <div><span>Status</span><strong className={`email-pro-status email-pro-status-${detail.campaign.status.toLowerCase()}`}>{detail.campaign.status}</strong></div>
              <div><span>Sent</span><strong>{formatWhen(detail.campaign.createdAt)}</strong></div>
            </div>
            <div className="email-pro-detail-block"><span className="email-pro-detail-label">Message</span><pre className="email-pro-detail-message">{detail.campaign.body}</pre></div>
            <div className="email-pro-detail-block">
              <div className="email-pro-detail-block-head"><span className="email-pro-detail-label">Sent to</span><strong>{detail.recipients.length} {detail.recipients.length === 1 ? 'recipient' : 'recipients'}</strong></div>
              <div className="email-pro-recipient-list">
                {detail.recipients.map((recipient) => <div className="email-pro-recipient-row" key={recipient.id}><span><strong>{recipient.email}</strong><small>{recipient.status === 'accepted' ? 'Accepted by provider' : recipient.error || recipient.status}</small></span><span className={`email-pro-status email-pro-status-${recipient.status}`}>{recipient.status}</span></div>)}
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export default function EmailProPage() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [campaigns, setCampaigns] = useState<SentCampaign[]>([]);
  const [sentHasMore, setSentHasMore] = useState(false);
  const [loadingMoreSent, setLoadingMoreSent] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [connectionStates, setConnectionStates] = useState<Record<number, ConnectionState>>({});
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [accountForm, setAccountForm] = useState<AccountForm>(emptyAccountForm);
  const [sendForm, setSendForm] = useState<SendForm>(initialSendForm);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
  const [guideKey, setGuideKey] = useState<GuideKey>('gmail');
  const [accountNotice, setAccountNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [sendNotice, setSendNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [savingAccount, setSavingAccount] = useState(false);
  const [testingAccount, setTestingAccount] = useState<number | null>(null);
  const [deletingAccount, setDeletingAccount] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [activeTab, setActiveTab] = useState<'compose' | 'sent'>('compose');
  const [campaignDetail, setCampaignDetail] = useState<SentCampaignDetail | null>(null);
  const [campaignDetailLoading, setCampaignDetailLoading] = useState(false);
  const [campaignDetailError, setCampaignDetailError] = useState('');
  const [subscription, setSubscription] = useState<{ unlocked: boolean; status: string; nextBillingAt: string | null; unlockFee: number; monthlyFee: number; freeEmails: number; usedEmails: number; remainingFreeEmails: number } | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  const refreshSent = useCallback(async (append = false) => {
    const offset = append ? campaigns.length : 0;
    const limit = append ? 30 : Math.max(30, Math.min(campaigns.length, 100));
    const response = await apiRequest<{ data: SentCampaign[]; hasMore?: boolean }>(`/api/email/sent?limit=${limit}${offset ? `&offset=${offset}` : ''}`);
    setCampaigns((current) => append
      ? [...current, ...(response.data ?? []).filter((campaign) => !current.some((item) => item.id === campaign.id))]
      : response.data ?? []);
    setSentHasMore(Boolean(response.hasMore));
    setLastSyncedAt(new Date());
  }, [campaigns.length]);

  const loadWorkspace = useCallback(async () => {
    setPageError('');
    setLoading(true);
    try {
      const subscriptionResponse = await apiRequest<{ unlocked: boolean; status: string; nextBillingAt: string | null; unlockFee: number; monthlyFee: number; freeEmails: number; usedEmails: number; remainingFreeEmails: number }>('/api/email/pro');
      setSubscription(subscriptionResponse);
      const [accountResponse, sentResponse] = await Promise.all([
        apiRequest<{ data: EmailAccount[] }>('/api/email/accounts'),
        apiRequest<{ data: SentCampaign[]; hasMore?: boolean }>('/api/email/sent?limit=30'),
      ]);
      setAccounts(accountResponse.data ?? []);
      setCampaigns(sentResponse.data ?? []);
      setSentHasMore(Boolean(sentResponse.hasMore));
      setLastSyncedAt(new Date());
      setConnectionStates((current) => Object.fromEntries((accountResponse.data ?? []).map((account) => [
        account.id,
        current[account.id] ?? (account.verifiedAt ? 'verified' : 'idle'),
      ])));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'We could not load your Email Pro workspace.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshSent().catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [refreshSent]);

  const recipients = useMemo(() => parseRecipients(sendForm.recipients), [sendForm.recipients]);
  const invalidRecipients = useMemo(() => recipients.filter((recipient) => !isValidEmail(recipient)), [recipients]);
  const activeGuide = guideContent[guideKey];
  const selectedAccount = accounts.find((account) => String(account.id) === sendForm.accountId);
  const emailProLocked = subscription?.unlocked === false && (subscription?.remainingFreeEmails ?? 0) <= 0;
  const freeEmailsRemaining = subscription?.remainingFreeEmails ?? 0;

  const updateAccountField = <K extends keyof AccountForm>(field: K, value: AccountForm[K]) => {
    setAccountForm((current) => ({ ...current, [field]: value }));
  };

  const updateSendField = <K extends keyof SendForm>(field: K, value: SendForm[K]) => {
    setSendForm((current) => ({ ...current, [field]: value }));
  };

  const openAccountForm = (provider: Provider = 'gmail') => {
    const defaults = providerDefaults[provider];
    setAccountForm({ ...emptyAccountForm, provider, host: defaults.host, port: defaults.port, secure: defaults.secure });
    setEditingAccountId(null);
    setAccountNotice(null);
    setShowAccountForm(true);
  };

  const openEditAccount = (account: EmailAccount) => {
    setEditingAccountId(account.id);
    setAccountForm({
      provider: account.provider === 'outlook' || account.provider === 'custom' ? account.provider : 'gmail',
      host: account.host,
      port: String(account.port),
      secure: account.secure,
      username: account.username || account.email,
      appPassword: '',
    });
    setAccountNotice(null);
    setShowAccountForm(true);
  };

  const handleProviderChange = (provider: Provider) => {
    const defaults = providerDefaults[provider];
    setAccountForm((current) => ({ ...current, provider, host: defaults.host, port: defaults.port, secure: defaults.secure }));
  };

  const handleSaveAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (emailProLocked && freeEmailsRemaining <= 0) return;
    setAccountNotice(null);
    if (!accountForm.host || !accountForm.username || !accountForm.appPassword) {
      setAccountNotice({ tone: 'error', message: 'Add the SMTP host, username, and app password.' });
      return;
    }
    setSavingAccount(true);
    try {
      const response = await apiRequest<{ account: EmailAccount; message: string }>('/api/email/accounts', {
        method: 'POST',
        body: {
          ...(editingAccountId ? { accountId: editingAccountId } : {}),
          provider: accountForm.provider,
          host: accountForm.host.trim(),
          port: Number(accountForm.port),
          secure: accountForm.secure,
          username: accountForm.username.trim(),
          appPassword: accountForm.appPassword,
        },
      });
      setAccounts((current) => [...current.filter((account) => account.id !== response.account.id), response.account]);
      setSendForm((current) => ({
        ...current,
        accountId: String(response.account.id),
        fromName: '',
        replyTo: response.account.replyTo ?? '',
      }));
      setAccountForm(emptyAccountForm);
      setShowAccountForm(false);
      setAccountNotice({ tone: 'success', message: response.message || 'Sending account saved securely.' });
      setConnectionStates((current) => ({ ...current, [response.account.id]: 'idle' }));
      await handleTestAccount(response.account);
    } catch (error) {
      setAccountNotice({ tone: 'error', message: error instanceof Error ? error.message : 'We could not save this account.' });
    } finally {
      setSavingAccount(false);
    }
  };

  const handleTestAccount = async (account: EmailAccount) => {
    if (emailProLocked && freeEmailsRemaining <= 0) return;
    setAccountNotice(null);
    setTestingAccount(account.id);
    try {
      const response = await apiRequest<{ ok: boolean; message: string }>(`/api/email/accounts/${account.id}/test`, { method: 'POST' });
      setConnectionStates((current) => ({ ...current, [account.id]: response.ok ? 'verified' : 'invalid' }));
      setAccountNotice({ tone: response.ok ? 'success' : 'error', message: response.ok ? `Configuration valid: ${response.message}` : `Configuration invalid: ${response.message}` });
      if (response.ok) {
        const refreshed = await apiRequest<{ data: EmailAccount[] }>('/api/email/accounts');
        setAccounts(refreshed.data ?? []);
      }
    } catch (error) {
      setConnectionStates((current) => ({ ...current, [account.id]: 'invalid' }));
      setAccountNotice({ tone: 'error', message: `Configuration invalid: ${error instanceof Error ? error.message : 'The connection test failed.'}` });
    } finally {
      setTestingAccount(null);
    }
  };

  const handleDeleteAccount = async (account: EmailAccount) => {
    if (emailProLocked && freeEmailsRemaining <= 0) return;
    if (!window.confirm(`Remove ${account.email} from Email Pro?`)) return;
    setAccountNotice(null);
    setDeletingAccount(account.id);
    try {
      const response = await apiRequest<{ success: boolean; message: string }>(`/api/email/accounts/${account.id}`, { method: 'DELETE' });
      setAccounts((current) => current.filter((item) => item.id !== account.id));
      setConnectionStates((current) => {
        const next = { ...current };
        delete next[account.id];
        return next;
      });
      if (sendForm.accountId === String(account.id)) setSendForm((current) => ({ ...current, accountId: '', fromName: '', replyTo: '' }));
      setAccountNotice({ tone: response.success ? 'success' : 'error', message: response.message });
    } catch (error) {
      setAccountNotice({ tone: 'error', message: error instanceof Error ? error.message : 'We could not remove this account.' });
    } finally {
      setDeletingAccount(null);
    }
  };

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (emailProLocked && freeEmailsRemaining <= 0) return;
    setSendNotice(null);
    if (!sendForm.accountId || !sendForm.fromName.trim() || !sendForm.subject.trim() || !sendForm.body.trim() || recipients.length === 0) {
      setSendNotice({ tone: 'error', message: 'Choose a sending account and add a display name, subject, message, and at least one recipient.' });
      return;
    }
    if (!selectedAccount?.verifiedAt) {
      setSendNotice({ tone: 'error', message: 'Test this sending account successfully before starting a campaign.' });
      return;
    }
    if (recipients.length > 150) {
      setSendNotice({ tone: 'error', message: 'Email Pro supports up to 150 recipients per send.' });
      return;
    }
    if (invalidRecipients.length > 0) {
      setSendNotice({ tone: 'error', message: `Check these recipient addresses: ${invalidRecipients.slice(0, 3).join(', ')}${invalidRecipients.length > 3 ? ' and more.' : '.'}` });
      return;
    }
    setSending(true);
    try {
      const response = await apiRequest<{ campaign: SentCampaign }>('/api/email/send', {
        method: 'POST',
        body: {
          accountId: Number(sendForm.accountId),
           fromName: sendForm.fromName.trim(),
          replyTo: sendForm.replyTo.trim(),
          recipients,
          subject: sendForm.subject.trim(),
          body: sendForm.body,
          contentType: sendForm.contentType,
        },
      });
      setCampaigns((current) => [response.campaign, ...current.filter((campaign) => campaign.id !== response.campaign.id)]);
      setLastSyncedAt(new Date());
      setSendNotice({ tone: 'success', message: `Campaign accepted for ${response.campaign.acceptedCount} of ${response.campaign.recipientCount} recipients.` });
      await loadWorkspace();
      setSendForm((current) => ({ ...current, recipients: '', subject: '', body: '' }));
    } catch (error) {
      setSendNotice({ tone: 'error', message: error instanceof Error ? error.message : 'We could not send this campaign.' });
    } finally {
      setSending(false);
    }
  };

  const handleLoadMoreSent = async () => {
    setLoadingMoreSent(true);
    try {
      await refreshSent(true);
    } catch (error) {
      setSendNotice({ tone: 'error', message: error instanceof Error ? error.message : 'We could not load more campaign history.' });
    } finally {
      setLoadingMoreSent(false);
    }
  };

  const openCampaignDetail = async (campaignId: number) => {
    setCampaignDetail(null);
    setCampaignDetailError('');
    setCampaignDetailLoading(true);
    try {
      const response = await apiRequest<SentCampaignDetail>(`/api/email/sent/${campaignId}`);
      setCampaignDetail(response);
    } catch (error) {
      setCampaignDetailError(error instanceof Error ? error.message : 'We could not load this campaign.');
    } finally {
      setCampaignDetailLoading(false);
    }
  };

  const closeCampaignDetail = () => {
    setCampaignDetail(null);
    setCampaignDetailError('');
    setCampaignDetailLoading(false);
  };

  if (loading) {
    return <div className="cp-page cp-page-reveal email-pro-page"><PageHeading eyebrow="CIPHERPAY / EMAIL PRO" title="Your private sending cockpit." detail="Loading your connected mailboxes and recent sending activity." /><LoadingState label="Loading Email Pro" /></div>;
  }

  if (pageError) {
    const insufficientFunds = /insufficient\\s+(funds|balance)|not enough (funds|balance)|insufficient/i.test(pageError);
    if (insufficientFunds) {
      return (
        <div className="cp-page cp-page-reveal email-pro-page" data-testid="email-pro-insufficient-funds">
          <PageHeading
            eyebrow="CIPHERPAY / EMAIL PRO"
            title="Email Pro"
            detail="Your renewal could not be completed."
          />
          <section
            className="cp-card email-pro-payment-error"
            role="alert"
            aria-labelledby="email-pro-payment-error-title"
            style={{
              maxWidth: 760,
              margin: '24px auto 0',
              padding: '48px 40px',
              textAlign: 'center',
              border: '1px solid rgba(248, 113, 113, 0.22)',
              background: 'linear-gradient(145deg, rgba(127, 29, 29, 0.16), rgba(36, 28, 50, 0.72))',
              boxShadow: '0 24px 70px rgba(0, 0, 0, 0.22)',
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                margin: '0 auto 20px',
                display: 'grid',
                placeItems: 'center',
                borderRadius: 18,
                color: '#fca5a5',
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(248, 113, 113, 0.2)',
              }}
            >
              <AlertCircle size={30} strokeWidth={1.8} />
            </div>
            <span
              className="cp-kicker"
              style={{
                color: '#fca5a5',
                letterSpacing: '0.14em',
                fontWeight: 700,
              }}
            >
              PAYMENT REQUIRED
            </span>
            <h2
              id="email-pro-payment-error-title"
              style={{
                margin: '10px 0 10px',
                fontSize: 'clamp(30px, 5vw, 44px)',
                lineHeight: 1.05,
              }}
            >
              Insufficient funds
            </h2>
            <p style={{ maxWidth: 540, margin: '0 auto', lineHeight: 1.65, opacity: 0.78 }}>
              Your wallet doesn’t have enough balance to complete your Email Pro renewal.
            </p>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 12,
                margin: '28px auto 24px',
                padding: '14px 18px',
                borderRadius: 14,
                background: 'rgba(255, 255, 255, 0.045)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              <span style={{ fontSize: 12, opacity: 0.6, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Amount due</span>
              <strong style={{ fontSize: 22 }}>₦3,000</strong>
            </div>
            <p style={{ margin: '0 auto 26px', fontSize: 14, opacity: 0.62 }}>
              Add at least ₦3,000 to your wallet, then try again.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Link
                href="/fund"
                className="btn btn-primary"
                data-testid="button-email-pro-add-funds"
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                Add funds <ArrowUpRight size={16} />
              </Link>
              <Button
                variant="secondary"
                type="button"
                onClick={() => void loadWorkspace()}
                data-testid="button-email-pro-retry-insufficient-funds"
              >
                <RefreshCw size={15} /> Try again
              </Button>
            </div>
            <div
              style={{
                marginTop: 28,
                paddingTop: 18,
                borderTop: '1px solid rgba(255, 255, 255, 0.07)',
                fontSize: 12,
                opacity: 0.5,
              }}
            >
              Email Pro requires ₦3,000 to unlock or renew for the next month.
            </div>
          </section>
        </div>
      );
    }
    return <div className="cp-page cp-page-reveal email-pro-page"><PageHeading eyebrow="CIPHERPAY / EMAIL PRO" title="Your private sending cockpit." detail="We could not reach the Email Pro workspace." /><ErrorState message={pageError} retry={loadWorkspace} /></div>;
  }

  return (
    <div className="cp-page cp-page-reveal email-pro-page">
      <PageHeading
        eyebrow="CIPHERPAY / EMAIL PRO"
        title="Private sending, with a clear trail."
        detail="Connect the mailbox you already trust, compose with precision, and keep a focused record of every campaign."
        actions={<Button variant="soft" type="button" onClick={() => void loadWorkspace()} data-testid="button-refresh-email-pro"><RefreshCw size={15} /> Refresh</Button>}
      />

      {subscription?.unlocked === false && (
        <section className="email-pro-lock-banner" role="status" aria-label="Email Pro locked">
          <div className="email-pro-lock-banner-copy">
            <span className="email-pro-mark"><LockKeyhole size={18} /></span>
            <div>
              <strong>{freeEmailsRemaining > 0 ? `${freeEmailsRemaining} free email${freeEmailsRemaining === 1 ? '' : 's'} remaining` : 'Your free emails are used'}</strong>
              <p>{freeEmailsRemaining > 0 ? `You can send your first ${subscription?.freeEmails ?? 5} emails free. After that, unlock Email Pro for ₦3,000, then ₦3,000/month to keep sending.` : 'Your 5 free emails are used. Unlock Email Pro for ₦3,000, then ₦3,000/month to keep sending.'}</p>
            </div>
          </div>
          <Button type="button" onClick={async () => {
            setUnlocking(true);
            try {
              const result = await apiRequest<{ nextBillingAt: string }>('/api/email/pro/unlock', { method: 'POST' });
              setSubscription({ unlocked: true, status: 'active', nextBillingAt: result.nextBillingAt, unlockFee: 3000, monthlyFee: 3000 });
              await loadWorkspace();
            } catch (e) {
              setPageError(e instanceof Error ? e.message : 'Could not unlock Email Pro.');
            } finally {
              setUnlocking(false);
            }
          }} disabled={unlocking}>
            {unlocking ? 'Unlocking…' : 'Unlock for ₦3,000'} <ArrowUpRight size={16} />
          </Button>
        </section>
      )}

      <section className="email-pro-hero" aria-label="Email Pro overview">
        <div className="email-pro-hero-orbit email-pro-hero-orbit-one" />
        <div className="email-pro-hero-orbit email-pro-hero-orbit-two" />
        <div className="email-pro-hero-copy">
          <span className="email-pro-mark"><Mail size={18} /></span>
          <div>
            <span className="cp-kicker">Private sender console</span>
            <h2>Send from the mailbox you trust.</h2>
            <p>Bring your own Gmail, Outlook, Namecheap, or custom SMTP connection. One focused place to compose, send, and follow the delivery trail.</p>
          </div>
        </div>
        <div className="email-pro-hero-stats">
           <div><strong data-testid="text-account-count">{accounts.length}</strong><span>connected {accounts.length === 1 ? 'mailbox' : 'mailboxes'}</span></div>
           <div><strong data-testid="text-campaign-count">{campaigns.length}</strong><span>campaigns in view</span></div>
        </div>
        <div className="email-pro-trust-line"><ShieldCheck size={15} /> Your SMTP credentials are never shown after saving.</div>
      </section>

      {accountNotice && <div className="email-pro-top-notice"><Notice tone={accountNotice.tone}>{accountNotice.message}</Notice></div>}

      <div className="email-pro-view-tabs" role="tablist" aria-label="Email Pro workspace">
        <button type="button" role="tab" aria-selected={activeTab === 'compose'} className={activeTab === 'compose' ? 'active' : ''} onClick={() => setActiveTab('compose')} data-testid="tab-email-compose"><Mail size={15} /> Compose</button>
        <button type="button" role="tab" aria-selected={activeTab === 'sent'} className={activeTab === 'sent' ? 'active' : ''} onClick={() => setActiveTab('sent')} data-testid="tab-email-sent-history"><FileText size={15} /> Sent history <span>{campaigns.length}</span></button>
      </div>

      <div className={`email-pro-workspace-grid ${activeTab === 'sent' ? 'email-pro-workspace-grid-sent' : ''}`}>
        <div className="email-pro-primary-column">
          {activeTab === 'compose' && <section className="cp-card cp-card-pad email-pro-composer-card">
            <div className="cp-card-head email-pro-card-head">
              <div>
                <span className="email-pro-section-number">01 / COMPOSE</span>
                <h2>Build a message that feels like you.</h2>
                <p>Recipients are sent privately and never exposed to one another.</p>
              </div>
              <span className="email-pro-secure-chip"><LockKeyhole size={13} /> Private send</span>
            </div>
            {sendNotice && <div className="email-pro-inline-notice"><Notice tone={sendNotice.tone}>{sendNotice.message}</Notice></div>}
            <form className="cp-form email-pro-form" onSubmit={handleSend}>
              <div className="cp-field">
                <label htmlFor="email-send-account">Send from</label>
                <select disabled={emailProLocked} id="email-send-account" value={sendForm.accountId} onChange={(event) => {
                  const account = accounts.find((item) => String(item.id) === event.target.value);
                  updateSendField('accountId', event.target.value);
                   if (account) setSendForm((current) => ({ ...current, accountId: event.target.value, replyTo: account.replyTo ?? '' }));
                }} data-testid="select-send-account">
                  <option value="">Choose a connected mailbox</option>
                   {accounts.map((account) => <option key={account.id} value={account.id}>{account.displayName || account.email} · {account.email}</option>)}
                </select>
                {accounts.length === 0 && <small className="email-pro-field-hint">Connect a mailbox in the panel beside this composer.</small>}
              </div>

              <div className="cp-field-row">
                <label className="cp-field" htmlFor="email-from-name"><span>Display name</span><input disabled={emailProLocked} id="email-from-name" value={sendForm.fromName} onChange={(event) => updateSendField('fromName', event.target.value)} placeholder="The name recipients see" data-testid="input-send-from-name" /></label>
                <label className="cp-field" htmlFor="email-reply-to"><span>Reply-To <em>optional</em></span><input disabled={emailProLocked} id="email-reply-to" type="email" value={sendForm.replyTo} onChange={(event) => updateSendField('replyTo', event.target.value)} placeholder="replies@yourdomain.com" data-testid="input-send-reply-to" /></label>
              </div>

              <label className="cp-field" htmlFor="email-recipients">
                <span className="email-pro-label-with-count">Recipients <strong className={recipients.length > 150 ? 'over' : ''} data-testid="text-recipient-count">{recipients.length} / 150</strong></span>
                <textarea disabled={emailProLocked} id="email-recipients" className="email-pro-recipients" value={sendForm.recipients} onChange={(event) => updateSendField('recipients', event.target.value)} placeholder="name@example.com, another@example.com&#10;You can paste one address per line." aria-describedby="recipient-help" data-testid="textarea-recipients" />
                <small id="recipient-help" className="email-pro-field-hint"><LockKeyhole size={12} /> Each recipient receives an individual message. Separate addresses with commas, spaces, or new lines.</small>
              </label>

              <label className="cp-field" htmlFor="email-subject"><span>Subject</span><input disabled={emailProLocked} id="email-subject" value={sendForm.subject} onChange={(event) => updateSendField('subject', event.target.value)} placeholder="A clear subject gets opened" data-testid="input-send-subject" /></label>

              <div className="email-pro-editor-toolbar" role="tablist" aria-label="Message format">
                <button disabled={emailProLocked} type="button" role="tab" aria-selected={sendForm.contentType === 'text'} className={sendForm.contentType === 'text' ? 'active' : ''} onClick={() => updateSendField('contentType', 'text')} data-testid="button-format-text"><FileText size={14} /> Plain text</button>
                <button disabled={emailProLocked} type="button" role="tab" aria-selected={sendForm.contentType === 'html'} className={sendForm.contentType === 'html' ? 'active' : ''} onClick={() => updateSendField('contentType', 'html')} data-testid="button-format-html"><Globe2 size={14} /> HTML</button>
                <span><Zap size={13} /> {sendForm.contentType === 'html' ? 'HTML accepted as written' : 'Readable everywhere'}</span>
              </div>
              <label className="cp-field" htmlFor="email-body"><span>Message</span><textarea disabled={emailProLocked} id="email-body" className="email-pro-body" value={sendForm.body} onChange={(event) => updateSendField('body', event.target.value)} placeholder={sendForm.contentType === 'html' ? '<p>Hello there,</p>' : 'Write your message here…'} data-testid="textarea-send-body" /></label>

              <div className="email-pro-send-bar">
                <div className="email-pro-send-meta">
                  <span><UserRound size={14} /> {recipients.length || 'No'} {recipients.length === 1 ? 'recipient' : 'recipients'}</span>
                  <span><ShieldCheck size={14} /> Bcc-style privacy</span>
                </div>
                <Button type="submit" disabled={emailProLocked || sending || accounts.length === 0 || !selectedAccount?.verifiedAt} data-testid="button-send-campaign">{sending ? <><RefreshCw size={15} className="email-pro-spin" /> Sending</> : <><Send size={15} /> Send campaign</>}</Button>
              </div>
            </form>
          </section>}
          {activeTab === 'sent' && <SentHistoryPanel campaigns={campaigns} sentHasMore={sentHasMore} loadingMoreSent={loadingMoreSent} lastSyncedAt={lastSyncedAt} onLoadMore={() => void handleLoadMoreSent()} onOpenCampaign={(campaignId) => void openCampaignDetail(campaignId)} />}
        </div>

        {activeTab === 'compose' && <aside className="email-pro-side-column">
          <section className="cp-card cp-card-pad email-pro-account-card">
            <div className="cp-card-head email-pro-card-head">
              <div><span className="email-pro-section-number">03 / EMAIL SETTINGS</span><h2>Your sending accounts</h2><p>Connect a mailbox with its SMTP app password.</p></div>
              <Settings2 size={18} className="email-pro-card-icon" />
            </div>
            <div className="email-pro-account-list">
              {accounts.length === 0 ? (
                <div className="email-pro-account-empty"><Server size={20} /><strong>Nothing connected yet</strong><span>Start with your most trusted mailbox.</span></div>
              ) : accounts.map((account) => (
                <div className={`email-pro-account-row ${sendForm.accountId === String(account.id) ? 'selected' : ''}`} key={account.id} data-testid={`row-account-${account.id}`}>
                  <button disabled={emailProLocked} type="button" className="email-pro-account-select" onClick={() => { if (!emailProLocked) setSendForm((current) => ({ ...current, accountId: String(account.id), replyTo: account.replyTo ?? '' })); }} data-testid={`button-select-account-${account.id}`}>
                    <span className="email-pro-provider-mark">{account.provider === 'gmail' ? 'G' : account.provider === 'outlook' ? 'O' : 'S'}</span>
                     <span><strong>{account.displayName || account.email}</strong><small>{account.email}</small></span>
                    <span className="email-pro-account-check">{sendForm.accountId === String(account.id) ? <Check size={14} /> : <ArrowUpRight size={14} />}</span>
                  </button>
                   <div className="email-pro-account-actions">
                      <span className={`email-pro-connection-status email-pro-connection-${connectionStates[account.id] ?? (account.verifiedAt ? 'verified' : 'idle')}`} data-testid={`status-account-${account.id}`}>{(connectionStates[account.id] ?? (account.verifiedAt ? 'verified' : 'idle')) === 'verified' ? 'Valid configuration' : (connectionStates[account.id] ?? 'idle') === 'invalid' ? 'Invalid configuration' : 'Not tested'}</span>
                    <Button variant="quiet" type="button" className="email-pro-mini-button" onClick={() => { if (!emailProLocked) void handleTestAccount(account); }} disabled={emailProLocked || testingAccount === account.id} data-testid={`button-test-account-${account.id}`}>{testingAccount === account.id ? <RefreshCw size={13} className="email-pro-spin" /> : <Zap size={13} />} Test</Button>
                     <Button variant="quiet" type="button" className="email-pro-mini-button" onClick={() => { if (!emailProLocked) openEditAccount(account); }} disabled={emailProLocked} data-testid={`button-edit-account-${account.id}`}><Settings2 size={13} /> Edit</Button>
                    <button type="button" className="email-pro-delete-button" onClick={() => void handleDeleteAccount(account)} disabled={emailProLocked || deletingAccount === account.id} aria-label={`Remove ${account.email}`} data-testid={`button-delete-account-${account.id}`}>{deletingAccount === account.id ? <RefreshCw size={13} className="email-pro-spin" /> : <Trash2 size={13} />}</button>
                  </div>
                </div>
              ))}
            </div>
            {showAccountForm ? (
              <form className="email-pro-account-form" onSubmit={handleSaveAccount}>
                 <div className="email-pro-form-title"><strong>{editingAccountId ? 'Reconfigure mailbox' : accounts.length ? 'Add another mailbox' : 'Connect your mailbox'}</strong><button type="button" onClick={() => { setShowAccountForm(false); setEditingAccountId(null); }} aria-label="Close account form" data-testid="button-close-account-form"><X size={16} /></button></div>
                <div className="email-pro-provider-tabs" role="tablist" aria-label="SMTP provider">
                  {(['gmail', 'outlook', 'custom'] as Provider[]).map((provider) => <button key={provider} type="button" role="tab" aria-selected={accountForm.provider === provider} className={accountForm.provider === provider ? 'active' : ''} onClick={() => handleProviderChange(provider)} data-testid={`button-provider-${provider}`}>{providerLabel(provider)}</button>)}
                </div>
                 <div className="email-pro-config-note"><LockKeyhole size={14} /><span>The mailbox address comes from your SMTP username. Sender name and Reply-To can be set per campaign.</span></div>
                <div className="email-pro-smtp-heading"><span>SMTP details</span><small>Provider-specific values can be changed.</small></div>
                <div className="cp-field-row"><label className="cp-field" htmlFor="account-host"><span>SMTP host</span><input disabled={emailProLocked} id="account-host" value={accountForm.host} onChange={(event) => updateAccountField('host', event.target.value)} placeholder="smtp.example.com" required data-testid="input-account-host" /></label><label className="cp-field" htmlFor="account-port"><span>Port</span><input disabled={emailProLocked} id="account-port" type="number" min="1" max="65535" value={accountForm.port} onChange={(event) => updateAccountField('port', event.target.value)} required data-testid="input-account-port" /></label></div>
                <label className="email-pro-toggle-row"><input disabled={emailProLocked} type="checkbox" checked={accountForm.secure} onChange={(event) => updateAccountField('secure', event.target.checked)} data-testid="input-account-secure" /><span><strong>Use secure connection</strong><small>Recommended for port 465. Port 587 typically uses STARTTLS.</small></span></label>
                <label className="cp-field" htmlFor="account-username"><span>SMTP username</span><input disabled={emailProLocked} id="account-username" value={accountForm.username} onChange={(event) => updateAccountField('username', event.target.value)} placeholder="Usually your full email address" autoComplete="username" required data-testid="input-account-username" /></label>
                 <label className="cp-field" htmlFor="account-app-password"><span>App password <em>{editingAccountId ? 'required again to verify changes' : ''}</em></span><input disabled={emailProLocked} id="account-app-password" type="password" value={accountForm.appPassword} onChange={(event) => updateAccountField('appPassword', event.target.value)} placeholder="Paste your app-specific password" autoComplete="new-password" required data-testid="input-account-app-password" /></label>
                <div className="email-pro-form-footnote"><LockKeyhole size={14} /><span>We use this credential to connect to your mailbox. It is not displayed after this form is saved.</span></div>
                 <Button type="submit" disabled={emailProLocked || savingAccount} data-testid="button-save-account">{savingAccount ? <><RefreshCw size={15} className="email-pro-spin" /> Saving and testing</> : <><Check size={15} /> {editingAccountId ? 'Save changes' : 'Save connection'}</>}</Button>
              </form>
            ) : <Button variant="soft" type="button" className="email-pro-add-account" onClick={() => openAccountForm()} disabled={emailProLocked} data-testid="button-add-account"><Plus size={15} /> Add sending account</Button>}
          </section>

          <section className="email-pro-guide">
            <div className="email-pro-guide-head"><div><span className="email-pro-section-number">04 / FIELD NOTES</span><h2>Provider setup guide</h2></div><CircleHelp size={18} /></div>
            <div className="email-pro-guide-tabs" role="tablist" aria-label="Provider setup guide">
              {(['gmail', 'outlook', 'custom'] as GuideKey[]).map((key) => <button type="button" role="tab" aria-selected={guideKey === key} className={guideKey === key ? 'active' : ''} key={key} onClick={() => setGuideKey(key)} data-testid={`button-guide-${key}`}>{providerLabel(key)}</button>)}
            </div>
               <div className="email-pro-guide-body" key={guideKey}>
               <span className="email-pro-guide-eyebrow">{activeGuide.eyebrow}</span><h3 data-testid="text-provider-guide-title">{activeGuide.title}</h3>
              <ol>{activeGuide.steps.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, '0')}</span><p>{step}</p></li>)}</ol>
              <div className="email-pro-guide-note"><AlertCircle size={14} /><span>{activeGuide.note}</span></div>
            </div>
          </section>

           <section className="email-pro-delivery-note"><ShieldCheck size={17} /><div><strong>Provider acceptance, clearly labeled</strong><p>Accepted means your mail provider took the message. It does not guarantee inbox delivery.</p></div></section>
        </aside>}
      </div>
      <CampaignDetailDialog detail={campaignDetail} loading={campaignDetailLoading} error={campaignDetailError} onClose={closeCampaignDetail} />
    </div>
  );
}