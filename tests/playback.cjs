const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const D = require("../dist/discovery.js");
const source = fs.readFileSync(path.join(__dirname, "../dist/app.js"), "utf8");
const story = (id, image) => ({
  id,
  title: "Discovery " + id,
  category: "Random article",
  extract: "A remarkable discovery.",
  image: "https://upload.wikimedia.org/" + image,
  originalImage: "https://upload.wikimedia.org/" + image,
  url: "https://en.wikipedia.org/wiki/Discovery_" + id,
});
const stories = [
  story("1", "a.jpg"),
  story("2", "b.jpg"),
  story("3", "b.jpg"),
  story("4", "c.jpg"),
];
const settle = () => new Promise((resolve) => setImmediate(resolve));

function harness(initial = {}, api = {}) {
  let saved = JSON.stringify({
    seen: ["1"],
    images: ["/a.jpg"],
    history: [{ ...stories[0], seenAt: new Date().toISOString() }],
    saved: [],
    online: true,
    ...initial,
  });
  const nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector))
      nodes.set(selector, {
        style: {},
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {} },
        setAttribute() {},
        removeAttribute() {},
        value: "",
        textContent: "",
        innerHTML: "",
        showModal() {},
        close() {},
        click() {},
        addEventListener() {},
        replaceChildren() {},
        append() {},
      });
    return nodes.get(selector);
  };
  let tick;
  let now = 0;
  const context = vm.createContext({
    console,
    URL,
    URLSearchParams,
    AbortSignal,
    Date,
    Math,
    JSON,
    Set,
    Blob,
    EarthDiscovery: {
      ...D,
      createClient: () => ({
        random: async () => structuredClone(stories),
        ...api,
      }),
    },
    Image: class {
      set src(value) {
        this.naturalWidth = 100;
        queueMicrotask(() => this.onload?.());
      }
    },
    document: {
      querySelector: (s) => (s === "dialog[open]" ? null : node(s)),
      querySelectorAll: () => [],
      createElement: () => node("created"),
      addEventListener() {},
      body: node("body"),
      documentElement: node("html"),
    },
    window: { addEventListener() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    localStorage: {
      getItem: () => saved,
      setItem: (key, value) => {
        saved = value;
      },
    },
    performance: { now: () => now },
    requestAnimationFrame: (fn) => fn(),
    setInterval: (fn) => {
      tick = fn;
    },
    setTimeout: (fn, ms) => (ms === 500 ? setImmediate(fn) : 0),
    clearTimeout() {},
    fetch: async () => ({
      ok: true,
      json: async () => structuredClone(stories),
    }),
    qrcode: () => ({
      addData() {},
      make() {},
      createSvgTag: () => "<svg></svg>",
    }),
  });
  vm.runInContext(source, context);
  return {
    context,
    read: (expr) => vm.runInContext(expr, context),
    saved: () => saved,
    advance: async () => {
      now += 2000;
      tick();
      await settle();
      await settle();
    },
  };
}

test("playback skips prior articles, duplicate images, and waits at exhaustion across restart", async () => {
  let h = harness();
  await settle();
  await settle();
  assert.equal(h.read("current.id"), "2");
  await h.read("next()");
  assert.equal(h.read("current.id"), "4");
  await h.read("next()");
  assert.equal(h.read("state.history.length"), 3);
  h = harness(JSON.parse(h.saved()));
  await settle();
  await settle();
  assert.equal(h.read("current"), null);
});

test("manual speed never advances automatically; custom speed is validated and persisted", async () => {
  const h = harness();
  await settle();
  await settle();
  h.read("setSpeed(0)");
  for (let i = 0; i < 10; i++) await h.advance();
  assert.equal(h.read("current.id"), "2");
  h.read("setSpeed(2)");
  assert.equal(h.read("state.duration"), 0);
  h.read("setSpeed(5)");
  assert.equal(JSON.parse(h.saved()).duration, 5);
  for (let i = 0; i < 3; i++) await h.advance();
  assert.equal(h.read("current.id"), "4");
});

test("switching feed discards an in-flight response from the old category", async () => {
  let resolveCategory;
  const h = harness(
    {},
    {
      category: () =>
        new Promise((resolve) => {
          resolveCategory = resolve;
        }),
    },
  );
  await settle();
  await settle();
  h.read("selectSource('category', 'Category:Clocks')");
  await settle();
  h.read("selectSource('random')");
  resolveCategory({
    stories: [story("99", "old-category.jpg")],
    exhausted: true,
  });
  await settle();
  await settle();
  await settle();
  await settle();
  assert.equal(h.read("state.browse"), "random");
  assert.equal(h.read("state.seen.includes('99')"), false);
  assert.equal(h.read("current.id"), "4");
});

test("rabbit mode follows three links then returns to random sampling", async () => {
  let count = 10;
  let randomCalls = 0;
  const h = harness(
    { browse: "rabbit" },
    {
      random: async () => {
        randomCalls++;
        return [story(String(count++), "r" + count + ".jpg")];
      },
      related: async () => [story(String(count++), "link" + count + ".jpg")],
    },
  );
  await settle();
  await settle();
  for (let i = 0; i < 3; i++) await h.read("next()");
  assert.equal(h.read("rabbitHops"), 3);
  assert.equal(randomCalls, 1);
  await h.read("next()");
  assert.equal(randomCalls, 2);
  assert.equal(h.read("rabbitHops"), 0);
});

test("empty category never leaks random or bundled pictures", async () => {
  let randomCalls = 0;
  const h = harness(
    { browse: "category", category: "Category:Empty" },
    {
      category: async () => ({ stories: [], exhausted: true }),
      random: async () => {
        randomCalls++;
        return stories;
      },
    },
  );
  await settle();
  await settle();
  assert.equal(h.read("current"), null);
  assert.equal(randomCalls, 0);
});

test("offline category selection remains restricted rather than showing the bundled collection", async () => {
  const h = harness({
    online: false,
    browse: "category",
    category: "Category:Clocks",
  });
  await settle();
  await settle();
  assert.equal(h.read("current"), null);
  assert.equal(h.read("state.history.length"), 1);
});

test("random mode reports its offline fallback and still deduplicates it", async () => {
  const h = harness({ online: false });
  await settle();
  await settle();
  assert.ok(["2", "4"].includes(h.read("current.id")));
  assert.match(
    h.read("document.querySelector('#feedStatus').textContent"),
    /Offline/,
  );
  await h.read("next()");
  assert.equal(h.read("state.history.length"), 3);
});
