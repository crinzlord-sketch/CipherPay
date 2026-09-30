import {
  Activity, ArrowLeft, Clock3, Eye, Globe2, LogIn, MapPin, Monitor, RefreshCw, ShieldCheck, Smartphone, Wifi, Zap, CreditCard
} from 'lucide-react';

function naira(value: unknown) {
  return '₦' + Number(value ?? 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatLagosWhen(value?: string | null) {
  if (!value) return 'Not available';
  return new Date(value).toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    dateStyle: 'medium',
    timeStyle: 'short',
  }) + ' WAT';
}

function statusClass(value: unknown) {
  return 'admin-status admin-status-' + String(value ?? 'unknown').toLowerCase().replaceAll('_', '-');
}

function DetailStat({ icon: Icon, label, value, detail, tone }: any) {
  return <div className={'admin-stat admin-stat-' + (tone || 'orange')}>
    <span className="admin-stat-icon"><Icon size={18} /></span>
    <div><small>{label}</small><strong>{value}</strong>{detail && <span>{detail}</span>}</div>
  </div>;
}

export default function UserDetailView({ detail, loading, onBack, onRefresh }: { detail: any; loading: boolean; onBack: () => void; onRefresh: () => void }) {
  const user = detail.user ?? {};
  const wallet = detail.wallet ?? {};
  const security = detail.security ?? {};
  const activity = detail.activity ?? {};
  const sessions = detail.sessions ?? [];
  const transactions = detail.transactions ?? [];
  const kyc = detail.kyc;
  const status = user.isSuspended ? 'Suspended' : user.isVerified ? 'Verified' : 'Unverified';

  const locationFor = (session: any) => {
    const l = session.location;
    if (!l) return 'Location unavailable / private IP';
    return [l.city, l.region, l.country].filter(Boolean).join(', ') || 'Location unavailable';
  };

  const txLabel = (type: string) => String(type ?? 'transaction')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());

  const fields = [
    ['Full name', String(user.firstName ?? '') + ' ' + String(user.lastName ?? '')],
    ['Email', user.email], ['Phone', user.phone], ['Account number', user.accountNumber],
    ['User code', user.userCode], ['Referral code', user.referralCode],
    ['Referred by', user.referredBy || 'Direct signup'], ['Referrals', detail.referrals ?? 0],
    ['Status', status], ['Suspension reason', user.suspendReason || '—'],
    ['Joined', formatLagosWhen(user.createdAt)], ['Last profile update', formatLagosWhen(user.updatedAt)],
  ];

  return <section className="admin-section admin-user-detail">
    <div className="admin-user-detail-top">
      <button type="button" className="admin-back-link" onClick={onBack}><ArrowLeft size={16} /> Back to users</button>
      <button type="button" className="admin-btn admin-btn-soft" onClick={onRefresh} disabled={loading}>
        <RefreshCw size={14} /> {loading ? 'Refreshing…' : 'Refresh profile'}
      </button>
    </div>

    <section className="cp-card cp-card-pad admin-user-hero">
      <div className="admin-user-hero-main">
        <span className="admin-user-detail-avatar">{String(user.firstName?.[0] ?? '')}{String(user.lastName?.[0] ?? '')}</span>
        <div>
          <span className="cp-kicker">CUSTOMER PROFILE · #{user.id ?? '—'}</span>
          <h2>{user.firstName} {user.lastName}</h2>
          <p>{user.email} · {user.phone || 'No phone'} · {user.userCode || 'No user code'}</p>
          <div className="admin-user-badges">
            <span className={statusClass(user.isSuspended ? 'suspended' : user.isVerified ? 'verified' : 'unverified')}>{status}</span>
            <span className="admin-protected-label">KYC L{user.kycLevel ?? 0}</span>
            {user.gender && <span className="admin-protected-label">{user.gender}</span>}
          </div>
        </div>
      </div>
      <div className="admin-user-hero-meta">
        <small>Account created</small><b>{formatLagosWhen(user.createdAt)}</b>
        <small>Profile updated</small><b>{formatLagosWhen(user.updatedAt)}</b>
      </div>
    </section>

    <div className="admin-user-stat-grid">
      <DetailStat icon={WalletIcon} label="Wallet balance" value={naira(wallet.balance)} detail={wallet.currency || 'NGN'} tone="green" />
      <DetailStat icon={Activity} label="Transactions" value={activity.transactionCount ?? transactions.length} detail={String(activity.successfulTransactions ?? 0) + ' successful'} tone="purple" />
      <DetailStat icon={LogIn} label="Last logged in" value={formatLagosWhen(security.lastLoggedInAt)} detail={security.lastDevice?.deviceName || 'No session recorded'} tone="orange" />
      <DetailStat icon={Globe2} label="Last IP" value={security.lastIpAddress || 'Not recorded'} detail={String(security.activeSessions ?? 0) + ' active sessions'} tone="blue" />
    </div>

    <div className="admin-user-detail-grid">
      <section className="cp-card cp-card-pad">
        <div className="admin-card-title"><div><span className="cp-kicker">IDENTITY & ACCOUNT</span><h2>Account information</h2><p>Core customer identifiers and account state.</p></div><Eye size={19} /></div>
        <div className="admin-detail-fields">{fields.map(([label, value]) =>
          <div key={String(label)}><small>{label}</small><b>{String(value ?? '—')}</b></div>
        )}</div>
      </section>

      <section className="cp-card cp-card-pad">
        <div className="admin-card-title"><div><span className="cp-kicker">SECURITY</span><h2>Login & device intelligence</h2><p>Recorded sessions, IP addresses, devices and approximate locations.</p></div><ShieldCheck size={19} /></div>
        <div className="admin-security-summary">
          <div><small>Active sessions</small><b>{security.activeSessions ?? 0}</b></div>
          <div><small>Total sessions</small><b>{security.totalSessions ?? sessions.length}</b></div>
          <div><small>Last login</small><b>{formatLagosWhen(security.lastLoggedInAt)}</b></div>
        </div>
        <div className="admin-session-list">{sessions.length ? sessions.map((session: any) =>
          <div className="admin-session-row" key={session.id}>
            <span className="admin-session-icon">{session.platform?.toLowerCase().includes('ios') || session.platform?.toLowerCase().includes('android') ? <Smartphone size={17} /> : <Monitor size={17} />}</span>
            <div className="admin-session-main">
              <b>{session.deviceName || 'Unknown device'}</b>
              <small>{session.platform || 'Unknown platform'} · Session #{session.id}</small>
              <small><MapPin size={12} /> {locationFor(session)}</small>
            </div>
            <div className="admin-session-meta">
              <b>{session.ipAddress || 'No IP recorded'}</b>
              <small><Clock3 size={12} /> Created {formatLagosWhen(session.createdAt)}</small>
              <small>Last active {formatLagosWhen(session.lastActiveAt)}</small>
              <span className={statusClass(session.revoked ? 'revoked' : 'active')}>{session.revoked ? 'Revoked' : 'Active'}</span>
            </div>
          </div>
        ) : <div className="admin-empty"><LogIn size={21} />No login sessions have been recorded.</div>}</div>
        <div className="admin-location-note"><Wifi size={14} /> IP-based locations are approximate and may identify the ISP/network area rather than the user’s exact physical address.</div>
      </section>
    </div>

    <div className="admin-user-detail-grid">
      <section className="cp-card cp-card-pad">
        <div className="admin-card-title"><div><span className="cp-kicker">WALLET</span><h2>Financial snapshot</h2><p>Current balances and lifetime movement from recorded successful transactions.</p></div><CreditCard size={19} /></div>
        <div className="admin-financial-grid">
          <div><small>Available balance</small><b>{naira(wallet.balance)}</b></div>
          <div><small>Ledger balance</small><b>{naira(wallet.ledgerBalance)}</b></div>
          <div><small>Total incoming</small><b>{naira(activity.totalIncoming)}</b></div>
          <div><small>Total outgoing</small><b>{naira(activity.totalOutgoing)}</b></div>
          <div><small>Fees recorded</small><b>{naira(activity.totalFees)}</b></div>
          <div><small>Provider balance</small><b>{naira(wallet.flwSubaccountBalance)}</b></div>
        </div>
      </section>

      <section className="cp-card cp-card-pad">
        <div className="admin-card-title"><div><span className="cp-kicker">VERIFICATION</span><h2>KYC record</h2><p>Identity-verification status and submitted identity details.</p></div><ShieldCheck size={19} /></div>
        {kyc ? <div className="admin-detail-fields">{[
          ['Status', kyc.status], ['Level', kyc.level], ['Document type', kyc.documentType],
          ['Document number', kyc.documentNumber], ['BVN', kyc.bvn], ['NIN', kyc.nin],
          ['Full name', kyc.fullName], ['Date of birth', kyc.dateOfBirth], ['Address', kyc.address],
          ['Submitted', formatLagosWhen(kyc.submittedAt)], ['Verified', formatLagosWhen(kyc.verifiedAt)],
          ['Rejection reason', kyc.rejectionReason || '—'],
        ].map(([label, value]) => <div key={String(label)}><small>{label}</small><b>{String(value ?? '—')}</b></div>)}</div>
          : <div className="admin-empty"><ShieldCheck size={21} />No KYC record found.</div>}
      </section>
    </div>

    <section className="cp-card cp-card-pad">
      <div className="admin-card-title"><div><span className="cp-kicker">TRANSACTION HISTORY</span><h2>All recorded wallet activity</h2><p>{transactions.length} transaction{transactions.length === 1 ? '' : 's'} loaded · timestamps shown in Lagos time (WAT).</p></div><Activity size={19} /></div>
      <div className="admin-table-wrap"><table className="admin-table admin-user-transactions"><thead><tr><th>Transaction</th><th>Amount</th><th>Status</th><th>Balance movement</th><th>Reference</th><th>Time</th></tr></thead>
        <tbody>{transactions.map((tx: any) => <tr key={tx.id}>
          <td><b>{txLabel(tx.type)}</b><small>#{tx.id} · {tx.description || '—'}{tx.isFlagged ? ' · FLAGGED' : ''}</small></td>
          <td><b>{naira(tx.amount)}</b><small>Fee {naira(tx.fee)}</small></td>
          <td><span className={statusClass(tx.isFlagged ? 'flagged' : tx.status)}>{tx.isFlagged ? 'Flagged' : tx.status}</span></td>
          <td><small>Before {tx.balanceBefore == null ? '—' : naira(tx.balanceBefore)}</small><small>After {tx.balanceAfter == null ? '—' : naira(tx.balanceAfter)}</small></td>
          <td><small className="admin-reference-cell">{tx.reference}</small></td>
          <td><small>{formatLagosWhen(tx.createdAt)}</small></td>
        </tr>)}</tbody>
      </table>{!transactions.length && <div className="admin-empty"><Activity size={21} />No transactions recorded for this user.</div>}</div>
    </section>

    <div className="admin-user-detail-grid">
      <section className="cp-card cp-card-pad">
        <div className="admin-card-title"><div><span className="cp-kicker">ACTIVITY COUNTS</span><h2>Services & engagement</h2><p>Usage counts across the platform.</p></div><Zap size={19} /></div>
        <div className="admin-financial-grid">
          <div><small>Notifications</small><b>{activity.notifications ?? 0}</b></div>
          <div><small>Support chats</small><b>{activity.supportChats ?? 0}</b></div>
          <div><small>Social Boost orders</small><b>{activity.socialOrders ?? 0}</b></div>
          <div><small>SMS activations</small><b>{activity.smsActivations ?? 0}</b></div>
          <div><small>Flagged transactions</small><b>{activity.flaggedTransactions ?? 0}</b></div>
          <div><small>Successful transactions</small><b>{activity.successfulTransactions ?? 0}</b></div>
        </div>
      </section>
      <section className="cp-card cp-card-pad">
        <div className="admin-card-title"><div><span className="cp-kicker">SYSTEM TIME</span><h2>Audit context</h2><p>Every timestamp on this profile is rendered for Lagos.</p></div><Clock3 size={19} /></div>
        <div className="admin-detail-fields">
          <div><small>Timezone</small><b>Africa/Lagos · WAT · UTC+1</b></div>
          <div><small>Profile generated</small><b>{formatLagosWhen(detail.generatedAt)}</b></div>
          <div><small>Known IP addresses</small><b>{(detail.knownIps ?? []).length}</b></div>
          <div><small>Session records shown</small><b>{sessions.length}</b></div>
        </div>
      </section>
    </div>
  </section>;
}

function WalletIcon(props: any) {
  return <span {...props}><CreditCard size={18} /></span>;
}
