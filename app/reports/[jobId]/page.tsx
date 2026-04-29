'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface Job {
  id: string;
  company_name: string;
  country: string | null;
  official_website_input: string | null;
  report_type: string;
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

export default function ReportViewerPage() {
  const { jobId } = useParams();
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [showAddSource, setShowAddSource] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [addSection, setAddSection] = useState('official_website');
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
    window.open(`/api/reports/pdf/${jobId}`, '_blank');
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
  const capturedEvidence = evidence.filter((e) => e.capture_status === 'captured');
  const searchEvidence = evidence.filter((e) => e.capture_status === 'search_only');
  const failedEvidence = evidence.filter((e) => e.capture_status === 'failed');

  // Coverage data from summary_json
  const coverageScore = job.summary_json?.coverageScore ? parseInt(job.summary_json.coverageScore) : null;
  const coverageStrength = job.summary_json?.coverageStrength || null;

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/" className="text-sm text-muted hover:text-accent mb-2 inline-block">
              &larr; Dashboard
            </Link>
            <h1 className="text-xl font-bold text-foreground">{job.company_name}</h1>
            <p className="text-sm text-muted">
              {job.country && `${job.country} • `}
              {job.report_type.toUpperCase()} Report • {new Date(job.created_at).toLocaleDateString()}
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

        {/* Status badge + Evidence Score */}
        <div className="mb-6 flex items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${
            job.status === 'completed' ? 'bg-success/20 text-success' :
            job.status === 'failed' ? 'bg-error/20 text-error' :
            'bg-accent/20 text-accent'
          }`}>
            {job.status.replace(/_/g, ' ')}
          </span>
          {coverageScore !== null && (
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${
              coverageStrength === 'Strong' ? 'bg-success/20 text-success' :
              coverageStrength === 'Moderate' ? 'bg-accent/20 text-accent' :
              'bg-error/20 text-error'
            }`}>
              Score: {coverageScore}/100 ({coverageStrength})
            </span>
          )}
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
            <h2 className="text-lg font-semibold text-foreground mb-4">Investigation Coverage</h2>
            <div className="flex flex-wrap gap-2">
              {(() => {
                const categories = [
                  { key: 'official_website', label: 'Website' },
                  { key: 'about_company', label: 'Activity' },
                  { key: 'contact_location', label: 'Address' },
                  { key: 'public_registry', label: 'Registry' },
                  { key: 'management_history', label: 'Management' },
                  { key: 'group_shareholding', label: 'Ownership' },
                  { key: 'adverse_media', label: 'Adverse Media' },
                  { key: 'sanctions_watchlist', label: 'Sanctions' },
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
                .filter(([key]) => !['coverageScore', 'coverageStrength', 'evidenceScore', 'evidenceStrength'].includes(key))
                .map(([key, value]) => (
                <div key={key} className="flex items-center justify-between rounded-lg border border-card-border p-3">
                  <span className="text-sm text-muted">
                    {key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())}
                  </span>
                  <span className={`text-sm font-medium ${
                    value === 'Captured' ? 'text-success' :
                    value === 'Search evidence only' ? 'text-accent' :
                    value === 'Not found' ? 'text-error' :
                    value === 'Yes' ? 'text-success' :
                    value === 'No' ? 'text-error' :
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

        {/* Captured Evidence */}
        {capturedEvidence.length > 0 && (
          <div className="space-y-4 mb-6">
            <h2 className="text-lg font-semibold text-foreground">
              Captured Evidence
              <span className="ml-2 text-sm font-normal text-muted">({capturedEvidence.length})</span>
            </h2>
            {capturedEvidence.map((item) => (
              <EvidenceCard key={item.id} item={item} />
            ))}
          </div>
        )}

        {/* Search Evidence (SERP-only) */}
        {searchEvidence.length > 0 && (
          <div className="space-y-4 mb-6">
            <h2 className="text-lg font-semibold text-foreground">
              Search Evidence
              <span className="ml-2 text-sm font-normal text-muted">({searchEvidence.length})</span>
            </h2>
            <p className="text-xs text-muted -mt-2">Search snippet evidence only. Direct pages were not captured.</p>
            {searchEvidence.map((item) => (
              <div key={item.id} className="rounded-xl border border-card-border bg-card p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-medium text-accent text-sm">{item.section_title}</h3>
                    <a
                      href={item.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted hover:text-accent break-all"
                    >
                      {item.source_url}
                    </a>
                  </div>
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">
                    SERP
                  </span>
                </div>
                {item.ai_comment && (
                  <p className="text-sm text-foreground mb-2">{item.ai_comment}</p>
                )}
                {item.evidence_bullets && item.evidence_bullets.length > 0 && (
                  <ul className="list-disc list-inside text-sm text-muted space-y-1">
                    {item.evidence_bullets.map((bullet, i) => (
                      <li key={i}>{bullet}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
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
                    <option value="official_website">Official Website</option>
                    <option value="about_company">About / Services</option>
                    <option value="contact_location">Contact / Location</option>
                    <option value="public_registry">Public Registry</option>
                    <option value="management_history">Management / History</option>
                    <option value="group_shareholding">Group / Shareholding</option>
                    <option value="other">Other</option>
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

function EvidenceCard({ item }: { item: EvidenceItem }) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-medium text-accent">{item.section_title}</h3>
          <a
            href={item.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted hover:text-accent break-all"
          >
            {item.source_url}
          </a>
        </div>
        <div className="flex items-center gap-2">
          {item.confidence && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              item.confidence === 'High' ? 'bg-success/20 text-success' :
              item.confidence === 'Medium' ? 'bg-accent/20 text-accent' :
              'bg-muted/20 text-muted'
            }`}>
              {item.confidence}
            </span>
          )}
          <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">
            captured
          </span>
        </div>
      </div>

      {item.screenshot_url && (
        <div className="mb-3 rounded-lg overflow-hidden border border-card-border">
          <img
            src={item.screenshot_url}
            alt={`Screenshot of ${item.page_title || item.source_url}`}
            className="w-full max-h-80 object-cover object-top"
          />
        </div>
      )}

      {item.ai_comment && (
        <p className="text-sm text-foreground mb-2">{item.ai_comment}</p>
      )}

      {item.evidence_bullets && item.evidence_bullets.length > 0 && (
        <ul className="list-disc list-inside text-sm text-muted space-y-1 mb-2">
          {item.evidence_bullets.map((bullet, i) => (
            <li key={i}>{bullet}</li>
          ))}
        </ul>
      )}

      {item.flags && item.flags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {item.flags.map((flag) => (
            <span key={flag} className="rounded bg-card-border px-2 py-0.5 text-xs text-muted">
              {flag.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}

      {item.captured_at && (
        <p className="text-xs text-muted mt-2">
          Captured: {new Date(item.captured_at).toLocaleString()}
        </p>
      )}
    </div>
  );
}
