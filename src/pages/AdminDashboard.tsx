import React from 'react';
import { Link } from 'react-router';
import { useAppContext, PUBLICATION_SECTIONS } from '../context/AppContext';
import { SERVICES } from '../data/services';

export default function AdminDashboard() {
  const { documents, subscribers, briefingRequests } = useAppContext();

  const openRequests = briefingRequests.filter(
    (req) => req.status === 'New' || req.status === 'In review'
  ).length;

  const pendingLinks = documents.filter(
    (doc) => doc.accessMode === 'secure-document' && !doc.papermarkLink
  );

  const metrics = [
    { label: 'Publications', value: documents.length, to: '/admin/documents' },
    { label: 'Subscribers', value: subscribers.length, to: '/admin/subscribers' },
    { label: 'Open Briefing Requests', value: openRequests, to: '/admin/briefings' },
    { label: 'Services Offered', value: SERVICES.length, to: null }
  ];

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h2 className="font-serif text-2xl text-foreground mb-2">Overview</h2>
        <p className="text-sm text-foreground/70">
          Publications, subscriber access and briefing requests across the platform.
        </p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        {metrics.map((metric) => {
          const card = (
            <div className="border border-border p-6 bg-card/30 h-full hover:border-accent transition-colors">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
                {metric.label}
              </p>
              <p className="text-3xl font-serif text-foreground">{metric.value}</p>
            </div>
          );

          return metric.to ? (
            <Link key={metric.label} to={metric.to}>
              {card}
            </Link>
          ) : (
            <div key={metric.label}>{card}</div>
          );
        })}
      </div>

      {/* Anything needing attention */}
      {pendingLinks.length > 0 && (
        <div className="mb-12 border border-border bg-accent/5 p-6">
          <h3 className="font-serif text-lg text-foreground mb-3">Needs attention</h3>
          <p className="text-sm text-foreground/80 leading-relaxed mb-4">
            {pendingLinks.length === 1
              ? 'One publication is live on the website without a secure link. Readers clicking its button will see a "pending" notice.'
              : `${pendingLinks.length} publications are live on the website without a secure link. Readers clicking their buttons will see a "pending" notice.`}
          </p>
          <ul className="space-y-2 mb-5 text-sm text-foreground/80">
            {pendingLinks.map((doc) => (
              <li key={doc.id} className="flex gap-3">
                <span className="text-accent">&mdash;</span>
                {doc.title}
                <span className="text-muted-foreground text-xs self-center">
                  {doc.edition}
                </span>
              </li>
            ))}
          </ul>
          <Link
            to="/admin/documents"
            className="inline-flex items-center text-sm font-medium text-accent hover:text-accent-hover transition-colors"
          >
            Assign secure links <span className="ml-2 opacity-70">&rarr;</span>
          </Link>
        </div>
      )}

      {/* Publications by website section */}
      <div className="mb-12">
        <h3 className="font-serif text-lg text-foreground mb-4">Website Sections</h3>
        <div className="border border-border bg-card/30">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-black/5 text-foreground/70">
              <tr>
                <th className="font-medium p-4 w-1/3">Section</th>
                <th className="font-medium p-4">Publications</th>
                <th className="font-medium p-4 text-right">Count</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {PUBLICATION_SECTIONS.map((section) => {
                const items = documents
                  .filter((doc) => doc.section === section)
                  .sort((a, b) => a.order - b.order);

                return (
                  <tr key={section} className="hover:bg-black/5 transition-colors">
                    <td className="p-4 font-medium text-foreground">{section}</td>
                    <td className="p-4 text-foreground/70">
                      {items.length === 0 ? (
                        <span className="text-muted-foreground italic">Empty</span>
                      ) : (
                        items.map((doc) => doc.title).join(', ')
                      )}
                    </td>
                    <td className="p-4 text-right text-foreground/70">{items.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent briefing requests */}
      <div>
        <h3 className="font-serif text-lg text-foreground mb-4">Recent Briefing Requests</h3>
        <div className="border border-border bg-card/30">
          {briefingRequests.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No briefing requests yet.
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-black/5 text-foreground/70">
                <tr>
                  <th className="font-medium p-4">Requester</th>
                  <th className="font-medium p-4">Briefing</th>
                  <th className="font-medium p-4">Status</th>
                  <th className="font-medium p-4 text-right">Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {briefingRequests.slice(0, 5).map((req) => (
                  <tr key={req.id} className="hover:bg-black/5 transition-colors">
                    <td className="p-4">
                      <p className="font-medium text-foreground">{req.name || '-'}</p>
                      <p className="text-xs text-foreground/50 mt-1">{req.organization}</p>
                    </td>
                    <td className="p-4 text-foreground/70">{req.briefingType || '-'}</td>
                    <td className="p-4">
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-accent/10 text-accent">
                        {req.status}
                      </span>
                    </td>
                    <td className="p-4 text-right text-foreground/70">
                      {new Date(req.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
