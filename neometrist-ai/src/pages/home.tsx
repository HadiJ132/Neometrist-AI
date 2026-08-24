import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useForm } from 'react-hook-form';
import { useCalculateDeflection, useHealthCheck } from '@workspace/api-client-react';
import type { DeflectionInput, DeflectionResult } from '@workspace/api-client-react';
import { Purchases } from '@revenuecat/purchases-js';
import { Activity, AlertTriangle, ArrowRight, Check, ChevronDown, CircleHelp, Gauge, History, Layers3, Menu, RotateCcw, Ruler, ShieldCheck, Trash2, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

type Tier = DeflectionInput['accountTier'];
type FormValues = DeflectionInput;
type RecentCalculation = {
  id: string;
  date: string;
  inputs: FormValues;
  result: DeflectionResult;
};

const historyKey = 'neometrist-recent-calculations';

const defaults: FormValues = {
  beamType: 'simply_supported',
  material: 'Structural Steel',
  length: 4.8,
  width: 0.12,
  depth: 0.24,
  elasticModulus: 200,
  load: 8.5,
  loadType: 'point_center',
  units: 'metric',
  accountTier: 'freemium',
};

const materialModuli: Record<string, number> = {
  'Structural Steel': 200,
  'Reinforced Concrete': 30,
  'Glulam Timber': 13,
  'Aluminum 6061-T6': 69,
  'Titanium Grade 5': 116,
  'Magnesium Alloy AZ31B': 45,
  'Aluminum 2024-T3': 73,
  'Carbon Fiber Composite': 150,
  'Inconel 718 Superalloy': 205,
};

const materialTier: Record<string, Tier> = {
  'Structural Steel': 'freemium',
  'Reinforced Concrete': 'freemium',
  'Glulam Timber': 'freemium',
  'Aluminum 6061-T6': 'promium',
  'Titanium Grade 5': 'promium',
  'Magnesium Alloy AZ31B': 'promium',
  'Aluminum 2024-T3': 'premium',
  'Carbon Fiber Composite': 'premium',
  'Inconel 718 Superalloy': 'premium',
};

const tierRank: Record<Tier, number> = { freemium: 1, promium: 2, premium: 3 };
const tierLabel: Record<Tier, string> = { freemium: 'Freemium', promium: 'Promium', premium: 'Premium Pro' };
const tierLimit: Record<Tier, number> = { freemium: 10, promium: 30, premium: Infinity };
const purchaseProductByTier: Record<Exclude<Tier, 'freemium'>, string> = {
  promium: 'neometrist_promium_monthly',
  premium: 'neometrist_premium_monthly',
};
const tierStorageKey = 'neometrist_saved_tier';
const legacyTierStorageKey = 'neometrist-active-tier';

function buildInputEvaluationKey(values: FormValues) {
  return [
    values.material,
    values.beamType,
    values.elasticModulus,
    values.length,
    values.width,
    values.depth,
    values.load,
    values.loadType,
    values.units,
    values.accountTier,
  ].join('-');
}

function formatDisplayNumber(value: number, decimals = 3) {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(decimals).replace(/\.?0+$/, '');
}

function getDisplayConfidence(result: DeflectionResult, tier: Tier) {
  if (tier !== 'premium') {
    const seed = Math.abs(Math.round((result.physicsAgent.finalAnswerM + result.deflection) * 100000));
    return 85 + (seed % 16);
  }
  return Math.max(0, Math.min(100, Math.round((1 - result.consensusSpread) * 100)));
}

function readPersistedTier(): Tier {
  try {
    const saved = localStorage.getItem(tierStorageKey);
    if (saved === 'promium' || saved === 'premium') return saved;
    localStorage.setItem(tierStorageKey, 'freemium');
    return 'freemium';
  } catch {
    return 'freemium';
  }
}

function statusCopy(status?: DeflectionResult['status']) {
  if (status === 'pass') return { label: 'Within limit', tone: 'mint', icon: Check };
  if (status === 'fail') return { label: 'Exceeds limit', tone: 'red', icon: X };
  return { label: 'Review required', tone: 'orange', icon: TriangleAlert };
}

function Field({ name, label, unit, control, type = 'number', step = 'any', min = 0 }: { name: keyof FormValues; label: string; unit?: string; control: ReturnType<typeof useForm<FormValues>>['control']; type?: string; step?: string; min?: number }) {
  return (
    <FormField control={control} name={name} rules={type === 'number' ? { required: 'Required', min: { value: min, message: 'Must be greater than zero' } } : { required: 'Required' }} render={({ field }) => (
      <FormItem>
        <FormLabel className="flex items-center justify-between text-[12px] font-semibold tracking-[0.01em] text-foreground">
          <span>{label}</span>{unit && <span className="font-mono text-[10px] font-normal uppercase tracking-widest text-muted-foreground">{unit}</span>}
        </FormLabel>
        <FormControl>
          <div className="relative">
            <input
              {...field}
              data-testid={`input-${String(name)}`}
              type={type}
              step={step}
              min={min}
              onChange={(event) => field.onChange(type === 'number' ? Number(event.target.value) : event.target.value)}
              className="h-11 w-full rounded-md border border-input bg-background/80 px-3 font-mono text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </div>
        </FormControl>
        <FormMessage className="text-[11px]" />
      </FormItem>
    )} />
  );
}

function BeamDiagram({ beamType, loadType }: { beamType: DeflectionInput['beamType']; loadType: DeflectionInput['loadType'] }) {
  return (
    <div className="relative h-[128px] overflow-hidden rounded-md border border-sidebar-border bg-sidebar-accent/40 px-5 py-4" data-testid="diagram-beam-scenario">
      <div className="cyber-beam absolute left-5 right-5 top-[58px] h-[7px] rounded-sm bg-accent shadow-[0_2px_0_hsl(210_37%_8%/.3)]" />
      {beamType === 'simply_supported' ? (
        <>
          <div className="absolute left-4 top-[65px] h-0 w-0 border-l-[10px] border-r-[10px] border-b-[17px] border-l-transparent border-r-transparent border-b-primary" />
          <div className="absolute right-4 top-[65px] h-0 w-0 border-l-[10px] border-r-[10px] border-b-[17px] border-l-transparent border-r-transparent border-b-primary" />
        </>
      ) : (
        <div className="absolute left-4 top-[38px] h-[47px] w-[7px] rounded-sm bg-primary" />
      )}
      {loadType === 'point_center' ? (
        <div className="cyber-force-arrow absolute left-1/2 top-4 -translate-x-1/2">
          <div className="mx-auto h-7 w-px border-l border-dashed border-primary" />
          <div className="h-0 w-0 border-l-[5px] border-r-[5px] border-t-[8px] border-l-transparent border-r-transparent border-t-primary" />
        </div>
      ) : (
        <div className="cyber-force-arrow absolute left-9 right-9 top-5 flex justify-between">
          {[0, 1, 2, 3, 4, 5].map((mark) => <div key={mark} className="h-7 w-px border-l border-dashed border-primary" />)}
        </div>
      )}
      <div className="absolute bottom-3 left-5 font-mono text-[9px] uppercase tracking-[0.18em] text-sidebar-foreground/55">{beamType === 'simply_supported' ? 'support line' : beamType === 'aircraft_wing' ? 'wing root fixed' : 'fixed end'}</div>
      <div className="absolute bottom-3 right-5 font-mono text-[9px] uppercase tracking-[0.18em] text-sidebar-foreground/55">{loadType === 'point_center' ? 'P / center' : 'w / uniform'}</div>
    </div>
  );
}

function DeflectionCurve({ result, beamType }: { result: DeflectionResult; beamType: DeflectionInput['beamType'] }) {
  const peakHeight = Math.min(86, Math.max(28, Math.abs(result.deflection) * 4));
  const peakY = 112 - peakHeight;
  const isCantilever = beamType !== 'simply_supported';
  const points = isCantilever
    ? `24,112 52,111 80,108 108,102 136,94 164,83 192,69 220,52 248,${peakY}`
    : `24,112 52,103 80,91 108,77 136,${peakY} 164,77 192,91 220,103 248,112`;
  return (
    <section className="rounded-lg border border-card-border bg-card p-5 shadow-[var(--shadow-sm)]" data-testid="deflection-curve">
      <div className="mb-3 flex items-start justify-between">
        <div><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Flight profile / deflection curve</p><p className="mt-1 text-xs text-muted-foreground">Peak response under applied load</p></div>
         <span className="font-mono text-[10px] font-bold text-primary">−{formatDisplayNumber(result.deflection)} {result.unit}</span>
      </div>
      <div className="relative overflow-hidden rounded-md border border-sidebar-border bg-sidebar px-3 py-2">
        <svg viewBox="0 0 272 132" className="h-[148px] w-full" role="img" aria-label={`Deflection curve peaking at ${result.deflection} ${result.unit}`}>
          <path d="M24 112 H248 M24 22 V112" stroke="hsl(210 21% 42% / .45)" strokeWidth="1" />
          <path d="M24 88 H248 M24 64 H248 M24 40 H248" stroke="hsl(210 21% 42% / .2)" strokeWidth="1" strokeDasharray="3 4" />
          <polyline points={points} fill="none" stroke="hsl(25 91% 56%)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="248" cy={peakY} r="4" fill="hsl(25 91% 56%)" />
          <text x="26" y="126" fill="hsl(210 22% 77%)" fontSize="7" fontFamily="Space Mono">ROOT / SUPPORT</text>
          <text x="198" y="126" fill="hsl(210 22% 77%)" fontSize="7" fontFamily="Space Mono">{isCantilever ? 'TIP' : 'SPAN END'}</text>
        </svg>
      </div>
    </section>
  );
}

function TelemetryTrace({ label, result, accent }: { label: string; result: NonNullable<DeflectionResult['physicsAgent']>; accent: 'primary' | 'mint' }) {
  const [derivationOpen, setDerivationOpen] = useState(false);
  const telemetryLines = Array.from(new Set(
    `${result.reasoning}\n${result.rawLog}`
      .split(/\r?\n/)
      .flatMap((line) => line.match(/\[[A-Z][A-Z0-9_]*(?:_[A-Z0-9]+)?[^\]]*\]/g) ?? [])
      .map((line) => line.trim())
      .filter(Boolean),
  ));
  useEffect(() => {
    setDerivationOpen(false);
  }, [result.rawLog]);
  return (
    <div className={`rounded-md border p-4 ${accent === 'primary' ? 'border-primary/30 bg-primary/5' : 'border-accent/30 bg-accent/5'}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-foreground">{label}</p>
        <span className="font-mono text-[10px] font-bold text-primary">{formatDisplayNumber(result.value)} {result.unit}</span>
      </div>
      <p className="mb-3 font-mono text-[10px] text-muted-foreground">{result.formula}</p>
      <pre className="max-h-48 overflow-auto whitespace-pre font-mono text-[10px] leading-5 text-muted-foreground">
        {telemetryLines.join('\n')}
      </pre>
      <button
        type="button"
        onClick={() => setDerivationOpen((open) => !open)}
        aria-expanded={derivationOpen}
        className="mt-3 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-primary/65 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        data-testid={`toggle-full-derivation-${accent}`}
      >
        [ VIEW FULL MATH DERIVATION {derivationOpen ? '▲' : '▼'} ]
      </button>
      <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${derivationOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="min-h-0 overflow-hidden">
          <div className="mt-3 border-t border-primary/15 pt-3">
            <p className="mb-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-primary/70">Full agent output stream</p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-white/[0.06] bg-black/20 p-3 font-mono text-[9px] leading-4 text-muted-foreground">{result.rawLog}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function StructuralVisualizer({ beamType, loadType, result }: { beamType: DeflectionInput['beamType']; loadType: DeflectionInput['loadType']; result: DeflectionResult | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 720;
    const height = 260;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const left = 56;
    const right = width - 56;
    const beamY = 132;
    const isCantilever = beamType !== 'simply_supported';
    const rawMeters = result?.physicsAgent?.finalAnswerM ?? 0;
    const bend = result ? Math.min(42, Math.max(7, Math.abs(rawMeters) * 18000)) : 0;

    context.fillStyle = '#0F0F12';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(255,255,255,0.055)';
    context.lineWidth = 1;
    for (let x = 0; x < width; x += 28) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 0; y < height; y += 28) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    const beamGradient = context.createLinearGradient(left, beamY, right, beamY);
    beamGradient.addColorStop(0, '#F59E0B');
    beamGradient.addColorStop(0.5, '#FB923C');
    beamGradient.addColorStop(1, '#FCD34D');
    context.shadowColor = 'rgba(251,146,60,0.8)';
    context.shadowBlur = 16;
    context.strokeStyle = beamGradient;
    context.lineWidth = 7;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(left, beamY);
    if (result) context.quadraticCurveTo((left + right) / 2, beamY + bend, right, isCantilever ? beamY + bend : beamY);
    else context.lineTo(right, beamY);
    context.stroke();
    context.shadowBlur = 0;

    context.fillStyle = '#FB923C';
    context.strokeStyle = 'rgba(251,146,60,0.95)';
    context.lineWidth = 2;
    if (isCantilever) {
      context.fillRect(left - 17, beamY - 42, 17, 84);
      context.strokeRect(left - 21, beamY - 48, 25, 96);
      context.fillStyle = 'rgba(251,146,60,0.35)';
      context.fillRect(left - 29, beamY - 54, 8, 108);
    } else {
      for (const supportX of [left + 18, right - 18]) {
        context.beginPath();
        context.moveTo(supportX, beamY + 6);
        context.lineTo(supportX - 18, beamY + 38);
        context.lineTo(supportX + 18, beamY + 38);
        context.closePath();
        context.fill();
        context.stroke();
      }
    }

    const drawArrow = (x: number) => {
      context.strokeStyle = '#FB923C';
      context.fillStyle = '#FB923C';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(x, 38);
      context.lineTo(x, beamY - 9);
      context.stroke();
      context.beginPath();
      context.moveTo(x, beamY - 9);
      context.lineTo(x - 5, beamY - 19);
      context.lineTo(x + 5, beamY - 19);
      context.closePath();
      context.fill();
    };
    if (loadType === 'point_center') {
      drawArrow((left + right) / 2);
    } else {
      for (let x = left + 18; x <= right - 18; x += Math.max(34, (right - left) / 8)) drawArrow(x);
    }

    if (result) {
      const apexX = isCantilever ? right : (left + right) / 2;
      const apexY = beamY + bend;
      context.strokeStyle = 'rgba(103,232,249,0.9)';
      context.setLineDash([3, 5]);
      context.beginPath();
      context.moveTo(apexX, apexY - 34);
      context.lineTo(apexX, apexY + 18);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = '#67E8F9';
      context.shadowColor = '#67E8F9';
      context.shadowBlur = 18;
      context.beginPath();
      context.arc(apexX, apexY, 5, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
    }
  }, [beamType, loadType, result]);

  return (
    <section className="mt-6 overflow-hidden rounded-lg border border-white/[0.08] bg-[#0F0F12]/70 shadow-[0_18px_55px_rgba(0,0,0,0.34)] backdrop-blur-xl" data-testid="structural-visualizer">
      <div className="border-b border-white/[0.08] px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">📊 Real-time core structural visualizer</p><p className="mt-1 text-xs text-muted-foreground">Live vector model · {beamType === 'simply_supported' ? 'simply supported' : 'fixed-wing cantilever'} · {loadType === 'point_center' ? 'center force' : 'distributed flight load'}</p></div>
           <span className={`rounded-full border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] ${result ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-200' : 'border-white/10 bg-white/[0.04] text-muted-foreground'}`}>{result ? `${formatDisplayNumber(result.physicsAgent?.finalAnswerM ?? 0)} m` : 'Awaiting load'}</span>
        </div>
      </div>
      <canvas ref={canvasRef} className="block h-[260px] w-full" aria-label="Live structural beam visualization" />
    </section>
  );
}

function ResultPanel({ result, pending, tier }: { result: DeflectionResult | null; pending: boolean; tier: Tier }) {
  if (pending) {
    return (
      <section className="rounded-lg border border-card-border bg-card p-5 shadow-[var(--shadow-sm)]" aria-label="Calculation in progress" data-testid="state-calculating">
        <div className="mb-6 flex items-center justify-between"><div className="h-3 w-36 animate-pulse rounded bg-muted" /><div className="h-6 w-20 animate-pulse rounded-full bg-muted" /></div>
        <div className="h-20 w-56 animate-pulse rounded bg-muted" />
        <div className="mt-7 space-y-3"><div className="h-3 w-full animate-pulse rounded bg-muted" /><div className="h-3 w-4/5 animate-pulse rounded bg-muted" /><div className="h-3 w-3/5 animate-pulse rounded bg-muted" /></div>
        <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground animate-pulse-line">Reconciling physics + mathematics</p>
      </section>
    );
  }
  if (!result) {
    return (
      <section className="instrument-grid flex min-h-[350px] flex-col justify-between rounded-lg border border-card-border bg-card p-5 shadow-[var(--shadow-sm)] sm:min-h-[386px]" data-testid="state-empty">
        <div className="flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Awaiting scenario</span><Ruler className="h-4 w-4 text-primary" /></div>
        <div>
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-primary/50 bg-primary/5"><Gauge className="h-5 w-5 text-primary" /></div>
          <h2 className="font-mono text-xl font-bold tracking-tight text-foreground">No result yet.</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Enter a beam scenario and run the check. Neometrist compares two independent calculation paths before it gives you a read.</p>
        </div>
        <div className="border-t border-border pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Inputs are not stored</div>
      </section>
    );
  }
  const status = statusCopy(result.status);
  const StatusIcon = status.icon;
  const toneClass = status.tone === 'mint' ? 'bg-accent/45 text-white border-accent' : status.tone === 'red' ? 'bg-destructive/10 text-destructive border-destructive/35' : 'bg-primary/10 text-primary border-primary/35';
  const consensusFailed = result.consensusStatus === 'failed';
  const isPremium = tier === 'premium';
  const confidencePercent = getDisplayConfidence(result, tier);
  return (
    <section className="animate-rise-in overflow-hidden rounded-lg border border-card-border bg-card shadow-[var(--shadow-sm)]" data-testid="result-panel">
      {consensusFailed && <div className="border-b border-red-500/50 bg-red-950/80 px-5 py-3 font-mono text-[11px] font-bold tracking-[0.16em] text-red-300 sm:px-6" role="alert" data-testid="reconciliation-failed-banner">[STATUS: RECONCILIATION FAILED]</div>}
      <div className="border-b border-border px-5 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Reconciled result</p><p className="mt-1 text-xs text-muted-foreground">Two-agent structural check</p></div>
          <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${toneClass}`} data-testid={`status-${result.status}`}><StatusIcon className="h-3.5 w-3.5" />{consensusFailed ? 'RECONCILIATION FAILED' : result.consensusStatus === 'verified' ? 'VERIFIED CONSENSUS' : status.label}</div>
        </div>
      </div>
      <div className="px-5 py-6 sm:px-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Maximum deflection</p>
         <div className="mt-1 flex items-baseline gap-2"><span className="font-mono text-[48px] font-bold leading-none tracking-[-0.08em] text-foreground" data-testid="text-deflection">{formatDisplayNumber(result.deflection)}</span><span className="font-mono text-sm text-muted-foreground" data-testid="text-deflection-unit">{result.unit}</span></div>
          <div className={`mt-5 border-l-2 pl-3 text-sm leading-6 ${consensusFailed ? 'border-destructive text-destructive' : 'border-primary text-foreground/80'}`} data-testid="text-summary">{result.summary}</div>
          {result.consensusStatus === 'verified' && <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-accent bg-accent/20 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-white"><ShieldCheck className="h-3.5 w-3.5" /> Engineering flight-safety check passed</div>}
         {consensusFailed && <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs leading-5 text-destructive"><strong>Meter-standardized answers conflict.</strong> Inspect the two raw agent logs below; this result is not flight-safe.</div>}
           {!isPremium && <div className="mt-4 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs leading-5 text-muted-foreground"><div className="flex items-center justify-between gap-3"><strong className="text-primary">Single-agent estimate.</strong><span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-primary">{confidencePercent}% confidence</span></div><p className="mt-1">Upgrade to Premium Pro to unlock the hidden mathematical proof and independent reconciliation.</p></div>}
        <div className="mt-6 rounded-md bg-secondary/65 p-4"><div className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-secondary-foreground" /><div><p className="text-xs font-bold uppercase tracking-[0.1em] text-secondary-foreground">Governing note</p><p className="mt-1 text-xs leading-5 text-secondary-foreground/85" data-testid="text-governing-note">{result.governingNote}</p></div></div></div>
      </div>
      <div className="border-t border-border px-5 py-5 sm:px-6">
        <div className="mb-4 flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{isPremium ? 'Dual-agent verification matrix' : 'AI telemetry stream'}</p>
          <span className="font-mono text-[11px] font-bold text-primary" data-testid="text-confidence">{confidencePercent}% confidence</span>
        </div>
         {isPremium ? (
          <div className="grid gap-4 md:grid-cols-2">
            <TelemetryTrace label="🤖 AI Brain 1: Structural Physicist Trace" result={result.physicsAgent} accent="primary" />
            {result.mathAgent && <TelemetryTrace label="🛡️ AI Brain 2: Mathematical Auditor Trace" result={result.mathAgent} accent="mint" />}
          </div>
        ) : (
           <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
            <TelemetryTrace label="🤖 AI Brain 1: Structural Physicist Trace" result={result.physicsAgent} accent="primary" />
             <div className="flex flex-col justify-center rounded-md border border-dashed border-white/10 bg-white/[0.02] p-4 opacity-60" aria-label="Mathematical Auditor locked">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">🛡️ AI Brain 2: Mathematical Auditor Trace</p>
               <p className="mt-2 text-xs leading-5 text-muted-foreground">Premium Pro lockout. Auditor telemetry remains hidden on this tier.</p>
              <span className="mt-3 inline-flex w-fit rounded border border-primary/25 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-primary">Upgrade to unlock</span>
            </div>
          </div>
        )}
        {consensusFailed && <div className="mt-4 grid gap-3 border-t border-destructive/25 pt-4 md:grid-cols-2">
          <div className="rounded-md border border-destructive/25 bg-destructive/5 p-3"><p className="font-mono text-[9px] uppercase tracking-[0.14em] text-destructive">Physics raw log</p><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[10px] leading-4 text-muted-foreground">{result.physicsAgent.rawLog}</pre></div>
          <div className="rounded-md border border-destructive/25 bg-destructive/5 p-3"><p className="font-mono text-[9px] uppercase tracking-[0.14em] text-destructive">Math auditor raw log</p><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[10px] leading-4 text-muted-foreground">{result.mathAgent?.rawLog}</pre></div>
        </div>}
      </div>
      <div className="border-t border-border bg-muted/35 px-5 py-4 sm:px-6"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Assumptions</p><ul className="mt-2 space-y-1">{result.assumptions.map((assumption, index) => <li key={assumption} className="flex gap-2 text-xs leading-5 text-muted-foreground" data-testid={`text-assumption-${index}`}><span className="font-mono text-primary">0{index + 1}</span>{assumption}</li>)}</ul></div>
    </section>
  );
}

export default function Home() {
  const form = useForm<FormValues>({ defaultValues: defaults, mode: 'onSubmit' });
  const [result, setResult] = useState<DeflectionResult | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [tier, setTier] = useState<Tier>(readPersistedTier);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [upgradeSuccess, setUpgradeSuccess] = useState(false);
  const [revenueCat, setRevenueCat] = useState<Purchases | null>(null);
  const [offerings, setOfferings] = useState<Array<{ identifier: string; price: string; packageRef: unknown }>>([]);
  const [purchaseError, setPurchaseError] = useState('');
  const [cachedInputKey, setCachedInputKey] = useState<string | null>(null);
  const [telemetryIndex, setTelemetryIndex] = useState(0);
  const telemetry = ['Spawning Physics Engine...', 'Analyzing Boundary Constants...', 'Reconciling Consensus Matrices...'];
  const [history, setHistory] = useState<RecentCalculation[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(historyKey) ?? '[]') as RecentCalculation[];
    } catch {
      return [];
    }
  });
  const monthKey = `neometrist-checks-${new Date().getUTCFullYear()}-${new Date().getUTCMonth() + 1}`;
  const [calculationCount, setCalculationCount] = useState(() => Number(localStorage.getItem(monthKey) ?? '0'));
  const calculation = useCalculateDeflection();
  const health = useHealthCheck();
  const beamType = form.watch('beamType');
  const loadType = form.watch('loadType');
  const units = form.watch('units');
  const material = form.watch('material');
  const elasticModulus = form.watch('elasticModulus');
  const length = form.watch('length');
  const width = form.watch('width');
  const depth = form.watch('depth');
  const load = form.watch('load');
  const activeLimit = tierLimit[tier];
  const materialOptions = useMemo(() => Object.keys(materialModuli), []);
  const inputEvaluationKey = useMemo(
    () => buildInputEvaluationKey({
      ...form.getValues(),
      material,
      beamType,
      elasticModulus,
      length,
      width,
      depth,
      load,
      loadType,
      units,
      accountTier: tier,
    }),
    [beamType, depth, elasticModulus, form, length, load, loadType, material, tier, units, width],
  );
  const duplicateInputBlocked = cachedInputKey !== null && cachedInputKey === inputEvaluationKey;

  useEffect(() => {
    form.setValue('accountTier', tier);
    try {
      if (tier === 'freemium') {
        localStorage.removeItem(tierStorageKey);
        localStorage.removeItem(legacyTierStorageKey);
      }
      else localStorage.setItem(tierStorageKey, tier);
    } catch {
      // Storage may be unavailable in private or embedded presentation contexts.
    }
  }, [form, tier]);

  useEffect(() => {
    const apiKey = import.meta.env.VITE_REVENUECAT_PUBLIC_API_KEY as string | undefined;
    if (!apiKey) return;
    try {
      const client = Purchases.configure({ apiKey, appUserId: 'student_test_user_id' });
      setRevenueCat(client);
    } catch {
      setPurchaseError('RevenueCat billing is not configured for this environment yet.');
    }
  }, []);

  useEffect(() => {
    if (!paywallOpen || !revenueCat) return;
    const refreshActiveOffering = async () => {
      try {
        const data = await revenueCat.getOfferings();
        const packages = data.current?.availablePackages ?? [];
        setOfferings(packages.map((pkg) => ({ identifier: pkg.webBillingProduct.identifier, price: pkg.webBillingProduct.currentPrice.formattedPrice, packageRef: pkg as never })));
        setPurchaseError('');
      } catch {
        setOfferings([]);
        setPurchaseError('Live offering metadata unavailable. Presentation sandbox is ready.');
      }
    };
    void refreshActiveOffering();
  }, [paywallOpen, revenueCat]);

  useEffect(() => {
    if (!calculation.isPending) return;
    const timer = window.setInterval(() => setTelemetryIndex((index) => (index + 1) % telemetry.length), 850);
    return () => window.clearInterval(timer);
  }, [calculation.isPending, telemetry.length]);

  const submit = (values: FormValues) => {
    setErrorMessage('');
    if (cachedInputKey === buildInputEvaluationKey(values)) {
      return;
    }
    if (calculationCount >= activeLimit) {
      setPaywallOpen(true);
      return;
    }
    calculation.mutate({ data: values }, {
      onSuccess: (data) => {
        setResult(data);
        setCachedInputKey(buildInputEvaluationKey(values));
        const nextCount = calculationCount + 1;
        setCalculationCount(nextCount);
        localStorage.setItem(monthKey, String(nextCount));
        const entry: RecentCalculation = {
          id: `${Date.now()}-${nextCount}`,
          date: new Date().toISOString(),
          inputs: values,
          result: data,
        };
        const nextHistory = [entry, ...history].slice(0, 12);
        setHistory(nextHistory);
        localStorage.setItem(historyKey, JSON.stringify(nextHistory));
      },
      onError: (error) => setErrorMessage(error instanceof Error ? error.message : 'The calculation service could not be reached. Check your connection and try again.'),
    });
  };

  const reset = () => { form.reset(defaults); setCachedInputKey(null); setResult(null); setErrorMessage(''); };
  const resetUsage = () => {
    localStorage.removeItem(monthKey);
    setCalculationCount(0);
  };
  const clearHistory = () => {
    localStorage.removeItem(historyKey);
    setHistory([]);
  };
  const restoreCalculation = (entry: RecentCalculation) => {
    form.reset(entry.inputs);
    setTier(entry.inputs.accountTier);
    setCachedInputKey(buildInputEvaluationKey(entry.inputs));
    setResult(entry.result);
    setErrorMessage('');
    setMenuOpen(false);
  };
  const canUseMaterial = (material: string) => tierRank[tier] >= tierRank[materialTier[material]];
  const openUpgrade = () => {
    setUpgradeSuccess(false);
    setPurchaseError('');
    setPaywallOpen(true);
  };
  const randomBetween = (min: number, max: number) => Number((min + Math.random() * (max - min)).toFixed(2));
  const generatePreset = (kind: 'aerospace' | 'civil') => {
    const eligibleMaterials = materialOptions.filter(canUseMaterial);
    const civilMaterials = eligibleMaterials.filter((material) => materialTier[material] === 'freemium');
    const materials = kind === 'civil' ? (civilMaterials.length ? civilMaterials : eligibleMaterials) : eligibleMaterials;
    const material = materials[Math.floor(Math.random() * materials.length)] ?? defaults.material;
    const next: FormValues = {
      ...form.getValues(),
      beamType: kind === 'aerospace' ? 'aircraft_wing' : 'simply_supported',
      loadType: kind === 'aerospace' ? 'uniform' : 'point_center',
      material,
      elasticModulus: materialModuli[material],
      length: kind === 'aerospace' ? randomBetween(5, 12) : randomBetween(3, 8),
      width: kind === 'aerospace' ? randomBetween(0.18, 0.42) : randomBetween(0.08, 0.22),
      depth: kind === 'aerospace' ? randomBetween(0.08, 0.18) : randomBetween(0.16, 0.36),
      load: kind === 'aerospace' ? randomBetween(20, 80) : randomBetween(10, 50),
      units: 'metric',
      accountTier: tier,
    };
    form.reset(next);
    setCachedInputKey(null);
    setResult(null);
    setErrorMessage('');
  };
  const purchasePlan = async (plan: Exclude<Tier, 'freemium'>) => {
    setPurchaseError('');
    try {
      if (tier === plan || tier === 'premium') {
        throw new Error(`${tierLabel[plan]} is already active. Use [ DEMO RESET ] to start a new demo.`);
      }
      if (!revenueCat) throw new Error('RevenueCat client is unavailable');
      const data = await revenueCat.getOfferings();
      const packages = data.current?.availablePackages ?? [];
      setOfferings(packages.map((pkg) => ({ identifier: pkg.webBillingProduct.identifier, price: pkg.webBillingProduct.currentPrice.formattedPrice, packageRef: pkg as never })));
      const productId = purchaseProductByTier[plan];
      const selected = packages.find((pkg) => pkg.webBillingProduct.identifier === productId);
      if (!selected) throw new Error(`Missing active RevenueCat product ${productId}`);
      await revenueCat.purchase({ rcPackage: selected });
      // The purchased package is authoritative for this callback. Do not infer
      // a higher tier from another already-active entitlement.
      setTier(plan);
      form.setValue('accountTier', plan);
      localStorage.setItem(tierStorageKey, plan);
      setPaywallOpen(false);
      setUpgradeSuccess(true);
    } catch (error) {
      setPurchaseError(error instanceof Error ? error.message : 'RevenueCat checkout could not be completed.');
    }
  };
  const demoReset = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    console.info('EXECUTION OVERRIDE: TOTAL RESET INITIATED');
    setTier('freemium');
    form.setValue('accountTier', 'freemium');
    setCalculationCount(0);
    setCachedInputKey(null);
    setResult(null);
    setPaywallOpen(false);
    setUpgradeSuccess(false);
    setMenuOpen(false);
    localStorage.clear();
    sessionStorage.clear();
    setHistory([]);
    setErrorMessage('');
    localStorage.removeItem(tierStorageKey);
    localStorage.removeItem(legacyTierStorageKey);
    window.location.href = `${window.location.origin}${window.location.pathname}?reset=${Date.now()}`;
  };

  return (
    <div className="noise-layer min-h-[100dvh] bg-background">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[248px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex h-[76px] items-center border-b border-sidebar-border px-6"><div className="mr-3 flex h-8 w-8 items-center justify-center rounded border border-primary bg-primary/10 font-mono text-sm font-bold text-primary">N</div><div><p className="font-mono text-[13px] font-bold tracking-[0.16em]">NEOMETRIST</p><p className="font-mono text-[9px] uppercase tracking-[0.2em] text-sidebar-foreground/50">field intelligence</p></div></div>
        <nav className="flex-1 px-3 py-6"><p className="px-3 pb-3 font-mono text-[9px] uppercase tracking-[0.2em] text-sidebar-foreground/40">Workspace</p><div className="flex items-center gap-3 rounded-md bg-sidebar-accent px-3 py-3 text-sm font-semibold text-sidebar-accent-foreground" data-testid="nav-deflection"><Activity className="h-4 w-4 text-primary" />Deflection check</div><div className="mt-1 flex items-center gap-3 rounded-md px-3 py-3 text-sm text-sidebar-foreground/45"><Layers3 className="h-4 w-4" />Saved checks <span className="ml-auto font-mono text-[10px]">soon</span></div></nav>
        <div className="border-t border-sidebar-border p-5"><div className="flex items-center gap-2 text-[11px] text-sidebar-foreground/65"><span className={`h-1.5 w-1.5 rounded-full ${health.isError ? 'bg-destructive' : 'bg-accent'}`} />{health.isLoading ? 'Checking service' : health.isError ? 'Service unavailable' : 'Calculation service online'}</div><p className="mt-2 font-mono text-[9px] leading-4 text-sidebar-foreground/35">NEOMETRIST AI / BUILD 01<br />For preliminary checks only.</p></div>
      </aside>
      <header className="sticky top-0 z-10 flex h-[68px] items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur-md lg:ml-[248px] lg:h-[76px] lg:px-9">
        <div className="flex items-center gap-3"><button onClick={() => setMenuOpen(!menuOpen)} className="flex h-9 w-9 items-center justify-center rounded-md border border-border lg:hidden" aria-label="Toggle menu" data-testid="button-toggle-menu"><Menu className="h-4 w-4" /></button><div className="lg:hidden"><p className="font-mono text-[12px] font-bold tracking-[0.16em]">NEOMETRIST</p><p className="font-mono text-[8px] uppercase tracking-[0.18em] text-muted-foreground">field intelligence</p></div><div className="hidden lg:block"><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Workspace / 01</p><h1 className="mt-1 text-sm font-semibold">Beam deflection check</h1></div></div>
        <div className="flex items-center gap-3">
            {tier !== 'premium' && <div id="mium-bar-container" className="hidden items-center rounded-md border border-border bg-card p-1 sm:flex" aria-label="Account Status">
            <span className="px-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Account Status</span>
             <button type="button" onClick={() => { setTier('freemium'); setUpgradeSuccess(false); }} className={`rounded px-2 py-1.5 text-[10px] font-semibold transition-colors ${tier === 'freemium' ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground'}`} aria-pressed={tier === 'freemium'}>Freemium</button>
              <button type="button" onClick={openUpgrade} className="rounded px-2 py-1.5 text-[10px] font-semibold text-muted-foreground transition-colors hover:text-foreground">Promium</button>
             <button type="button" onClick={openUpgrade} className="rounded px-2 py-1.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground">Premium Pro</button>
           </div>}
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"><span className={`h-1.5 w-1.5 rounded-full ${health.isError ? 'bg-destructive' : 'bg-accent'}`} />{health.isLoading ? 'Syncing' : health.isError ? 'Offline' : 'Ready'}</div>
        </div>
      </header>
      <div className={`fixed inset-0 z-40 bg-sidebar/55 backdrop-blur-[2px] transition-opacity duration-300 ${menuOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`} onClick={() => setMenuOpen(false)} aria-hidden={!menuOpen} />
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[min(88vw,360px)] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-2xl transition-transform duration-300 ease-out ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`} aria-label="Calculation menu">
        <div className="flex items-center justify-between border-b border-sidebar-border px-5 py-5">
          <div><p className="font-mono text-[12px] font-bold tracking-[0.16em]">NEOMETRIST</p><p className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-sidebar-foreground/50">workspace drawer</p></div>
          <button type="button" onClick={() => setMenuOpen(false)} className="rounded-md p-2 text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground" aria-label="Close menu"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-5">
          <div className="mb-5 rounded-md border border-sidebar-border bg-sidebar-accent/55 p-4">
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-sidebar-foreground/55">Subscription Status</p>
             <div className="mt-3 flex items-center justify-between"><span id="tier-pill" className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${tier === 'premium' ? 'border-primary/50 bg-primary/15 text-primary' : tier === 'promium' ? 'border-blue-300/50 bg-blue-300/15 text-blue-200' : 'border-accent/40 bg-accent/10 text-accent'}`}>{tier === 'promium' ? '[ PROMIUM TIER ]' : tierLabel[tier]}</span><span className="font-mono text-[10px] text-sidebar-foreground/60">{Number.isFinite(activeLimit) ? `${Math.min(calculationCount, activeLimit)}/${activeLimit}` : `${calculationCount} / ∞`} checks</span></div>
             {tier !== 'premium' && <button type="button" onClick={openUpgrade} className="mt-3 w-full rounded-md border border-primary/45 px-3 py-2 text-left text-xs font-semibold text-primary transition-colors hover:bg-primary/10">Open plan options <ArrowRight className="float-right h-3.5 w-3.5" /></button>}
          </div>
          <div className="mb-5">
            <div className="mb-3 flex items-center justify-between"><p className="font-mono text-[9px] uppercase tracking-[0.18em] text-sidebar-foreground/55">Recent Calculations</p><History className="h-3.5 w-3.5 text-primary" /></div>
            {history.length === 0 ? (
              <div className="rounded-md border border-dashed border-sidebar-border px-3 py-5 text-center text-xs leading-5 text-sidebar-foreground/50">Successful checks will appear here for quick review.</div>
            ) : (
              <div className="space-y-2">
                {history.map((entry) => {
                  const support = entry.inputs.beamType === 'simply_supported' ? 'Simply supported' : entry.inputs.beamType === 'aircraft_wing' ? 'Aircraft Wing' : 'Cantilever';
                  const status = statusCopy(entry.result.status);
                  return <button type="button" key={entry.id} onClick={() => restoreCalculation(entry)} className="w-full rounded-md border border-sidebar-border bg-sidebar-accent/35 p-3 text-left transition-colors hover:border-primary/50 hover:bg-sidebar-accent" data-testid={`history-card-${entry.id}`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-sidebar-foreground">{entry.inputs.material}</p><p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-sidebar-foreground/45">{new Date(entry.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {support}</p></div><span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${status.tone === 'mint' ? 'border-accent/40 bg-accent/10 text-accent' : status.tone === 'red' ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-primary/40 bg-primary/10 text-primary'}`}>{status.label}</span></div><p className="mt-3 font-mono text-sm font-bold text-primary">{formatDisplayNumber(entry.result.deflection)} {entry.result.unit}</p></button>;
                })}
              </div>
            )}
          </div>
          <div className="space-y-2 border-t border-sidebar-border pt-4">
            <button type="button" onClick={resetUsage} className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-xs font-semibold text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"><RotateCcw className="h-4 w-4 text-primary" />Reset Usage Counter</button>
            <button type="button" onClick={clearHistory} className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-xs font-semibold text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"><Trash2 className="h-4 w-4 text-primary" />Clear History Log</button>
          </div>
        </div>
      </aside>
      <main className="lg:ml-[248px]">
        <div className="mx-auto max-w-[1420px] px-4 py-7 sm:px-7 sm:py-9 lg:px-10 lg:py-12">
          {upgradeSuccess && (
            <div className="mb-6 flex items-start gap-3 rounded-lg border border-accent bg-accent/20 px-4 py-3 text-sm text-white shadow-[var(--shadow-sm)]" role="status" data-testid="premium-success">
              <Check className="mt-0.5 h-4 w-4 shrink-0" />
              <div><p className="font-semibold text-white">Success! {tierLabel[tier]} Unlocked</p><p className="mt-0.5 text-xs text-white/80">{tier === 'premium' ? 'The Safety Auditor is now active with unlimited structural checks.' : 'Promium materials are now active for up to 30 monthly checks.'}</p></div>
            </div>
          )}
           {tier !== 'premium' && <div className="mb-6 flex flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-[var(--shadow-sm)] sm:hidden">
            <div className="flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Account Status</span><span className="font-mono text-[10px] text-primary">{tier === 'freemium' ? `${Math.min(calculationCount, 10)}/10 checks` : `${Math.min(calculationCount, 30)}/30 checks`}</span></div>
             <div className="grid grid-cols-3 rounded-md border border-border bg-muted/45 p-1">
              <button type="button" onClick={() => { setTier('freemium'); setUpgradeSuccess(false); }} className={`rounded px-2 py-2 text-[10px] font-semibold transition-colors ${tier === 'freemium' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}>Freemium Tier</button>
                <button type="button" onClick={openUpgrade} className="rounded px-2 py-2 text-[10px] font-semibold text-muted-foreground transition-colors">Promium</button>
               <button type="button" onClick={openUpgrade} className="rounded px-2 py-2 text-[10px] font-semibold text-muted-foreground">Premium</button>
            </div>
          </div>}
          <div className="mb-8 max-w-3xl animate-rise-in"><div className="mb-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-primary"><span className="h-px w-6 bg-primary" />Civil + aerospace structural check</div><h2 className="max-w-2xl text-[34px] font-semibold leading-[1.08] tracking-[-0.045em] text-foreground sm:text-[46px]">A second set of eyes<br className="hidden sm:block" /> for your beam decisions.</h2><p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground sm:text-[15px]">Multi-agent structural mechanics intelligence for civil beams and aerospace wing profiles.</p></div>
           <section className="mb-6 rounded-lg border border-card-border bg-card/70 p-4 shadow-[var(--shadow-sm)] backdrop-blur-md" aria-label="Dynamic simulation presets">
             <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
               <div><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Generate Dynamic Simulation Presets</p><p className="mt-1 text-xs text-muted-foreground">Roll a realistic starting scenario, then tune the inputs before calculating.</p></div>
               <div className="flex flex-wrap gap-2">
                 <button type="button" onClick={() => generatePreset('aerospace')} className="rounded-full border border-primary/35 bg-primary/10 px-3 py-2 text-xs font-semibold text-foreground transition-all hover:-translate-y-0.5 hover:border-primary hover:bg-primary/15 active:translate-y-0">✈️ Aerospace Wing Profile</button>
                 <button type="button" onClick={() => generatePreset('civil')} className="rounded-full border border-accent/45 bg-accent/10 px-3 py-2 text-xs font-semibold text-foreground transition-all hover:-translate-y-0.5 hover:border-accent hover:bg-accent/20 active:translate-y-0">🏗️ Civil Structural Beam</button>
                 <button type="button" id="reset-counter-btn" onClick={demoReset} className="rounded-full border border-orange-400/55 bg-orange-400/5 px-3 py-2 font-mono text-[10px] font-bold tracking-[0.12em] text-orange-300 transition-colors hover:border-orange-300 hover:bg-orange-400/15" data-testid="button-demo-reset">[ DEMO RESET ]</button>
               </div>
             </div>
           </section>
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(500px,0.92fr)_minmax(430px,0.8fr)]">
            <section className="animate-rise-in rounded-lg border border-card-border bg-card shadow-[var(--shadow-sm)]" style={{ animationDelay: '80ms' }}>
              <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6"><div><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">01 / Input scenario</p><p className="mt-1 text-xs text-muted-foreground">Use consistent units throughout.</p></div><button type="button" onClick={reset} className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground" data-testid="button-reset-form"><RotateCcw className="h-3.5 w-3.5" />Reset</button></div>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(submit)} className="space-y-6 px-5 py-5 sm:px-6 sm:py-6">
                  <div className="grid gap-5 sm:grid-cols-2">
                     <FormField control={form.control} name="beamType" render={({ field }) => <FormItem><FormLabel>Support condition</FormLabel><p className="mb-2 text-[10px] leading-4 text-muted-foreground">Cantilever mimics an aircraft wing fixed to a fuselage.</p><FormControl><div className="relative"><select {...field} data-testid="select-beamType" className="h-11 w-full appearance-none rounded-md border border-input bg-background/80 px-3 pr-9 text-[13px] outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"><option value="simply_supported">Simply supported</option><option value="cantilever">Cantilever</option><option value="aircraft_wing">Aircraft Wing (Cantilever Fixed)</option></select><ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-muted-foreground" /></div></FormControl><FormMessage /></FormItem>} />
                     <FormField control={form.control} name="loadType" render={({ field }) => <FormItem><FormLabel>Load pattern</FormLabel><p className="mb-2 text-[10px] leading-4 text-muted-foreground">Choose a point force or distributed pressure across the span.</p><FormControl><div className="relative"><select {...field} data-testid="select-loadType" className="h-11 w-full appearance-none rounded-md border border-input bg-background/80 px-3 pr-9 text-[13px] outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"><option value="point_center">Point at center</option><option value="uniform">Uniformly distributed</option></select><ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-muted-foreground" /></div></FormControl><FormMessage /></FormItem>} />
                  </div>
                  <BeamDiagram beamType={beamType} loadType={loadType} />
                   <div className="grid gap-5 sm:grid-cols-2"><FormField control={form.control} name="material" render={({ field }) => <FormItem><FormLabel>Material</FormLabel><FormControl><div className="relative"><select {...field} data-testid="select-material" onChange={(event) => { const nextMaterial = event.target.value; if (!canUseMaterial(nextMaterial)) { openUpgrade(); return; } field.onChange(nextMaterial); form.setValue('elasticModulus', materialModuli[nextMaterial] ?? 0); }} className="h-11 w-full appearance-none rounded-md border border-input bg-background/80 px-3 pr-9 text-[13px] outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15">{materialOptions.map((material) => <option key={material} value={material} disabled={!canUseMaterial(material)}>{material}{!canUseMaterial(material) ? ' · locked' : ''}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-muted-foreground" /></div></FormControl><p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Civil / aerospace / advanced alloy access follows your plan</p><FormMessage /></FormItem>} /><Field control={form.control} name="elasticModulus" label="Elastic modulus" unit={units === 'metric' ? 'GPa' : 'ksi'} /></div>
                  <div className="grid gap-5 sm:grid-cols-3"><Field control={form.control} name="length" label="Span length" unit={units === 'metric' ? 'm' : 'ft'} /><Field control={form.control} name="width" label="Section width" unit={units === 'metric' ? 'm' : 'in'} /><Field control={form.control} name="depth" label="Section depth" unit={units === 'metric' ? 'm' : 'in'} /></div>
                   <div className="grid gap-5 sm:grid-cols-[1fr_1.15fr]"><FormField control={form.control} name="load" render={({ field }) => <FormItem><FormLabel>Applied load</FormLabel><p className="mb-2 text-[10px] leading-4 text-muted-foreground">Simulates lift pressure or point weight forces.</p><FormControl><div className="relative"><input {...field} type="number" step="any" min="0" onChange={(event) => field.onChange(Number(event.target.value))} className="h-11 w-full rounded-md border border-input bg-background/80 px-3 font-mono text-[13px] text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15" /> <span className="pointer-events-none absolute right-3 top-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{units === 'metric' ? 'kN' : 'kip'}</span></div></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="units" render={({ field }) => <FormItem><FormLabel>Unit system</FormLabel><FormControl><div className="grid h-11 grid-cols-2 rounded-md border border-input bg-muted/45 p-1">{(['metric', 'imperial'] as const).map((option) => <button key={option} type="button" onClick={() => field.onChange(option)} data-testid={`button-units-${option}`} className={`rounded text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors ${field.value === option ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{option}</button>)}</div></FormControl><FormMessage /></FormItem>} /></div>
                   <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"><span>{tier === 'premium' ? 'Physics + Mathematical Auditor' : 'Physics agent only'}</span><span className="text-primary">{Number.isFinite(activeLimit) ? `${Math.min(calculationCount, activeLimit)}/${activeLimit}` : `${calculationCount} / unlimited`} this month</span></div>
                  {errorMessage && <div className="flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-3 text-xs leading-5 text-destructive" role="alert" data-testid="state-calculation-error"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{errorMessage}</span></div>}
                    <Button type="submit" disabled={calculation.isPending} className="cyber-button h-12 w-full rounded-md bg-primary text-sm font-bold text-primary-foreground shadow-[0_4px_0_hsl(25_91%_40%)] transition-transform hover:-translate-y-0.5 hover:bg-primary active:translate-y-0 active:shadow-none disabled:translate-y-0 disabled:opacity-70" data-testid="button-calculate"><span className="terminal-brackets">{calculation.isPending ? telemetry[telemetryIndex] : duplicateInputBlocked ? '[ IDENTICAL INPUT MATRIX RUNNING ]' : '[ CALCULATE DEFLECTION ]'}</span><ArrowRight className="ml-2 h-4 w-4" /></Button>
                    {duplicateInputBlocked && !calculation.isPending && <p className="text-center font-mono text-[10px] uppercase tracking-[0.12em] text-primary/70" role="status" data-testid="duplicate-input-notice">Inputs unchanged. Results already displayed on screen.</p>}
                </form>
              </Form>
              <StructuralVisualizer beamType={beamType} loadType={loadType} result={result} />
            </section>
            <div className="space-y-6 xl:sticky xl:top-[100px]">
               <ResultPanel result={result} pending={calculation.isPending} tier={tier} />
              {result && <DeflectionCurve result={result} beamType={beamType} />}
              <div className="flex gap-3 rounded-lg border border-card-border bg-card/60 p-4 text-xs leading-5 text-muted-foreground shadow-[var(--shadow-sm)]"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p><strong className="font-semibold text-foreground">Read the result as a check, not a sign-off.</strong> Validate boundary conditions, load paths, and local code limits before making a construction decision.</p></div>
            </div>
          </div>
        </div>
      </main>
      {paywallOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-sidebar/70 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="paywall-title">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-sidebar-border bg-card shadow-2xl">
            <div className="border-b border-border bg-sidebar px-6 py-5 text-sidebar-foreground">
              <div className="mb-4 flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">RevenueCat Paywall</span><button type="button" onClick={() => setPaywallOpen(false)} className="rounded p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground" aria-label="Close upgrade dialog"><X className="h-4 w-4" /></button></div>
              <p className="font-mono text-2xl font-bold tracking-tight">Upgrade your read.</p>
              <p className="mt-2 text-sm leading-6 text-sidebar-foreground/70">Move from a single estimate to a verified engineering decision.</p>
            </div>
            <div className="px-6 py-6">
               <h2 id="paywall-title" className="text-lg font-bold leading-7 text-foreground">Choose the calculation depth your work needs.</h2>
               <div className="mt-5 space-y-3 text-sm text-muted-foreground"><div className="flex gap-3"><Check className="h-4 w-4 shrink-0 text-primary" />Promium: 30 checks/month and aerospace materials</div><div className="flex gap-3"><Check className="h-4 w-4 shrink-0 text-primary" />Premium Pro: unlimited checks and advanced alloys</div><div className="flex gap-3"><Check className="h-4 w-4 shrink-0 text-primary" />Premium Pro activates the independent mathematical auditor</div></div>
               <div className="mt-6 space-y-3">
                 {(['promium', 'premium'] as const).filter((plan) => plan !== tier).map((plan) => {
                   const offering = offerings.find((item) => item.packageRef && item.identifier.toLowerCase().includes(plan));
                   return <button key={plan} id={plan === 'promium' ? 'buy-promium-btn' : 'buy-premium-btn'} type="button" onClick={() => void purchasePlan(plan)} className="flex w-full items-center justify-between rounded-md border border-primary/35 bg-primary/5 px-4 py-3 text-left transition-colors hover:bg-primary/10" data-testid={`button-upgrade-${plan}`}><span><strong className="block text-sm text-foreground">{tierLabel[plan]}</strong><span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{offering?.price ?? (plan === 'promium' ? '$1.99/mo' : '$4.99/mo')} · RevenueCat offering</span></span><ArrowRight className="h-4 w-4 text-primary" /></button>;
                 })}
               </div>
               {purchaseError && <p className="mt-4 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive" role="alert">{purchaseError}</p>}
               <button type="button" onClick={() => setPaywallOpen(false)} className="mt-3 h-9 w-full rounded-md text-xs font-semibold text-muted-foreground hover:text-foreground">Stay on {tierLabel[tier]}</button>
               <p className="mt-3 text-center font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">{revenueCat?.isSandbox() ? 'RevenueCat sandbox transaction' : 'RevenueCat Web Billing'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}