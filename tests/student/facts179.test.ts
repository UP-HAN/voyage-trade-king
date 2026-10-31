/**
 * 작업 179 — 3차시 AI 기술 연구비(L3-E3): 쓸 수 있는 돈보다 큰 금액은 결정 카드에서 고를 수 없다(호스트 NO_MONEY 거절 전에).
 */
import { describe, expect, it } from 'vitest';
import { playerView, publicClass } from '../../src/core';
import { eventsById } from '../../src/data/events';
import { optionFacts } from '../../src/student/events/facts';
import { decisionModel } from '../../src/ui/cards';
import { editPlayer, makeSession, player } from '../core/helpers';

describe('L3-E3 연구비 선택지', () => {
  it('쓸 수 있는 돈보다 큰 금액은 disabled + 까닭, 나머지는 고를 수 있음', () => {
    let s = makeSession({ n: 1, scope: ['L3'] });
    s = editPlayer(s, 1, (p) => {
      p.game.money = 150;
    });
    const me = playerView(player(s, 1));
    const m = decisionModel(eventsById['L3-E3'], { facts: optionFacts('L3-E3', publicClass(s.class), me) });
    const off = Object.fromEntries(m.options.map((o) => [o.id, o.disabled ?? null]));
    expect(off).toEqual({ '0': null, '100': null, '200': '쓸 수 있는 돈이 모자라요', '300': '쓸 수 있는 돈이 모자라요' });
  });
});
