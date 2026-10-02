import { ArrowRight, Mail, Megaphone, ShieldCheck, WandSparkles } from 'lucide-react';
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
      <Link href="/kliphub" className="service-card service-card-kliphub">
        <span className="service-card-icon service-card-icon-kliphub"><WandSparkles size={22} /></span>
        <span className="service-card-copy">
          <span className="eyebrow">AI video studio</span>
          <strong>KlipHub</strong>
          <small>Create, organize and publish AI-powered videos from the same CipherPay account.</small>
        </span>
        <span className="service-card-link">Open KlipHub <ArrowRight size={16} /></span>
      </Link>
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
    <section className="service-note">
      <ShieldCheck size={18} />
      <span><b>One account, more tools.</b> KlipHub uses the same CipherPay account, so you can move between your wallet and creative workspace without signing in again.</span>
    </section>
  </>;
}