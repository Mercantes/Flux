import type { DailyDataPoint } from '../types';

/**
 * Ponto do gráfico "Reuniões marcadas (RM) e realizadas (RR) por dia".
 * `null` = dia que ainda não aconteceu (não plota barra nem tendência).
 */
export interface MeetingsByDayPoint {
  day: number;
  /** DD/MM */
  label: string;
  scheduled: number | null;
  held: number | null;
  trendScheduled: number | null;
  trendHeld: number | null;
}

/**
 * Converte uma série ACUMULADA (`DailyDataPoint.actual`) em contagem por dia:
 * dia 1 = actual[0]; dia d = actual[d] - actual[d-1]. `null` é preservado
 * (dias futuros). Nunca devolve negativo — a fonte é monotônica, mas um
 * recorte estranho de janela não deve virar barra negativa.
 */
export function diffCumulative(series: DailyDataPoint[]): Array<number | null> {
  const out: Array<number | null> = [];
  let prev = 0;
  for (const point of series) {
    if (point.actual === null || point.actual === undefined) {
      out.push(null);
      continue;
    }
    out.push(Math.max(0, point.actual - prev));
    prev = point.actual;
  }
  return out;
}

/**
 * Regressão linear (mínimos quadrados) sobre os índices com valor não-nulo.
 * Devolve o valor da reta em cada índice não-nulo (clampado em >= 0) e `null`
 * onde a entrada é `null`. Com menos de 2 pontos não há reta: tudo `null`.
 *
 * `includeInFit` restringe QUAIS índices entram no ajuste (ver
 * `operatingDaysMask`) — a reta continua sendo desenhada em todos os dias já
 * ocorridos, pra linha não ficar picotada. Se a máscara deixar menos de 2
 * pontos, ela é ignorada e o ajuste usa todos os dias com valor.
 */
export function linearTrend(
  values: Array<number | null>,
  includeInFit?: Array<boolean>,
): Array<number | null> {
  const collect = (useMask: boolean) => {
    const xs: number[] = [];
    const ys: number[] = [];
    values.forEach((v, i) => {
      if (v === null) return;
      if (useMask && includeInFit && !includeInFit[i]) return;
      xs.push(i);
      ys.push(v);
    });
    return { xs, ys };
  };

  let { xs, ys } = collect(true);
  if (xs.length < 2 && includeInFit) ({ xs, ys } = collect(false));

  const n = xs.length;
  if (n < 2) return values.map(() => null);

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] as number) - meanX;
    num += dx * ((ys[i] as number) - meanY);
    den += dx * dx;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;

  return values.map((v, i) => {
    if (v === null) return null;
    const y = intercept + slope * i;
    return Math.max(0, Math.round(y * 100) / 100);
  });
}

/** Sábado ou domingo, na régua BRT (o `day` já vem do recorte BRT). */
function isWeekend(month: string, day: number): boolean {
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(mon)) return false;
  const dow = new Date(Date.UTC(year, mon - 1, day)).getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * Marca quais dias entram no ajuste da tendência — só os "dias de operação".
 * Ficam de fora:
 *   - sábado e domingo;
 *   - dia útil sem nenhum movimento (0 RM e 0 RR): feriado, parada, sistema
 *     fora. Contar esses zeros derrubava a reta artificialmente.
 * Dia futuro (`null`) já não entra por não ter valor.
 */
export function operatingDaysMask(
  scheduled: Array<number | null>,
  held: Array<number | null>,
  days: number[],
  month: string,
): boolean[] {
  return days.map((day, i) => {
    if (isWeekend(month, day)) return false;
    const rm = scheduled[i] ?? null;
    const rr = held[i] ?? null;
    if (rm === null && rr === null) return false;
    return (rm ?? 0) > 0 || (rr ?? 0) > 0;
  });
}

/**
 * Monta a série do gráfico a partir das séries acumuladas que os cards KPI
 * "Reuniões marcadas" e "Reuniões realizadas" já recebem. Assim a soma das
 * barras bate com o número grande de cada card, com o mesmo filtro e a mesma
 * régua (BRT, até hoje). Se os tamanhos divergirem, usa o menor.
 */
export function buildMeetingsByDay(
  scheduled: DailyDataPoint[],
  held: DailyDataPoint[],
  month: string,
): MeetingsByDayPoint[] {
  const len = Math.min(scheduled.length, held.length);
  if (len === 0) return [];

  const scheduledByDay = diffCumulative(scheduled.slice(0, len));
  const heldByDay = diffCumulative(held.slice(0, len));

  const days: number[] = [];
  for (let i = 0; i < len; i++) days.push(scheduled[i]?.day ?? i + 1);

  const mask = operatingDaysMask(scheduledByDay, heldByDay, days, month);
  const trendScheduled = linearTrend(scheduledByDay, mask);
  const trendHeld = linearTrend(heldByDay, mask);

  const mon = month.slice(5, 7);
  const points: MeetingsByDayPoint[] = [];
  for (let i = 0; i < len; i++) {
    const day = days[i] ?? i + 1;
    points.push({
      day,
      label: `${String(day).padStart(2, '0')}/${mon}`,
      scheduled: scheduledByDay[i] ?? null,
      held: heldByDay[i] ?? null,
      trendScheduled: trendScheduled[i] ?? null,
      trendHeld: trendHeld[i] ?? null,
    });
  }
  return points;
}
