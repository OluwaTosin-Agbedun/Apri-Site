import React, { useState } from 'react';
import { useAppContext, type BriefingRequestItem } from '../context/AppContext';
import { BRIEFING_FORM_URL } from '../config';

const STATUSES: BriefingRequestItem['status'][] = [
  'New',
  'In review',
  'Scheduled',
  'Closed'
];

export default function AdminBriefings() {
  const { briefingRequests, setBriefingRequests } = useAppContext();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const updateStatus = (id: string, status: BriefingRequestItem['status']) =>
    setBriefingRequests((prev) =>
      prev.map((req) => (req.id === id ? { ...req, status } : req))
    );

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h2 className="font-serif text-2xl text-foreground mb-2">Briefing Requests</h2>
        <p className="text-sm text-foreground/70">
          Requests submitted from the Services &amp; Briefings page.
        </p>
      </div>

      {!BRIEFING_FORM_URL && (
        <div className="mb-8 border border-border bg-accent/5 p-6">
          <p className="text-sm text-foreground/80 leading-relaxed">
            <span className="font-medium text-foreground">Note:</span> requests are being
            captured by the built-in form. To route them to Microsoft Forms or Google Forms
            instead, set <code className="text-accent">BRIEFING_FORM_URL</code> in{' '}
            <code className="text-accent">src/config.ts</code>.
          </p>
        </div>
      )}

      <div className="border border-border bg-card/30 overflow-x-auto">
        {briefingRequests.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No briefing requests yet.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-black/5 text-foreground/70">
              <tr>
                <th className="font-medium p-4">Requester</th>
                <th className="font-medium p-4">Briefing</th>
                <th className="font-medium p-4">Format</th>
                <th className="font-medium p-4">Status</th>
                <th className="font-medium p-4 text-right">Received</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {briefingRequests.map((req) => (
                <React.Fragment key={req.id}>
                  <tr
                    onClick={() => setExpandedId(expandedId === req.id ? null : req.id)}
                    className="hover:bg-black/5 transition-colors cursor-pointer"
                  >
                    <td className="p-4">
                      <p className="font-medium text-foreground">{req.name || '-'}</p>
                      <p className="text-xs text-foreground/50 mt-1">
                        {req.organization}
                        {req.role ? ` · ${req.role}` : ''}
                      </p>
                    </td>
                    <td className="p-4 text-foreground/70">{req.briefingType || '-'}</td>
                    <td className="p-4 text-foreground/70">{req.preferredFormat || '-'}</td>
                    <td className="p-4">
                      <select
                        value={req.status}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          updateStatus(req.id, e.target.value as BriefingRequestItem['status'])
                        }
                        className="border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:border-accent cursor-pointer"
                      >
                        {STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-4 text-right text-foreground/70">
                      {new Date(req.createdAt).toLocaleDateString()}
                    </td>
                  </tr>

                  {expandedId === req.id && (
                    <tr className="bg-black/5">
                      <td colSpan={5} className="p-6">
                        <dl className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-x-6 gap-y-3 text-sm">
                          <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                            Email
                          </dt>
                          <dd className="text-foreground/80">{req.email}</dd>

                          <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                            Phone
                          </dt>
                          <dd className="text-foreground/80">{req.phone || '-'}</dd>

                          <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                            Timeline
                          </dt>
                          <dd className="text-foreground/80">{req.timeline || '-'}</dd>

                          <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                            Sector
                          </dt>
                          <dd className="text-foreground/80">{req.sector || '-'}</dd>

                          <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                            Audience size
                          </dt>
                          <dd className="text-foreground/80">{req.audienceSize || '-'}</dd>

                          <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                            Location
                          </dt>
                          <dd className="text-foreground/80">{req.location || '-'}</dd>

                          <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                            Description
                          </dt>
                          <dd className="text-foreground/80 leading-relaxed">
                            {req.issueDescription || '-'}
                          </dd>
                        </dl>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
