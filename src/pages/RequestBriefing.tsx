import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  useAppContext,
  BRIEFING_TYPES,
  BRIEFING_FORMATS,
  type BriefingType,
  type BriefingFormat
} from '../context/AppContext';
import { SECTOR_OPTIONS } from '../data/services';
import SiteHeader from '../components/SiteHeader';
import SiteFooter from '../components/SiteFooter';

const fieldClass =
  'w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent';

const labelClass =
  'block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2';

function isBriefingType(value: string): value is BriefingType {
  return (BRIEFING_TYPES as readonly string[]).includes(value);
}

export default function RequestBriefing() {
  const { setBriefingRequests } = useAppContext();
  const [searchParams] = useSearchParams();

  // The service cards preselect their own briefing type via ?type=
  const requestedType = searchParams.get('type') ?? '';

  const [form, setForm] = useState({
    name: '',
    organization: '',
    role: '',
    email: '',
    phone: '',
    briefingType: (isBriefingType(requestedType) ? requestedType : '') as BriefingType | '',
    preferredFormat: '' as BriefingFormat | '',
    timeline: '',
    sector: '',
    issueDescription: '',
    audienceSize: '',
    location: ''
  });

  const [isSubmitted, setIsSubmitted] = useState(false);

  const update = (field: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  // Location is only relevant when the session is in person.
  const needsLocation = form.preferredFormat === 'In person' || form.preferredFormat === 'Either';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    setBriefingRequests((prev) => [
      {
        id: Date.now().toString(),
        ...form,
        status: 'New',
        createdAt: new Date().toISOString()
      },
      ...prev
    ]);

    setIsSubmitted(true);
    window.scrollTo({ top: 0 });
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="max-w-5xl lg:max-w-6xl mx-auto px-6 py-20 sm:py-28">
          <div className="max-w-2xl">
            <h1 className="font-serif text-3xl text-foreground mb-6 leading-tight">
              Request Received
            </h1>
            <p className="text-sm text-foreground/80 leading-relaxed mb-10">
              Thank you. Your briefing request has been recorded. A member of the APRI team
              will respond to discuss scope, audience and availability.
            </p>
            <Link
              to="/services"
              className="inline-flex items-center text-sm font-medium text-accent hover:text-accent-hover transition-colors"
            >
              Return to Services &amp; Briefings <span className="ml-2 opacity-70">&rarr;</span>
            </Link>
          </div>
          <div className="mt-24">
            <SiteFooter />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="max-w-5xl lg:max-w-6xl mx-auto px-6 py-20 sm:py-28">
        <header className="mb-16 max-w-2xl">
          <h1 className="font-serif text-3xl text-foreground mb-6 leading-tight tracking-tight">
            Request a Briefing
          </h1>
          <p className="text-sm text-foreground/70 leading-relaxed">
            Tell us what you need and we will respond to discuss scope, audience and
            availability. APRI briefings are independent analytical sessions.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="max-w-2xl space-y-10">
          {/* Requester */}
          <fieldset className="space-y-6">
            <legend className="font-serif text-lg text-foreground mb-6">Your details</legend>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className={labelClass} htmlFor="name">
                  Name
                </label>
                <input
                  id="name"
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="organization">
                  Organisation
                </label>
                <input
                  id="organization"
                  type="text"
                  required
                  value={form.organization}
                  onChange={(e) => update('organization', e.target.value)}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="role">
                  Role / title
                </label>
                <input
                  id="role"
                  type="text"
                  required
                  value={form.role}
                  onChange={(e) => update('role', e.target.value)}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="phone">
                  Phone number
                </label>
                <input
                  id="phone"
                  type="tel"
                  required
                  value={form.phone}
                  onChange={(e) => update('phone', e.target.value)}
                  className={fieldClass}
                />
              </div>
            </div>
          </fieldset>

          {/* Session */}
          <fieldset className="space-y-6 pt-10 border-t border-border">
            <legend className="font-serif text-lg text-foreground mb-6">
              The briefing
            </legend>

            <div>
              <label className={labelClass} htmlFor="briefingType">
                Type of briefing requested
              </label>
              <select
                id="briefingType"
                required
                value={form.briefingType}
                onChange={(e) => update('briefingType', e.target.value)}
                className={fieldClass}
              >
                <option value="">Select a briefing type</option>
                {BRIEFING_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className={labelClass} htmlFor="preferredFormat">
                  Preferred format
                </label>
                <select
                  id="preferredFormat"
                  required
                  value={form.preferredFormat}
                  onChange={(e) => update('preferredFormat', e.target.value)}
                  className={fieldClass}
                >
                  <option value="">Select a format</option>
                  {BRIEFING_FORMATS.map((format) => (
                    <option key={format} value={format}>
                      {format}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="timeline">
                  Preferred date or timeline
                </label>
                <input
                  id="timeline"
                  type="text"
                  required
                  value={form.timeline}
                  onChange={(e) => update('timeline', e.target.value)}
                  className={fieldClass}
                  placeholder="e.g. late September, or within 30 days"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="sector">
                  Sector
                </label>
                <input
                  id="sector"
                  type="text"
                  required
                  list="sector-options"
                  value={form.sector}
                  onChange={(e) => update('sector', e.target.value)}
                  className={fieldClass}
                />
                <datalist id="sector-options">
                  {SECTOR_OPTIONS.map((sector) => (
                    <option key={sector} value={sector} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className={labelClass} htmlFor="audienceSize">
                  Audience size
                </label>
                <input
                  id="audienceSize"
                  type="text"
                  required
                  value={form.audienceSize}
                  onChange={(e) => update('audienceSize', e.target.value)}
                  className={fieldClass}
                  placeholder="e.g. 12 board members"
                />
              </div>
            </div>

            {needsLocation && (
              <div>
                <label className={labelClass} htmlFor="location">
                  Location, if in person
                </label>
                <input
                  id="location"
                  type="text"
                  value={form.location}
                  onChange={(e) => update('location', e.target.value)}
                  className={fieldClass}
                  placeholder="City and venue, if known"
                />
              </div>
            )}

            <div>
              <label className={labelClass} htmlFor="issueDescription">
                Brief description of the issue or session
              </label>
              <textarea
                id="issueDescription"
                required
                rows={5}
                value={form.issueDescription}
                onChange={(e) => update('issueDescription', e.target.value)}
                className={fieldClass}
              />
            </div>
          </fieldset>

          <div className="flex items-center gap-6 pt-8 border-t border-border">
            <button
              type="submit"
              className="bg-foreground text-background px-8 py-3.5 text-sm font-medium tracking-wide hover:bg-foreground/90 transition-colors cursor-pointer"
            >
              Submit Request
            </button>
            <Link
              to="/services"
              className="text-sm font-medium text-foreground/70 hover:text-foreground transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>

        <div className="mt-24">
          <SiteFooter />
        </div>
      </div>
    </div>
  );
}
