const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../dist/discovery.js");
const page = (id) => ({
  pageid: Number(id),
  ns: 0,
  title: "Article " + id,
  original: { source: "https://upload.wikimedia.org/" + id + ".jpg" },
  extract: "A caption for article " + id + ".",
  fullurl: "https://en.wikipedia.org/wiki/Article_" + id,
});

test("random source uses Wikipedia random sampling, never a popularity feed", async () => {
  const calls = [];
  const client = D.createClient({
    choose: () => 0,
    request: async (params) => {
      calls.push(params);
      return { query: { pages: [page(1), page(2)] } };
    },
  });
  const stories = await client.random();
  assert.equal(stories.length, 2);
  assert.equal(calls[0].generator, "random");
  assert.equal(calls[0].grnnamespace, "0");
  assert.ok(calls.every((x) => !("mostread" in x) && !("featured" in x)));
});

test("shuffle is non-mutating and can reorder a pool", () => {
  const source = [1, 2, 3, 4];
  assert.notDeepEqual(
    D.shuffle(source, () => 0),
    source,
  );
  assert.deepEqual(source, [1, 2, 3, 4]);
});

test("eligibility requires an image, article text, and no disambiguation", () => {
  assert.ok(D.normalize(page(1), "Random"));
  assert.equal(
    D.normalize({ ...page(1), original: undefined }, "Random"),
    null,
  );
  assert.equal(D.normalize({ ...page(1), extract: "" }, "Random"), null);
  assert.equal(
    D.normalize({ ...page(1), pageprops: { disambiguation: "" } }, "Random"),
    null,
  );
  assert.equal(D.normalize({ ...page(1), ns: 14 }, "Random"), null);
});

test("arbitrary category search uses API results and recognizes exact names", async () => {
  const calls = [];
  const client = D.createClient({
    request: async (params) => {
      calls.push(params);
      return params.list
        ? { query: { search: [{ title: "Category:Deep sea fish" }] } }
        : {
            query: {
              pages: [
                {
                  ns: 14,
                  title: "Category:Deep sea fish",
                  categoryinfo: { pages: 45 },
                },
              ],
            },
          };
    },
  });
  assert.deepEqual(await client.searchCategories("deep sea fish"), [
    "Category:Deep sea fish",
  ]);
  assert.equal(calls[0].srnamespace, "14");
  assert.equal(calls[0].srsearch, "deep sea fish");
});

test("category traversal follows subcategories and continuation, with cycle protection", async () => {
  const calls = [];
  const client = D.createClient({
    choose: () => 0,
    request: async (params) => {
      calls.push(params);
      if (params.pageids)
        return { query: { pages: params.pageids.split("|").map(page) } };
      if (params.cmtitle === "Category:Root" && !params.cmcontinue) {
        return {
          query: {
            categorymembers: [
              { ns: 0, pageid: 1 },
              { ns: 14, title: "Category:Child" },
            ],
          },
          continue: { cmcontinue: "next-page" },
        };
      }
      if (params.cmtitle === "Category:Child") {
        return {
          query: {
            categorymembers: [
              { ns: 0, pageid: 2 },
              { ns: 14, title: "Category:Root" },
            ],
          },
        };
      }
      return { query: { categorymembers: [{ ns: 0, pageid: 3 }] } };
    },
  });
  const result = await client.category("Category:Root");
  assert.deepEqual(result.stories.map((x) => x.id).sort(), ["1", "2", "3"]);
  assert.equal(result.exhausted, true);
  assert.equal(calls.filter((x) => x.cmtitle === "Category:Child").length, 1);
  assert.ok(calls.some((x) => x.cmcontinue === "next-page"));
  assert.deepEqual((await client.category("Category:Root")).stories, []);
});

test("rabbit-hole candidates come from outgoing article links", async () => {
  const calls = [];
  const client = D.createClient({
    choose: () => 0,
    request: async (params) => {
      calls.push(params);
      return params.prop === "links"
        ? {
            query: {
              pages: [{ links: [{ title: "Clock" }, { title: "Time" }] }],
            },
          }
        : { query: { pages: [page(9)] } };
    },
  });
  assert.equal((await client.related("1"))[0].id, "9");
  assert.equal(calls[0].pageids, "1");
  assert.equal(calls[0].plnamespace, "0");
  assert.equal(calls[1].titles.split("|").length, 2);
});

test("article and original-image identities are both deduplicated", () => {
  const original =
    "https://upload.wikimedia.org/wikipedia/commons/a/ab/Clock.jpg";
  const thumb =
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Clock.jpg/1600px-Clock.jpg";
  assert.equal(D.imageKey(original), D.imageKey(thumb));
  assert.equal(
    D.unseen(
      { id: "2", image: thumb },
      { seen: [], images: [D.imageKey(original)] },
    ),
    false,
  );
});

test("history migration merges records and rejects invalid imports atomically", () => {
  const state = { history: [], seen: [], images: [], saved: [] };
  const story = {
    ...D.normalize(page(1), "Random"),
    seenAt: "2026-10-22T00:00:00Z",
    saved: true,
  };
  const merged = D.importHistory(state, { discoveries: [story, story] });
  assert.equal(merged.history.length, 1);
  assert.deepEqual(merged.saved, ["1"]);
  assert.deepEqual(merged.seen, ["1"]);
  assert.throws(() =>
    D.importHistory(state, {
      discoveries: [story, { ...story, image: "javascript:alert(1)" }],
    }),
  );
  assert.deepEqual(state.history, []);
});
