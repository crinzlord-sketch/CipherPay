import { ArrowRight, Mail, Megaphone, ShieldCheck } from 'lucide-react';
import { Link } from 'wouter';
import { PageHeading } from './PagePieces';

export default function ServicesPage() {
  return <>
    <PageHeading
      eyebrow="CIPHERPAY / SERVICES"
      title="More ways to get things done."
      detail="Choose a service, keep everything in one wallet, and track what you use."
    />
    <section className="services-grid" aria-label="CipherPay services">
      <Link href="/social-boost" className="service-card service-card-featured">
        <span className="service-card-icon service-card-icon-orange"><Megaphone size={22} /></span>
        <span className="service-card-copy">
          <span className="eyebrow">Social growth</span>
          <strong>Social Boost</strong>
          <small>Order followers, likes, views, comments, and more across the platforms you use.</small>
        </span>
        <span className="service-card-link">Open service <ArrowRight size={16} /></span>
      </Link>
      <Link href="/email-pro" className="service-card service-card-featured service-card-email">
        <span className="service-card-icon service-card-icon-violet"><Mail size={22} /></span>
        <span className="service-card-copy">
          <span className="eyebrow">Your mailbox, upgraded</span>
          <strong>Email Pro</strong>
          <small>Connect Gmail, Outlook, or your domain mailbox. Send private bulk emails and see accepted and opened signals.</small>
        </span>
        <span className="service-card-link">Open service <ArrowRight size={16} /></span>
      </Link>
    </section>
  </>;
}