import React, { useState } from 'react';
import { Link } from 'react-router';
import {
  useAppContext,
  PUBLICATION_SECTIONS,
  type DocumentItem
} from '../context/AppContext';
import { CONTACT_EMAIL } from '../config';
import SiteHeader from '../components/SiteHeader';
import SiteFooter from '../components/SiteFooter';

function PublicationCard({ doc }: { doc: DocumentItem }) {
  const isRequest = doc.accessMode === 'request';
  const hasLink = Boolean(doc.papermarkLink);

  const ctaClasses =
    'inline-flex items-center text-sm font-medium text-accent hover:text-accent-hover transition-colors cursor-pointer';

  return (
    <article className="group border border-border p-8 sm:p-10 hover:border-accent transition-colors bg-card/30">
      <span className="text-xs font-medium uppercase tracking-wider text-accent mb-3 block">
        {doc.productLine} &middot; {doc.edition}
      </span>

      <h3 className="font-serif text-xl text-foreground">{doc.title}</h3>

      {doc.editionTitle && (
        <p className="font-serif text-base text-foreground/70 italic mt-2">
          {doc.editionTitle}
        </p>
      )}

      <p className="text-sm text-foreground/70 leading-relaxed mt-5 mb-7 max-w-2xl">
        {doc.description}
      </p>

      <dl className="grid grid-cols-1 sm:grid-cols-[7rem_1fr] gap-x-6 gap-y-2 mb-8 text-xs leading-relaxed">
        <dt className="uppercase tracking-wider text-muted-foreground">Frequency</dt>
        <dd className="text-foreground/70">{doc.frequency}</dd>
        <dt className="uppercase tracking-wider text-muted-foreground">Audience</dt>
        <dd className="text-foreground/70">{doc.audience}</dd>
      </dl>

      {isRequest ? (
        <Link to="/#access" className={ctaClasses}>
          {doc.ctaLabel}
          <span className="ml-2 opacity-70 group-hover:translate-x-1 transition-transform">
            &rarr;
          </span>
        </Link>
      ) : (
        <a
          href={hasLink ? doc.papermarkLink : '#'}
          target={hasLink ? '_blank' : undefined}
          rel={hasLink ? 'noreferrer' : undefined}
          onClick={(e) => {
            if (!hasLink) {
              e.preventDefault();
              alert('Secure document link is pending update by administration.');
            }
          }}
          className={ctaClasses}
        >
          {doc.ctaLabel}
          <span className="ml-2 opacity-70 group-hover:translate-x-1 transition-transform">
            &rarr;
          </span>
        </a>
      )}

      {doc.attribution && (
        <p className="text-xs text-muted-foreground mt-8 pt-6 border-t border-border/60 max-w-xl leading-relaxed">
          {doc.attribution}
        </p>
      )}
    </article>
  );
}

export default function Home() {
  const { documents, setSubscribers } = useAppContext();

  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', organization: '', email: '' });
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleRequestAccess = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.organization || !formData.email) return;

    setSubscribers((prev) => [
      {
        id: Date.now().toString(),
        name: formData.name,
        organization: formData.organization,
        email: formData.email,
        status: 'Pending',
        createdAt: new Date().toISOString()
      },
      ...prev
    ]);

    setIsSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="max-w-5xl lg:max-w-6xl mx-auto px-6 py-20 sm:py-28">
        {/* Hero */}
        <header className="mb-24">
          <h1 className="font-serif text-3xl sm:text-4xl text-foreground mb-6 leading-tight tracking-tight">
            Athena Political &amp; Regulatory Intelligence
          </h1>
          <p className="text-lg sm:text-xl text-foreground/80 leading-relaxed mb-10 max-w-2xl">
            Independent political, regulatory and political-economy intelligence for
            organisations operating, investing and making strategic decisions in Nigeria.
          </p>

          <div className="flex flex-col sm:flex-row items-start gap-4">
            <Link
              to="/#access"
              className="bg-foreground text-background px-8 py-3.5 text-sm font-medium tracking-wide hover:bg-foreground/90 transition-colors"
            >
              Access Subscriber Library
            </Link>
            <Link
              to="/services"
              className="border border-border px-8 py-3.5 text-sm font-medium tracking-wide text-foreground hover:border-accent transition-colors"
            >
              Request a Briefing
            </Link>
          </div>
        </header>

        {/* Publications */}
        <section id="publications" className="mb-24 scroll-mt-28">
          <div className="mb-12">
            <h2 className="font-serif text-2xl text-foreground mb-4">
              Publications &amp; Briefings
            </h2>
            <p className="text-sm text-foreground/70 leading-relaxed max-w-2xl">
              APRI publishes written intelligence products on Nigeria&rsquo;s political,
              regulatory and political economy environment, issued to subscribers and
              authorised readers.
            </p>
          </div>

          <div className="space-y-16">
            {PUBLICATION_SECTIONS.map((section) => {
              const items = documents
                .filter((doc) => doc.section === section)
                .sort((a, b) => a.order - b.order);

              if (items.length === 0) return null;

              return (
                <div key={section}>
                  <h3 className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground mb-6 pb-3 border-b border-border">
                    {section}
                  </h3>
                  <div className="space-y-6">
                    {items.map((doc) => (
                      <PublicationCard key={doc.id} doc={doc} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-16 mb-24">
          {/* What APRI Tracks */}
          <section>
            <h2 className="font-serif text-xl text-foreground mb-6">What APRI Tracks</h2>
            <ul className="space-y-4 text-sm text-foreground/80">
              {[
                'Political Power & Coalition Stability',
                'Government & Regulatory Watch',
                'Policy Implementation Tracker',
                'State-Level Political & Operating Risk',
                'Political Economy Outlook'
              ].map((item) => (
                <li key={item} className="flex gap-3">
                  <span className="text-accent">&mdash;</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          {/* Designed For */}
          <section>
            <h2 className="font-serif text-xl text-foreground mb-6">Designed For</h2>
            <p className="text-sm text-foreground/80 leading-relaxed mb-8">
              Boards, CEOs, strategy teams, risk officers, government relations teams,
              investors and regulated businesses.
            </p>
            <Link
              to="/services"
              className="inline-flex items-center text-sm font-medium text-accent hover:text-accent-hover transition-colors"
            >
              Services &amp; Briefings <span className="ml-2 opacity-70">&rarr;</span>
            </Link>
          </section>
        </div>

        {/* Subscription Access */}
        <section id="access" className="mb-24 pt-16 border-t border-border scroll-mt-28">
          <h2 className="font-serif text-2xl text-foreground mb-4">Subscription Access</h2>
          <p className="text-sm text-foreground/70 leading-relaxed mb-10 max-w-2xl">
            Access to the APRI subscriber library is granted to authorised recipients.
            Submit your details below and a secure access link will be issued if approved.
          </p>

          {!showForm && !isSubmitted && (
            <button
              onClick={() => setShowForm(true)}
              className="bg-foreground text-background px-8 py-3.5 text-sm font-medium tracking-wide hover:bg-foreground/90 transition-colors cursor-pointer"
            >
              Request Access
            </button>
          )}

          {showForm && !isSubmitted && (
            <form
              onSubmit={handleRequestAccess}
              className="w-full max-w-md border border-border bg-card/30 p-6 space-y-4"
            >
              <h3 className="font-serif text-lg text-foreground mb-4">Request Access</h3>

              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent"
                placeholder="Full Name"
              />
              <input
                type="text"
                required
                value={formData.organization}
                onChange={(e) => setFormData({ ...formData, organization: e.target.value })}
                className="w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent"
                placeholder="Organization"
              />
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent"
                placeholder="Work Email"
              />

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  className="flex-1 bg-accent text-white px-4 py-2.5 text-sm font-medium tracking-wide hover:bg-accent-hover transition-colors cursor-pointer"
                >
                  Verify Email
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2.5 text-sm font-medium text-foreground/70 hover:text-foreground transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {isSubmitted && (
            <div className="border border-border bg-accent/5 p-6 w-full max-w-md">
              <p className="font-serif text-foreground text-lg mb-2">Request Received</p>
              <p className="text-sm text-foreground/80">
                Your details have been submitted. If authorized, a secure access link will
                be sent to your email.
              </p>
            </div>
          )}

          <div className="mt-10 pt-8 border-t border-border">
            <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
              <span className="font-medium text-foreground">Access note:</span> Access is
              restricted to authorised recipients. You may be asked to verify your email
              before viewing or downloading documents. Subscriber copies may be watermarked
              and tracked.
            </p>
          </div>
        </section>

        {/* Contact */}
        <section id="contact" className="mb-24 pt-16 border-t border-border scroll-mt-28">
          <h2 className="font-serif text-xl text-foreground mb-6">
            About Athena Political &amp; Regulatory Intelligence
          </h2>
          <p className="text-sm text-foreground/80 leading-relaxed mb-8 max-w-2xl">
            Athena Political &amp; Regulatory Intelligence helps business leaders understand
            how shifts in political power, public policy, regulation and institutional
            behaviour may affect their operating environment, investment decisions and
            strategic outlook.
          </p>

          <div className="text-sm">
            <span className="text-muted-foreground mr-2">Contact:</span>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-foreground hover:text-accent transition-colors font-medium"
            >
              {CONTACT_EMAIL}
            </a>
          </div>
        </section>

        <SiteFooter />
      </div>
    </div>
  );
}
