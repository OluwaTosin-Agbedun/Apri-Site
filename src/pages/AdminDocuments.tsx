import React, { useState } from 'react';
import {
  useAppContext,
  PUBLICATION_SECTIONS,
  type AccessMode,
  type DocumentItem,
  type PublicationSection
} from '../context/AppContext';

const fieldClass =
  'w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent';

const labelClass =
  'block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2';

type DraftDocument = Omit<DocumentItem, 'id' | 'createdAt'>;

const emptyDraft: DraftDocument = {
  section: PUBLICATION_SECTIONS[0],
  order: 1,
  title: '',
  productLine: '',
  edition: '',
  editionTitle: '',
  description: '',
  frequency: '',
  audience: '',
  ctaLabel: 'Access Secure Note',
  attribution: '',
  accessMode: 'secure-document',
  papermarkLink: ''
};

export default function AdminDocuments() {
  const { documents, setDocuments } = useAppContext();

  /** null = closed, 'new' = adding, otherwise the id being edited. */
  const [editorFor, setEditorFor] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftDocument>(emptyDraft);

  const openNew = () => {
    setDraft(emptyDraft);
    setEditorFor('new');
  };

  const openEdit = (doc: DocumentItem) => {
    const { id, createdAt, ...rest } = doc;
    setDraft({ ...emptyDraft, ...rest });
    setEditorFor(id);
  };

  const update = <K extends keyof DraftDocument>(field: K, value: DraftDocument[K]) =>
    setDraft((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.title || !draft.productLine) return;

    if (editorFor === 'new') {
      setDocuments((prev) => [
        ...prev,
        { ...draft, id: Date.now().toString(), createdAt: new Date().toISOString() }
      ]);
    } else {
      setDocuments((prev) =>
        prev.map((doc) => (doc.id === editorFor ? { ...doc, ...draft } : doc))
      );
    }

    setEditorFor(null);
    setDraft(emptyDraft);
  };

  const handleDelete = (id: string) => {
    if (!confirm('Remove this publication from the website?')) return;
    setDocuments((prev) => prev.filter((doc) => doc.id !== id));
  };

  const sorted = [...documents].sort((a, b) => {
    const sectionDiff =
      PUBLICATION_SECTIONS.indexOf(a.section) - PUBLICATION_SECTIONS.indexOf(b.section);
    return sectionDiff !== 0 ? sectionDiff : a.order - b.order;
  });

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="font-serif text-2xl text-foreground mb-2">Publications</h2>
          <p className="text-sm text-foreground/70">
            Manage intelligence notes, briefs and monitors. Sections appear on the website
            in the order shown below.
          </p>
        </div>
        {!editorFor && (
          <button
            onClick={openNew}
            className="bg-foreground text-background px-4 py-2 text-sm font-medium tracking-wide hover:bg-foreground/90 transition-colors cursor-pointer shrink-0"
          >
            New Publication
          </button>
        )}
      </div>

      {editorFor && (
        <div className="mb-12 border border-border bg-card/30 p-8">
          <h3 className="font-serif text-lg text-foreground mb-6">
            {editorFor === 'new' ? 'Add Publication' : 'Edit Publication'}
          </h3>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_6rem] gap-6">
              <div>
                <label className={labelClass}>Website section</label>
                <select
                  value={draft.section}
                  onChange={(e) => update('section', e.target.value as PublicationSection)}
                  className={fieldClass}
                >
                  {PUBLICATION_SECTIONS.map((section) => (
                    <option key={section} value={section}>
                      {section}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Order</label>
                <input
                  type="number"
                  min={1}
                  value={draft.order}
                  onChange={(e) => update('order', Number(e.target.value) || 1)}
                  className={fieldClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className={labelClass}>Publication name</label>
                <input
                  type="text"
                  required
                  value={draft.title}
                  onChange={(e) => update('title', e.target.value)}
                  className={fieldClass}
                  placeholder="e.g. Nigeria Political & Regulatory Environment"
                />
              </div>
              <div>
                <label className={labelClass}>Product line</label>
                <input
                  type="text"
                  required
                  value={draft.productLine}
                  onChange={(e) => update('productLine', e.target.value)}
                  className={fieldClass}
                  placeholder="e.g. Monthly Intelligence Note"
                />
              </div>
              <div>
                <label className={labelClass}>Current edition</label>
                <input
                  type="text"
                  value={draft.edition}
                  onChange={(e) => update('edition', e.target.value)}
                  className={fieldClass}
                  placeholder="e.g. August 2026"
                />
              </div>
              <div>
                <label className={labelClass}>Edition subject (optional)</label>
                <input
                  type="text"
                  value={draft.editionTitle ?? ''}
                  onChange={(e) => update('editionTitle', e.target.value)}
                  className={fieldClass}
                  placeholder="e.g. Osun 2026: What the Result Tells Us About 2027"
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>Website descriptor</label>
              <textarea
                required
                rows={4}
                value={draft.description}
                onChange={(e) => update('description', e.target.value)}
                className={fieldClass}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className={labelClass}>Frequency</label>
                <input
                  type="text"
                  value={draft.frequency}
                  onChange={(e) => update('frequency', e.target.value)}
                  className={fieldClass}
                  placeholder="e.g. Monthly"
                />
              </div>
              <div>
                <label className={labelClass}>Audience</label>
                <input
                  type="text"
                  value={draft.audience}
                  onChange={(e) => update('audience', e.target.value)}
                  className={fieldClass}
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>Attribution note (optional)</label>
              <input
                type="text"
                value={draft.attribution ?? ''}
                onChange={(e) => update('attribution', e.target.value)}
                className={fieldClass}
                placeholder="e.g. An Athena Election Observatory publication included in APRI subscriber access."
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-6 border-t border-border">
              <div>
                <label className={labelClass}>Access mode</label>
                <select
                  value={draft.accessMode}
                  onChange={(e) => update('accessMode', e.target.value as AccessMode)}
                  className={fieldClass}
                >
                  <option value="secure-document">Secure document link</option>
                  <option value="request">Released on request</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Button label</label>
                <input
                  type="text"
                  required
                  value={draft.ctaLabel}
                  onChange={(e) => update('ctaLabel', e.target.value)}
                  className={fieldClass}
                  placeholder="e.g. Access Secure Note"
                />
              </div>
            </div>

            {draft.accessMode === 'secure-document' && (
              <div>
                <label className={labelClass}>Papermark link</label>
                <p className="text-xs text-foreground/70 mb-2">
                  The secure Papermark URL where readers verify their email. Leave blank
                  until the edition is published.
                </p>
                <input
                  type="url"
                  value={draft.papermarkLink}
                  onChange={(e) => update('papermarkLink', e.target.value)}
                  className={fieldClass}
                  placeholder="https://www.papermark.com/view/..."
                />
              </div>
            )}

            <div className="flex justify-end gap-4 pt-4 border-t border-border">
              <button
                type="button"
                onClick={() => setEditorFor(null)}
                className="px-4 py-2 text-sm font-medium text-foreground/70 hover:text-foreground transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="bg-accent text-white px-6 py-2 text-sm font-medium tracking-wide hover:bg-accent-hover transition-colors cursor-pointer"
              >
                Save Publication
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Publication list */}
      <div className="border border-border bg-card/30">
        {sorted.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No publications found. Click &ldquo;New Publication&rdquo; to add one.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-black/5 text-foreground/70">
              <tr>
                <th className="font-medium p-4">Publication</th>
                <th className="font-medium p-4">Section</th>
                <th className="font-medium p-4">Access</th>
                <th className="font-medium p-4 text-right">Manage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((doc) => (
                <tr key={doc.id} className="hover:bg-black/5 transition-colors">
                  <td className="p-4">
                    <p className="font-medium text-foreground">{doc.title}</p>
                    <p className="text-xs text-foreground/50 mt-1">
                      {doc.productLine}
                      {doc.edition ? ` · ${doc.edition}` : ''}
                    </p>
                  </td>
                  <td className="p-4 text-foreground/70 text-xs">{doc.section}</td>
                  <td className="p-4">
                    {doc.accessMode === 'request' ? (
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-muted text-muted-foreground border border-border">
                        On request
                      </span>
                    ) : doc.papermarkLink ? (
                      <a
                        href={doc.papermarkLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center text-xs font-medium text-accent hover:text-accent-hover transition-colors"
                      >
                        Link assigned &rarr;
                      </a>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-muted text-muted-foreground border border-border">
                        Link pending
                      </span>
                    )}
                  </td>
                  <td className="p-4 text-right whitespace-nowrap">
                    <button
                      onClick={() => openEdit(doc)}
                      className="text-xs font-medium text-accent hover:text-accent-hover cursor-pointer"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(doc.id)}
                      className="text-xs font-medium text-foreground/50 hover:text-foreground ml-4 cursor-pointer"
                    >
                      Remove
                    </button>
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
