/**
 * 작업 114 e2e 전용 "헤드리스 학생 봇" 페이지 — 빌드에 들어가지 않는다.
 * 시험이 Vite로 한 덩어리로 묶어(`e2e/support/bots.ts`) 앱과 같은 주소(`/voyage/__bots.html`)에 끼워 넣는다(page.route).
 *
 * 한 페이지 안에서 학생 n명을 **실제 학생 코드**(createStudentStore + RelayPeer = 실제 중계 서버 WebSocket)로 띄우고,
 * 1초(빠른 시계 기준)마다 tests/sim/bot.ts의 무작위 행동을 한다. 저장소는 봇마다 메모리(기기 토큰 따로).
 */
import { botAction, rng, type BotStudent } from '../../tests/sim/bot';
import { createStudentStore, type StudentStore } from '../../src/student/store';
import { createPeerStore } from '../../src/sync/peer-store';
import { createRelayPeer } from '../../src/sync/relay';
import { defaultRelayUrl } from '../../src/config/deploy';

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
    __bots?: {
      start(code: string, seats: { seat: number; name: string }[], seed: number): Promise<void>;
      status(): { seat: number; status: string; err: string | null; founded: boolean; resolvedRound: number | null; acts: number; errors: string[]; seatLeak: boolean }[];
      stop(): void;
    };
  }
}

const bots: Bot[] = [];
let loop: ReturnType<typeof setInterval> | null = null;

window.__bots = {
  async start(code, seats, seed) {
    const url = defaultRelayUrl(location.href);
    const rand = rng(seed);
    for (const { seat, name } of seats) {
      const transport = createRelayPeer(url);
      let n = 0;
      const store: StudentStore = createStudentStore({
        transport,
        href: location.href,
        peerStore: createPeerStore({ storage: new Mem(), randomToken: () => `bot${seat}x${seed}${String(++n)}abcdefghijklmnopqrstuvwx`.slice(0, 32) }),
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
          const a = botAction(b, rand);
          if (!a) continue;
          const r = b.store.act(a);
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
      const pub = JSON.stringify(st.peer.public ?? {});
      return {
        seat: b.seat,
        status: st.peer.status,
        err: st.peer.errorCode ?? null,
        founded: Boolean(st.peer.me?.company.founded),
        resolvedRound: st.peer.me?.game.resolvedRound ?? null,
        acts: b.acts,
        errors: b.errors.slice(0, 5),
        seatLeak: /"seats?"\s*:/.test(pub),
      };
    });
  },
  stop() {
    if (loop) clearInterval(loop);
    for (const b of bots) b.store.dispose();
  },
};
document.getElementById('out')!.textContent = 'bots ready';
