'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface Job {
  id: string;
  company_name: string;
  country: string | null;
  official_website_input: string | null;
  status: string;
  progress_step: string | null;
  summary_json: Record<string, string> | null;
  final_comment: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

interface EvidenceItem {
  id: string;
  section_key: string;
  section_title: string;
  source_url: string;
  page_title: string | null;
  screenshot_url: string | null;
  extracted_text: string | null;
  ai_comment: string | null;
  evidence_bullets: string[] | null;
  confidence: string | null;
  flags: string[] | null;
  capture_status: string;
  error_message: string | null;
  captured_at: string | null;
}

const STEPS = ['queued', 'discovering_sources', 'capturing_screenshots', 'analyzing', 'completed'];

function ScreenshotImage({ src, alt, sourceUrl, caption, companyName }: { src: string; alt: string; sourceUrl: string; caption: string; companyName?: string }) {
  const [isBlank, setIsBlank] = useState(false);
  const [isMismatch, setIsMismatch] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const checkIfBlank = () => {
    const img = imgRef.current;
    if (!img || img.naturalWidth === 0) return;
    try {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 100 / img.naturalWidth);
      canvas.width = Math.floor(img.naturalWidth * scale);
      canvas.height = Math.floor(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let whitePixels = 0;
      const total = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) {
          whitePixels++;
        }
      }
      if (whitePixels / total > 0.95) {
        setIsBlank(true);
      }
    } catch {
      // Cross-origin or other canvas error — show the image anyway
    }

    if (companyName && caption) {
      const words = companyName.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const captionLower = caption.toLowerCase();
      const urlLower = sourceUrl.toLowerCase();
      const hasMatch = words.some((w) => captionLower.includes(w) || urlLower.includes(w));
      if (!hasMatch) setIsMismatch(true);
    }
  };

  if (isBlank) return null;

  if (isMismatch) {
    return (
      <div className="rounded-lg border border-card-border/50 p-3">
        <p className="text-xs text-muted mb-1">Source may reference a different company</p>
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted/70 hover:text-accent break-all"
        >
          {caption}
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-lg overflow-hidden border border-card-border">
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className="w-full object-contain"
        crossOrigin="anonymous"
        onLoad={checkIfBlank}
      />
      <div className="p-2 bg-card-border/30">
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted hover:text-accent break-all line-clamp-1"
        >
          {caption}
        </a>
      </div>
    </div>
  );
}

function normalizeSectionTags(rawFlags: string[]): string[] {
  const flags = new Set(rawFlags);

  // Remove manual_review_needed entirely from display
  flags.delete('manual_review_needed');

  // "found" beats "not found" for the same category
  if (flags.has('registry_found')) flags.delete('registry_not_found');
  if (flags.has('operational_address_found')) flags.delete('address_not_found');
  if (flags.has('ownership_found')) flags.delete('ownership_unclear');
  if (flags.has('management_found')) flags.delete('ownership_unclear');

  // Remove "source_blocked" if we have any positive found flag
  const hasPositive = [...flags].some((f) => f.endsWith('_found') || f === 'website_identified');
  if (hasPositive && flags.has('source_blocked')) {
    flags.delete('source_blocked');
  }

  // "no_issue_found" is fine alone, but remove if contradicted
  if (flags.has('no_issue_found') && flags.size > 1) {
    const otherIssues = [...flags].some((f) => f.includes('not_found') || f === 'possible_pobox');
    if (otherIssues) flags.delete('no_issue_found');
  }

  return [...flags];
}

export default function ReportViewerPage() {
  const { jobId } = useParams();
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [showAddSource, setShowAddSource] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [addSection, setAddSection] = useState('company_identity');
  const [addingSource, setAddingSource] = useState(false);
  const [showAttempted, setShowAttempted] = useState(false);

  const loadReport = useCallback(async () => {
    const res = await fetch(`/api/reports/${jobId}`);
    if (res.ok) {
      const data = await res.json();
      setJob(data.job);
      setEvidence(data.evidence);
    }
    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  useEffect(() => {
    if (job && job.status === 'queued' && !running) {
      handleRun();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status]);

  useEffect(() => {
    if (job && ['queued', 'discovering_sources', 'capturing_screenshots', 'analyzing'].includes(job.status)) {
      const interval = setInterval(loadReport, 3000);
      return () => clearInterval(interval);
    }
  }, [job, loadReport]);

  const handleRun = async () => {
    setRunning(true);
    try {
      fetch(`/api/reports/run/${jobId}`, { method: 'POST' }).catch(() => {});
      setTimeout(loadReport, 2000);
    } catch {
      alert('Failed to run report');
    }
    setRunning(false);
  };

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addUrl.trim()) return;
    setAddingSource(true);

    try {
      const res = await fetch(`/api/reports/${jobId}/add-source`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionKey: addSection, url: addUrl.trim() }),
      });
      if (res.ok) {
        setShowAddSource(false);
        setAddUrl('');
        loadReport();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to add source');
      }
    } catch {
      alert('Failed to add source');
    }
    setAddingSource(false);
  };

  const handleExportPdf = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted">Loading report...</div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-error mb-4">Report not found</p>
          <Link href="/" className="text-accent hover:underline">Back to Dashboard</Link>
        </div>
      </div>
    );
  }

  const currentStepIndex = STEPS.indexOf(job.status);

  // Separate evidence by type
  const failedEvidence = evidence.filter((e) => e.capture_status === 'failed');

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/" className="text-sm text-muted hover:text-accent mb-2 inline-block">
              &larr; Dashboard
            </Link>
            <h1 className="text-2xl font-bold text-foreground">{job.company_name}</h1>
            <p className="text-sm text-muted">
              {job.country && `${job.country} • `}
              {new Date(job.created_at).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {job.status === 'queued' && (
              <button
                onClick={handleRun}
                disabled={running}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {running ? 'Running...' : 'Run Web Search'}
              </button>
            )}
            {job.status === 'completed' && (
              <>
                <button
                  onClick={() => setShowAddSource(true)}
                  className="rounded-lg border border-card-border px-4 py-2 text-sm text-foreground hover:border-accent/30"
                >
                  Add Source
                </button>
                <button
                  onClick={handleExportPdf}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
                >
                  Export PDF
                </button>
              </>
            )}
          </div>
        </div>

        {/* Status badge */}
        <div className="mb-6 flex items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${
            job.status === 'completed' ? 'bg-success/20 text-success' :
            job.status === 'failed' ? 'bg-error/20 text-error' :
            'bg-accent/20 text-accent'
          }`}>
            {job.status.replace(/_/g, ' ')}
          </span>
          {job.progress_step && (
            <span className="text-sm text-muted">{job.progress_step}</span>
          )}
          {job.error_message && (
            <p className="mt-2 text-sm text-error">{job.error_message}</p>
          )}
        </div>

        {/* Progress Timeline */}
        <div className="rounded-xl border border-card-border bg-card p-4 mb-6">
          <div className="flex items-center justify-between">
            {STEPS.map((step, i) => (
              <div key={step} className="flex items-center">
                <div className={`w-3 h-3 rounded-full ${
                  i <= currentStepIndex
                    ? i === currentStepIndex && job.status !== 'completed'
                      ? 'bg-accent animate-pulse'
                      : 'bg-success'
                    : 'bg-card-border'
                }`} />
                <span className={`ml-2 text-xs hidden md:inline ${
                  i <= currentStepIndex ? 'text-foreground' : 'text-muted'
                }`}>
                  {step.replace(/_/g, ' ')}
                </span>
                {i < STEPS.length - 1 && (
                  <div className={`w-8 md:w-16 h-0.5 mx-2 ${
                    i < currentStepIndex ? 'bg-success' : 'bg-card-border'
                  }`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Investigation Coverage */}
        {job.status === 'completed' && evidence.length > 0 && (
          <div className="rounded-xl border border-card-border bg-card p-6 mb-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Coverage</h2>
            <div className="flex flex-wrap gap-2">
              {(() => {
                const categories = [
                  { key: 'company_identity', label: 'Identity' },
                  { key: 'public_registry', label: 'Registry' },
                  { key: 'website_activity', label: 'Activity' },
                  { key: 'operational_address', label: 'Address' },
                  { key: 'ownership_management', label: 'Ownership' },
                  { key: 'corporate_group', label: 'Group' },
                  { key: 'government_connections', label: 'Gov' },
                ];

                return categories.map(({ key, label }) => {
                  const items = evidence.filter((e) => e.section_key === key);
                  const hasCaptured = items.some((e) => e.capture_status === 'captured');
                  const hasSearch = items.some((e) => e.capture_status === 'search_only');
                  const hasFailed = items.some((e) => e.capture_status === 'failed');

                  let status: 'found' | 'partial' | 'not_found' | 'blocked' = 'not_found';
                  if (hasCaptured) status = 'found';
                  else if (hasSearch) status = 'partial';
                  else if (hasFailed) status = 'blocked';

                  const colors = {
                    found: 'bg-success/20 text-success border-success/30',
                    partial: 'bg-accent/20 text-accent border-accent/30',
                    blocked: 'bg-error/10 text-error border-error/20',
                    not_found: 'bg-card-border/50 text-muted border-card-border',
                  };

                  const icons = { found: '●', partial: '◐', blocked: '○', not_found: '○' };

                  return (
                    <span key={key} className={`rounded-full border px-3 py-1 text-xs font-medium ${colors[status]}`}>
                      {icons[status]} {label}
                    </span>
                  );
                });
              })()}
            </div>
            <div className="mt-3 flex items-center gap-4 text-xs text-muted">
              <span>● Found</span>
              <span>◐ Partial (SERP only)</span>
              <span>○ Not found</span>
            </div>
          </div>
        )}

        {/* Summary */}
        {job.summary_json && (
          <div className="rounded-xl border border-card-border bg-card p-6 mb-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Summary</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(job.summary_json)
                .filter(([key]) => !['coverageScore', 'coverageStrength', 'evidenceScore', 'evidenceStrength', 'manualReviewNeeded'].includes(key))
                .map(([key, value]) => (
                <div key={key} className="flex items-center justify-between rounded-lg border border-card-border p-3">
                  <span className="text-sm text-muted">
                    {key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())}
                  </span>
                  <span className={`text-sm font-medium ${
                    value === 'Found' ? 'text-success' :
                    value === 'Captured' ? 'text-success' :
                    value === 'Partial' ? 'text-accent' :
                    value === 'Search evidence only' ? 'text-accent' :
                    value === 'Not found' ? 'text-error' :
                    value === 'Not publicly available' ? 'text-muted' :
                    value === 'No evidence found' ? 'text-muted' :
                    value === 'Not identified in captured public sources' ? 'text-muted' :
                    value === 'Not checked' ? 'text-muted' :
                    value === 'Yes' ? 'text-error' :
                    value === 'No' ? 'text-success' :
                    'text-muted'
                  }`}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
            {job.final_comment && (
              <p className="mt-4 text-sm text-muted">{job.final_comment}</p>
            )}
          </div>
        )}

        {/* Evidence grouped by section */}
        {job.status === 'completed' && evidence.length > 0 && (
          <div className="space-y-6 mb-6">
            {(() => {
              const sectionOrder = [
                'company_identity',
                'public_registry',
                'website_activity',
                'operational_address',
                'ownership_management',
                'corporate_group',
                'government_connections',
              ];
              const sectionLabels: Record<string, string> = {
                company_identity: 'Company Identity',
                public_registry: 'Public Registry Evidence',
                website_activity: 'Website and Business Activity',
                operational_address: 'Operational Address',
                ownership_management: 'Ownership / Management',
                corporate_group: 'Corporate Group Information',
                government_connections: 'Government Connections',
              };

              const grouped: Record<string, EvidenceItem[]> = {};
              for (const item of evidence) {
                if (item.capture_status === 'failed') continue;
                const key = item.section_key;
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(item);
              }

              const getCaption = (item: EvidenceItem): string => {
                if (item.page_title && item.page_title.length > 3) return item.page_title;
                try {
                  const u = new URL(item.source_url);
                  return u.hostname + (u.pathname !== '/' ? u.pathname : '');
                } catch { return item.source_url; }
              };

              return sectionOrder
                .filter((key) => {
                  if (grouped[key] && grouped[key].length > 0) return true;
                  if (['public_registry', 'corporate_group', 'government_connections'].includes(key)) return true;
                  return false;
                })
                .map((sectionKey) => {
                  const items = grouped[sectionKey] || [];
                  const captured = items.filter((e) => e.capture_status === 'captured');
                  const serpOnly = items.filter((e) => e.capture_status === 'search_only');
                  const blockedItems = items.filter((e) => e.capture_status === 'blocked_source');
                  const activeItems = items.filter((e) => e.capture_status !== 'blocked_source');

                  const allBullets: string[] = [];
                  const rawFlags: string[] = [];
                  const seenBullets = new Set<string>();

                  for (const item of activeItems) {
                    if (item.evidence_bullets) {
                      for (const b of item.evidence_bullets) {
                        if (!seenBullets.has(b.toLowerCase())) {
                          seenBullets.add(b.toLowerCase());
                          allBullets.push(b);
                        }
                      }
                    }
                    if (item.flags) {
                      for (const f of item.flags) {
                        if (!rawFlags.includes(f)) rawFlags.push(f);
                      }
                    }
                  }

                  // Normalize flags: remove contradictions
                  const allFlags = normalizeSectionTags(rawFlags);

                  const bestConfidence = activeItems.length > 0
                    ? (activeItems.some((i) => i.confidence === 'High') ? 'High' :
                       activeItems.some((i) => i.confidence === 'Medium') ? 'Medium' : 'Low')
                    : null;

                  if (items.length === 0) {
                    const isSearchedSection = ['corporate_group', 'government_connections'].includes(sectionKey);
                    return (
                      <div key={sectionKey} className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
                        <div className="flex items-start justify-between mb-2">
                          <h3 className="text-base font-semibold text-accent">
                            {sectionLabels[sectionKey] || sectionKey}
                          </h3>
                          <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-muted/20 text-muted">
                            Not found
                          </span>
                        </div>
                        <p className="text-sm text-muted">
                          {isSearchedSection
                            ? `Searches were performed across Brave and public sources. No company-specific ${sectionKey === 'corporate_group' ? 'corporate group' : 'government connection'} evidence was found.`
                            : 'Targeted searches performed. No relevant evidence found in public sources.'}
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div key={sectionKey} className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
                      <div className="flex items-start justify-between mb-4">
                        <h3 className="text-base font-semibold text-accent">
                          {sectionLabels[sectionKey] || sectionKey}
                        </h3>
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            bestConfidence === 'High' ? 'bg-success/20 text-success' :
                            bestConfidence === 'Medium' ? 'bg-accent/20 text-accent' :
                            'bg-muted/20 text-muted'
                          }`}>
                            {bestConfidence}
                          </span>
                          <span className="text-xs text-muted">
                            {captured.length} captured{serpOnly.length > 0 ? `, ${serpOnly.length} SERP` : ''}
                          </span>
                        </div>
                      </div>

                      {/* Screenshots stacked */}
                      {(() => {
                        const seenInSection = new Set<string>();
                        const screenshotItems = captured.filter((i) => {
                          if (!i.screenshot_url) return false;
                          if (seenInSection.has(i.screenshot_url)) return false;
                          seenInSection.add(i.screenshot_url);
                          return true;
                        });
                        if (screenshotItems.length === 0) return null;
                        return (
                          <div className="space-y-3 mb-4">
                            {screenshotItems.map((item) => (
                              <ScreenshotImage
                                key={item.id}
                                src={item.screenshot_url!}
                                alt={getCaption(item)}
                                sourceUrl={item.source_url}
                                caption={getCaption(item)}
                                companyName={job.company_name}
                              />
                            ))}
                          </div>
                        );
                      })()}

                      {/* Combined findings */}
                      {allBullets.length > 0 && (
                        <ul className="list-disc list-inside text-sm text-muted space-y-1 mb-3">
                          {allBullets.slice(0, 8).map((bullet, i) => (
                            <li key={i}>{bullet}</li>
                          ))}
                        </ul>
                      )}

                      {/* SERP snippets */}
                      {serpOnly.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-card-border/50">
                          <p className="text-xs text-muted mb-2 font-medium">Search snippets:</p>
                          {serpOnly.map((item) => (
                            <div key={item.id} className="mb-2">
                              <a
                                href={item.source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-accent hover:underline break-all"
                              >
                                {item.page_title || item.source_url}
                              </a>
                              {item.ai_comment && (
                                <p className="text-xs text-muted mt-0.5">{item.ai_comment}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Flags */}
                      {allFlags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-3">
                          {allFlags.map((flag) => (
                            <span key={flag} className="rounded bg-card-border px-2 py-0.5 text-xs text-muted">
                              {flag.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Blocked sources subsection */}
                      {blockedItems.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-card-border/50">
                          <p className="text-xs text-muted mb-2 font-medium">Blocked sources reviewed ({blockedItems.length}):</p>
                          {blockedItems.map((item) => (
                            <div key={item.id} className="mb-1">
                              <a
                                href={item.source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-muted/60 hover:text-accent break-all"
                              >
                                {item.page_title || item.source_url}
                              </a>
                              {item.error_message && (
                                <span className="ml-2 text-xs text-muted/40">({item.error_message.replace(/_/g, ' ')})</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Sources list */}
                      <div className="mt-3 pt-3 border-t border-card-border/50">
                        <p className="text-xs text-muted mb-1 font-medium">Sources ({activeItems.length}):</p>
                        <div className="space-y-0.5">
                          {activeItems.map((item) => (
                            <a
                              key={item.id}
                              href={item.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block text-xs text-muted/70 hover:text-accent break-all"
                            >
                              {item.source_url}
                            </a>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                });
            })()}
          </div>
        )}

        {/* Attempted Sources (collapsed, max 8) */}
        {failedEvidence.length > 0 && (
          <div className="mb-6">
            <button
              onClick={() => setShowAttempted(!showAttempted)}
              className="flex items-center gap-2 text-sm text-muted hover:text-foreground"
            >
              <span className={`transition-transform ${showAttempted ? 'rotate-90' : ''}`}>&#9656;</span>
              Attempted Sources ({Math.min(failedEvidence.length, 8)})
            </button>
            {showAttempted && (
              <div className="mt-3 space-y-2">
                {failedEvidence.slice(0, 8).map((item) => (
                  <div key={item.id} className="rounded-lg border border-card-border/50 bg-card/50 p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs text-muted">{item.section_title}</span>
                        <a
                          href={item.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-xs text-muted/70 hover:text-accent break-all"
                        >
                          {item.source_url}
                        </a>
                      </div>
                      <span className="rounded-full bg-error/10 px-2 py-0.5 text-xs text-error">
                        failed
                      </span>
                    </div>
                    {item.error_message && (
                      <p className="text-xs text-error/70 mt-1">{item.error_message}</p>
                    )}
                  </div>
                ))}
                {failedEvidence.length > 8 && (
                  <p className="text-xs text-muted mt-2">
                    and {failedEvidence.length - 8} more low-value failed sources hidden
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Add Source Modal */}
        {showAddSource && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
            <div className="w-full max-w-md rounded-xl border border-card-border bg-card p-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">Add Manual Source</h3>
              <form onSubmit={handleAddSource} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-muted mb-1">URL</label>
                  <input
                    type="url"
                    value={addUrl}
                    onChange={(e) => setAddUrl(e.target.value)}
                    required
                    placeholder="https://example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1">Section</label>
                  <select value={addSection} onChange={(e) => setAddSection(e.target.value)}>
                    <option value="company_identity">Company Identity</option>
                    <option value="public_registry">Public Registry</option>
                    <option value="website_activity">Website / Activity</option>
                    <option value="operational_address">Operational Address</option>
                    <option value="ownership_management">Ownership / Management</option>
                    <option value="corporate_group">Corporate Group</option>
                    <option value="government_connections">Government Connections</option>
                  </select>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowAddSource(false)}
                    className="flex-1 rounded-lg border border-card-border py-2.5 text-sm text-foreground hover:bg-card-border/50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={addingSource}
                    className="flex-1 rounded-lg bg-accent py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                  >
                    {addingSource ? 'Capturing...' : 'Capture Source'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

