import { describe, expect, it } from 'vitest';

import type { DailyDataPoint } from '../types';
import {
  buildMeetingsByDay,
  diffCumulative,
  linearTrend,
  operatingDaysMask,
} from './meetings-by-day';

function series(actuals: Array<number | null>, month = '2026-09'): DailyDataPoint[] {
  return actuals.map((actual, i) => ({
    date: `${month}-${String(i + 1).padStart(2, '0')}`,
    day: i + 1,
    actual,
    target: 0,
  }));
}

describe('diffCumulative', () => {
  it('converte acumulado em contagem por dia', () => {
    expect(diffCumulative(series([2, 5, 5, 9]))).toEqual([2, 3, 0, 4]);
  });

  it('preserva null nos dias futuros', () => {
    expect(diffCumulative(series([1, 3, null, null]))).toEqual([1, 2, null, null]);
  });

  it('nunca devolve negativo', () => {
    expect(diffCumulative(series([5, 3]))).toEqual([5, 0]);
  });

  it('série vazia devolve vazio', () => {
    expect(diffCumulative([])).toEqual([]);
  });
});

describe('linearTrend', () => {
  it('série constante vira reta plana', () => {
    expect(linearTrend([3, 3, 3, 3])).toEqual([3, 3, 3, 3]);
  });

  it('série crescente tem inclinação positiva', () => {
    const trend = linearTrend([1, 2, 3, 4]) as number[];
    const first = trend[0] ?? 0;
    const last = trend[3] ?? 0;
    expect(first).toBeCloseTo(1);
    expect(last).toBeCloseTo(4);
    expect(last).toBeGreaterThan(first);
  });

  it('ignora null no ajuste e devolve null nas mesmas posições', () => {
    const trend = linearTrend([2, 2, 2, null, null]);
    expect(trend).toEqual([2, 2, 2, null, null]);
  });

  it('com menos de 2 pontos não há reta', () => {
    expect(linearTrend([5, null, null])).toEqual([null, null, null]);
    expect(linearTrend([])).toEqual([]);
  });

  it('clampa em zero quando a reta cruza abaixo do eixo', () => {
    const trend = linearTrend([10, 4, 0, 0, 0]) as number[];
    for (const v of trend) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('ajusta só nos índices marcados, mas desenha em todos os dias ocorridos', () => {
    // Os zeros dos índices 3 e 4 saem do ajuste: a reta continua plana em 3.
    const trend = linearTrend([3, 3, 3, 0, 0], [true, true, true, false, false]) as number[];
    expect(trend).toEqual([3, 3, 3, 3, 3]);
  });

  it('sem a máscara os mesmos zeros derrubam a reta', () => {
    const trend = linearTrend([3, 3, 3, 0, 0]) as number[];
    expect(trend[4] ?? 0).toBeLessThan(trend[0] ?? 0);
  });

  it('ignora a máscara quando ela deixa menos de 2 pontos', () => {
    const trend = linearTrend([1, 2, 3], [true, false, false]);
    expect(trend).toEqual([1, 2, 3]);
  });
});

describe('operatingDaysMask', () => {
  // Setembro/2026: 01 = terça … 04 = sexta, 05 = sábado, 06 = domingo, 07 = segunda.
  const days = [1, 2, 3, 4, 5, 6, 7];

  it('exclui fim de semana mesmo com movimento', () => {
    const mask = operatingDaysMask([1, 1, 1, 1, 2, 2, 1], [1, 1, 1, 1, 1, 1, 1], days, '2026-09');
    expect(mask[4]).toBe(false);
    expect(mask[5]).toBe(false);
  });

  it('exclui dia útil com 0 RM e 0 RR (feriado/parada)', () => {
    const mask = operatingDaysMask([4, 9, 4, 5, 0, 0, 0], [3, 3, 3, 2, 0, 0, 0], days, '2026-09');
    expect(mask.slice(0, 4)).toEqual([true, true, true, true]);
    expect(mask[6]).toBe(false);
  });

  it('mantém dia útil que teve só RR', () => {
    const mask = operatingDaysMask([0], [2], [1], '2026-09');
    expect(mask[0]).toBe(true);
  });

  it('dia futuro (null) fica de fora', () => {
    const mask = operatingDaysMask([null], [null], [1], '2026-09');
    expect(mask[0]).toBe(false);
  });
});

describe('buildMeetingsByDay', () => {
  it('monta pontos com rótulo DD/MM, barras por dia e tendência', () => {
    const points = buildMeetingsByDay(series([2, 5, 5]), series([1, 1, 3]), '2026-09');
    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({ day: 1, label: '01/09', scheduled: 2, held: 1 });
    expect(points[1]).toMatchObject({ day: 2, label: '02/09', scheduled: 3, held: 0 });
    expect(points[2]).toMatchObject({ day: 3, label: '03/09', scheduled: 0, held: 2 });
    expect(typeof points[1]?.trendScheduled).toBe('number');
    expect(typeof points[1]?.trendHeld).toBe('number');
  });

  it('dias futuros ficam null nas barras e na tendência', () => {
    const points = buildMeetingsByDay(
      series([1, 2, null, null]),
      series([0, 1, null, null]),
      '2026-09',
    );
    expect(points[2]).toMatchObject({
      scheduled: null,
      held: null,
      trendScheduled: null,
      trendHeld: null,
    });
    expect(points[3]?.scheduled).toBeNull();
  });

  it('usa o menor tamanho quando as séries divergem', () => {
    const points = buildMeetingsByDay(series([1, 2, 3, 4]), series([1, 1]), '2026-09');
    expect(points).toHaveLength(2);
  });

  it('a soma das barras bate com o último acumulado de cada card', () => {
    const scheduled = series([2, 4, 4, 7, 9]);
    const held = series([0, 1, 3, 3, 5]);
    const points = buildMeetingsByDay(scheduled, held, '2026-09');
    const sumScheduled = points.reduce((a, p) => a + (p.scheduled ?? 0), 0);
    const sumHeld = points.reduce((a, p) => a + (p.held ?? 0), 0);
    expect(sumScheduled).toBe(9);
    expect(sumHeld).toBe(5);
  });

  it('séries vazias devolvem vazio', () => {
    expect(buildMeetingsByDay([], [], '2026-09')).toEqual([]);
  });

  it('fim de semana e feriado zerados não derrubam a tendência', () => {
    // Cenário real de 01–07/09/2026: operação de ter a sex, depois sáb, dom e
    // o feriado de 07/09 zerados. A reta não pode despencar até o eixo.
    const points = buildMeetingsByDay(
      series([4, 13, 17, 22, 22, 22, 22]),
      series([3, 6, 9, 11, 11, 11, 11]),
      '2026-09',
    );
    expect(points[6]?.trendScheduled ?? 0).toBeGreaterThan(0);
    expect(points[6]?.trendHeld ?? 0).toBeGreaterThan(0);
  });
});
