/**
 * 테스트용 아주 작은 DOM(Preact 렌더에 필요한 만큼만). jsdom 같은 새 의존성 없이
 * WorldMap 렌더 결과(속성·글자)를 검사하려고 쓴다. 레이아웃·CSS 는 흉내 내지 않는다.
 */
type Listener = (this: unknown, e: FakeEvent) => void;

export class FakeEvent {
  defaultPrevented = false;
  propagationStopped = false;
  target: FakeElement | null = null;
  currentTarget: FakeElement | null = null;
  constructor(
    public type: string,
    init: Record<string, unknown> = {},
  ) {
    Object.assign(this, init);
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
  stopPropagation() {
    this.propagationStopped = true;
  }
}

export class FakeNode {
  parentNode: FakeElement | null = null;
  childNodes: FakeNode[] = [];
  ownerDocument: FakeDocument;
  constructor(
    public nodeType: number,
    doc: FakeDocument,
  ) {
    this.ownerDocument = doc;
  }
  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }
  get nextSibling(): FakeNode | null {
    const p = this.parentNode;
    if (!p) return null;
    const i = p.childNodes.indexOf(this);
    return p.childNodes[i + 1] ?? null;
  }
  get previousSibling(): FakeNode | null {
    const p = this.parentNode;
    if (!p) return null;
    const i = p.childNodes.indexOf(this);
    return i > 0 ? p.childNodes[i - 1]! : null;
  }
  insertBefore(node: FakeNode, ref: FakeNode | null): FakeNode {
    if (node.parentNode) node.parentNode.removeChild(node);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(node);
    else this.childNodes.splice(i, 0, node);
    node.parentNode = this as unknown as FakeElement;
    return node;
  }
  appendChild(node: FakeNode): FakeNode {
    return this.insertBefore(node, null);
  }
  removeChild(node: FakeNode): FakeNode {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) this.childNodes.splice(i, 1);
    node.parentNode = null;
    return node;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this.childNodes = [];
    if (v) this.appendChild(this.ownerDocument.createTextNode(v));
  }
}

export class FakeText extends FakeNode {
  constructor(
    public data: string,
    doc: FakeDocument,
  ) {
    super(3, doc);
  }
  override get textContent(): string {
    return this.data;
  }
  override set textContent(v: string) {
    this.data = v;
  }
  get nodeValue() {
    return this.data;
  }
}

class FakeStyle {
  [key: string]: unknown;
  cssText = '';
  setProperty(name: string, value: string) {
    this[name] = value;
  }
  removeProperty(name: string) {
    delete this[name];
  }
}

export class FakeElement extends FakeNode {
  attributes = new Map<string, string>();
  style = new FakeStyle();
  listeners = new Map<string, Set<Listener>>();
  constructor(
    public localName: string,
    public namespaceURI: string | null,
    doc: FakeDocument,
  ) {
    super(1, doc);
  }
  get nodeName() {
    return this.localName.toUpperCase();
  }
  get tagName() {
    return this.nodeName;
  }
  setAttribute(name: string, value: unknown) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  addEventListener(type: string, fn: Listener, capture?: boolean) {
    const key = capture ? `${type}:capture` : type;
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener, capture?: boolean) {
    this.listeners.get(capture ? `${type}:capture` : type)?.delete(fn);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 1366, height: 640, right: 1366, bottom: 640, x: 0, y: 0 };
  }
  /** 캡처(위→아래) 다음 거품(아래→위) 단계를 흉내 낸다 */
  dispatch(type: string, init: Record<string, unknown> = {}): FakeEvent {
    const e = new FakeEvent(type, init);
    e.target = this;
    const path: FakeElement[] = [];
    for (let n: FakeElement | null = this; n; n = n.parentNode) path.push(n);
    for (const n of path.slice().reverse()) {
      e.currentTarget = n;
      if (e.propagationStopped) break;
      n.listeners.get(`${type}:capture`)?.forEach((fn) => fn.call(n, e));
    }
    for (const n of path) {
      if (e.propagationStopped) break;
      e.currentTarget = n;
      n.listeners.get(type)?.forEach((fn) => fn.call(n, e));
    }
    return e;
  }
  /** 모든 하위 요소 */
  all(): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (n: FakeNode) => {
      for (const c of n.childNodes) {
        if (c instanceof FakeElement) {
          out.push(c);
          walk(c);
        }
      }
    };
    walk(this);
    return out;
  }
  find(pred: (el: FakeElement) => boolean): FakeElement[] {
    return this.all().filter(pred);
  }
  hasClass(name: string) {
    return (this.getAttribute('class') ?? '').split(/\s+/).includes(name);
  }
}

export class FakeDocument {
  createElement(name: string) {
    return new FakeElement(name, 'http://www.w3.org/1999/xhtml', this);
  }
  createElementNS(ns: string | null, name: string) {
    return new FakeElement(name, ns, this);
  }
  createTextNode(data: string) {
    return new FakeText(String(data), this);
  }
}

/** globalThis.document 를 가짜로 바꾸고 루트 요소를 돌려준다 */
export function installFakeDom(): { root: FakeElement; restore: () => void } {
  const g = globalThis as Record<string, unknown>;
  const prev = g.document;
  const doc = new FakeDocument();
  g.document = doc;
  const root = doc.createElement('div');
  return {
    root,
    restore: () => {
      g.document = prev;
    },
  };
}
