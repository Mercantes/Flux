'use client';

import { useState } from 'react';

import { HelpCircle, Maximize2 } from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

import type { MeetingsByDayPoint } from '../utils/meetings-by-day';

// RM usa o vermelho da V4 (token --primary do tema: #d8151e claro / #e6443d
// escuro); RR usa verde emerald-600, mesma família do card "Reuniões
// realizadas". Par validado para daltonismo nos dois temas pelo validador do
// skill dataviz (ΔE deutan ≈ 8.9 claro / 8.8 escuro). Verdes mais escuros ou
// mais claros que este falham contra o vermelho no tema escuro.
const RM_COLOR = 'var(--primary)';
const RR_COLOR = '#059669';

const TITLE = 'Reuniões marcadas (RM) e realizadas (RR) por dia';
const HELP =
  'Quantas reuniões foram marcadas e quantas foram realizadas em cada dia do período.\n\n' +
  '• RM: dia em que o SDR marcou a reunião (meeting_scheduled_at).\n' +
  '• RR: dia em que o lead virou Ganho (reunião confirmada como realizada). Some da barra se o closer marcar no-show depois.\n' +
  '• Tendência: reta ajustada (regressão linear) sobre os dias de operação já ocorridos — fins de semana e dias sem nenhum movimento (feriado, parada) ficam de fora do cálculo.\n\n' +
  'Segue o mesmo filtro dos cards acima; a soma das barras bate com o número grande de cada card.';

interface MeetingsByDayChartProps {
  data: MeetingsByDayPoint[];
}

interface TooltipEntry {
  dataKey?: string | number;
  value?: number | string | null;
  color?: string;
}

interface MeetingsTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: TooltipEntry[];
}

/** Tooltip só com RM e RR — as retas de tendência ficam de fora. */
function MeetingsTooltip({ active, label, payload }: MeetingsTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const rm = payload.find((p) => p.dataKey === 'scheduled');
  const rr = payload.find((p) => p.dataKey === 'held');
  if (!rm && !rr) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground shadow-md">
      <p className="mb-1 font-medium">Dia {label}</p>
      <p className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: RM_COLOR }} />
        Marcadas (RM): <span className="font-semibold">{rm?.value ?? 0}</span>
      </p>
      <p className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: RR_COLOR }} />
        Realizadas (RR): <span className="font-semibold">{rr?.value ?? 0}</span>
      </p>
    </div>
  );
}

/** Rótulo em cima da barra; esconde 0/null pra não poluir. */
function barLabel(value: unknown): string {
  return typeof value === 'number' && value > 0 ? String(value) : '';
}

function yMax(data: MeetingsByDayPoint[]): number {
  let max = 0;
  for (const p of data) {
    max = Math.max(max, p.scheduled ?? 0, p.held ?? 0);
  }
  // Folga pro rótulo acima da barra mais alta, arredondada pra número par
  // (ticks limpos); mínimo 6 pra dias fracos não virarem barras gigantes.
  return Math.max(6, Math.ceil((max * 1.2) / 2) * 2);
}

function MeetingsChart({ data, height }: { data: MeetingsByDayPoint[]; height: number }) {
  const labelStyle = { fontSize: 10, fill: 'var(--muted-foreground)' };
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={data}
        margin={{ top: 16, right: 8, bottom: 0, left: -20 }}
        barCategoryGap="18%"
        barGap={3}
      >
        <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="label"
          interval="equidistantPreserveStart"
          tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
          axisLine={{ stroke: 'var(--border)' }}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          domain={[0, yMax(data)]}
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip cursor={{ fill: 'var(--accent)', fillOpacity: 0.35 }} content={<MeetingsTooltip />} />
        <Bar
          dataKey="scheduled"
          name="RM"
          fill={RM_COLOR}
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
          isAnimationActive={false}
        >
          <LabelList dataKey="scheduled" position="top" formatter={barLabel} style={labelStyle} />
        </Bar>
        <Bar
          dataKey="held"
          name="RR"
          fill={RR_COLOR}
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
          isAnimationActive={false}
        >
          <LabelList dataKey="held" position="top" formatter={barLabel} style={labelStyle} />
        </Bar>
        <Line
          type="linear"
          dataKey="trendScheduled"
          name="Tend. RM"
          stroke={RM_COLOR}
          strokeWidth={2}
          strokeOpacity={0.7}
          strokeDasharray="6 3"
          dot={false}
          activeDot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          type="linear"
          dataKey="trendHeld"
          name="Tend. RR"
          stroke={RR_COLOR}
          strokeWidth={2}
          strokeOpacity={0.7}
          strokeDasharray="6 3"
          dot={false}
          activeDot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function ChartLegend() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 py-3" data-slot="meetings-legend">
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: RM_COLOR }} />
        <span className="text-xs text-muted-foreground">Marcadas (RM)</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: RR_COLOR }} />
        <span className="text-xs text-muted-foreground">Realizadas (RR)</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: RM_COLOR }} />
        <span className="text-xs text-muted-foreground">Tend. RM</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: RR_COLOR }} />
        <span className="text-xs text-muted-foreground">Tend. RR</span>
      </div>
    </div>
  );
}

/** Visão em tabela (acessibilidade / conferência) — só no modal expandido. */
function MeetingsTable({ data }: { data: MeetingsByDayPoint[] }) {
  const rows = data.filter((p) => p.scheduled !== null || p.held !== null);
  return (
    <div className="max-h-56 overflow-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium">Dia</th>
            <th className="px-3 py-1.5 text-right font-medium">Marcadas (RM)</th>
            <th className="px-3 py-1.5 text-right font-medium">Realizadas (RR)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.day} className="border-t border-border">
              <td className="px-3 py-1">{p.label}</td>
              <td className="px-3 py-1 text-right tabular-nums">{p.scheduled ?? 0}</td>
              <td className="px-3 py-1 text-right tabular-nums">{p.held ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MeetingsByDayChart({ data }: MeetingsByDayChartProps) {
  const [expanded, setExpanded] = useState(false);
  const hasAny = data.some((p) => (p.scheduled ?? 0) > 0 || (p.held ?? 0) > 0);

  return (
    <>
      <div className="flex flex-col rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between px-4 pt-4">
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            {TITLE}
            <span title={HELP}>
              <HelpCircle className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
            </span>
          </h3>
          {hasAny && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              title="Expandir"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="px-2 pt-2">
          {hasAny ? (
            <MeetingsChart data={data} height={320} />
          ) : (
            <div className="flex h-[280px] items-center justify-center">
              <p className="text-sm text-muted-foreground">Sem reuniões no período</p>
            </div>
          )}
        </div>

        {hasAny && (
          <div className="border-t border-border">
            <ChartLegend />
          </div>
        )}
      </div>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-[90vw]">
          <DialogHeader>
            <DialogTitle>{TITLE}</DialogTitle>
          </DialogHeader>
          <div className="min-h-[500px]">
            <MeetingsChart data={data} height={500} />
          </div>
          <ChartLegend />
          <MeetingsTable data={data} />
        </DialogContent>
      </Dialog>
    </>
  );
}
