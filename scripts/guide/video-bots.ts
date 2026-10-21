/**
 * 작업 154 설명 영상 촬영 전용 "헤드리스 학생 봇" 페이지 — 빌드에 들어가지 않는다. capture-video.ts가 Vite로 한 덩어리로 묶어
 * 앱 주소 아래 `__vbots.html`로 끼워 넣는다(e2e/support/bot-harness.ts·bots.ts와 같은 방식, 그 파일들은 고치지 않음).
 *
 * e2e 봇과 다른 점은 하나: 응답을 받지 않는 개념 카드(L1-E2·L1-E4·L2-E2 등, needsResponse=false)도 실제 학생처럼
 * [다 봤어요](`respondEvent {seen:true}`)를 누른다. 그래야 교사 카드에 "카드를 아직 안 읽은 학생 1명"(촬영 학생만)이 보인다.
 * 그 밖의 행동은 tests/sim/bot.ts의 `botAction` 그대로(실제 학생 코드 + 실제 중계 서버 WebSocket).
 */
import { botAction, rng, type BotStudent } from '../../tests/sim/bot';
import { createStudentStore, type StudentStore } from '../../src/student/store';
import { createPeerStore } from '../../src/sync/peer-store';
import { createRelayPeer } from '../../src/sync/relay';
import { defaultRelayUrl } from '../../src/config/deploy';
import { eventsById } from '../../src/data/events';

class Mem {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  get length() {
    return this.m.size;
  }
}

interface Bot extends BotStudent {
  seat: number;
  name: string;
  acts: number;
  errors: string[];
}

declare global {
  interface Window {
    __vbots?: {
      start(code: string, seats: { seat: number; name: string }[], seed: number): Promise<void>;
      status(): { seat: number; status: string; founded: boolean; acts: number; errors: string[] }[];
      stop(): void;
    };
  }
}

const bots: Bot[] = [];
let loop: ReturnType<typeof setInterval> | null = null;

/** 응답을 받지 않는 카드(개념·소식)를 아직 안 읽었으면 [다 봤어요] */
function seenAction(b: Bot) {
  const st = b.store.getState();
  const me = st.peer.me;
  const pub = st.peer.public as { class?: { currentEvent?: { id: string; closed?: boolean } | null; paused?: boolean } } | null;
  const ev = pub?.class?.currentEvent;
  if (!me || !ev || ev.closed || pub?.class?.paused) return null;
  if (me.game.responses[ev.id] !== undefined) return null;
  const def = eventsById[ev.id];
  if (!def || def.needsResponse) return null;
  return { type: 'respondEvent', eventId: ev.id, response: { seen: true } } as const;
}

window.__vbots = {
  async start(code, seats, seed) {
    const url = defaultRelayUrl(location.href);
    const rand = rng(seed);
    for (const { seat, name } of seats) {
      const transport = createRelayPeer(url);
      let n = 0;
      const store: StudentStore = createStudentStore({
        transport,
        href: location.href,
        peerStore: createPeerStore({ storage: new Mem(), randomToken: () => `vb${seat}x${seed}${String(++n)}abcdefghijklmnopqrstuvwxyz`.slice(0, 32) }),
        deviceToken: null,
        rejoinDelayMs: () => 300 + Math.floor(rand() * 1200),
      });
      const b: Bot = { store, seat, name, acts: 0, errors: [] };
      bots.push(b);
      void store.join(code, seat, name);
      await new Promise((r) => setTimeout(r, 150));
    }
    loop = setInterval(() => {
      for (const b of bots) {
        if (rand() >= 0.35) continue;
        try {
          const a = (b.store.getState().peer.status === 'in' ? seenAction(b) : null) ?? botAction(b, rand);
          if (!a) continue;
          const r = b.store.act(a as never);
          b.acts++;
          if (r !== 'sent' && r !== 'queued') b.errors.push(String(r));
        } catch (e) {
          b.errors.push(String(e));
        }
      }
    }, 1000);
  },
  status() {
    return bots.map((b) => {
      const st = b.store.getState();
      return { seat: b.seat, status: st.peer.status, founded: Boolean(st.peer.me?.company.founded), acts: b.acts, errors: b.errors.slice(0, 5) };
    });
  },
  stop() {
    if (loop) clearInterval(loop);
    for (const b of bots) b.store.dispose();
  },
};
document.getElementById('out')!.textContent = 'bots ready';
