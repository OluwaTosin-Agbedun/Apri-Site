import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';

export default function AdminSubscribers() {
  const { subscribers, setSubscribers } = useAppContext();
  const [isInviting, setIsInviting] = useState(false);
  const [formData, setFormData] = useState({ name: '', organization: '', email: '' });

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.email) return;

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
    
    setIsInviting(false);
    setFormData({ name: '', organization: '', email: '' });
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="font-serif text-2xl text-foreground mb-2">Subscribers</h2>
          <p className="text-sm text-foreground/70">Manage access to the intelligence library.</p>
        </div>
        {!isInviting && (
          <button 
            onClick={() => setIsInviting(true)}
            className="bg-foreground text-background px-4 py-2 text-sm font-medium tracking-wide hover:bg-foreground/90 transition-colors cursor-pointer"
          >
            Invite Subscriber
          </button>
        )}
      </div>

      {isInviting && (
        <div className="mb-12 border border-border bg-card/30 p-8 max-w-md">
          <h3 className="font-serif text-lg text-foreground mb-6">Invite Subscriber</h3>
          <form onSubmit={handleInvite} className="space-y-4">
            <div>
              <input 
                type="text" 
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent"
                placeholder="Full Name (optional)"
              />
            </div>
            <div>
              <input 
                type="text" 
                value={formData.organization}
                onChange={(e) => setFormData({ ...formData, organization: e.target.value })}
                className="w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent"
                placeholder="Organization (optional)"
              />
            </div>
            <div>
              <input 
                type="email" 
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent"
                placeholder="Work Email"
              />
            </div>

            <div className="flex justify-end gap-4 pt-4 border-t border-border mt-2">
              <button 
                type="button" 
                onClick={() => setIsInviting(false)}
                className="px-4 py-2 text-sm font-medium text-foreground/70 hover:text-foreground transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="bg-accent text-white px-6 py-2 text-sm font-medium tracking-wide hover:bg-accent-hover transition-colors cursor-pointer"
              >
                Send Invite
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Subscriber List */}
      <div className="border border-border bg-card/30 overflow-x-auto">
        {subscribers.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No subscribers found. Click "Invite Subscriber" to grant access.
          </div>
        ) : (
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="border-b border-border bg-black/5 text-foreground/70">
              <tr>
                <th className="font-medium p-4">Name</th>
                <th className="font-medium p-4">Organization</th>
                <th className="font-medium p-4">Email</th>
                <th className="font-medium p-4">Status</th>
                <th className="font-medium p-4 text-right">Date Requested</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {subscribers.map((sub) => (
                <tr key={sub.id} className="hover:bg-black/5 transition-colors">
                  <td className="p-4 font-medium text-foreground">{sub.name || '-'}</td>
                  <td className="p-4 text-foreground/70">{sub.organization || '-'}</td>
                  <td className="p-4 text-foreground/70">{sub.email}</td>
                  <td className="p-4">
                    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${sub.status === 'Active' ? 'bg-accent/10 text-accent' : 'bg-muted text-muted-foreground border border-border'}`}>
                      {sub.status}
                    </span>
                  </td>
                  <td className="p-4 text-right text-foreground/70">
                    {new Date(sub.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
