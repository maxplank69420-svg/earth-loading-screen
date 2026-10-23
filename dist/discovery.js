/* Wikipedia discovery, independent of the page UI. No keys or build step. */
(function (root) {
  "use strict";

  function randomIndex(length) {
    if (length < 1) return 0;
    // Rejection sampling avoids modulo bias in the shuffle.
    const limit = Math.floor(0x100000000 / length) * length;
    const word = new Uint32Array(1);
    do {
      root.crypto.getRandomValues(word);
    } while (word[0] >= limit);
    return word[0] % length;
  }

  function shuffle(values, choose = randomIndex) {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) {
      const j = choose(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function imageKey(url) {
    try {
      return decodeURIComponent(new URL(url, "https://local.invalid/").pathname)
        .replace(/\/thumb\//, "/")
        .replace(/\/\d+px-[^/]+$/, "");
    } catch {
      return url;
    }
  }

  function unseen(story, state) {
    return (
      !state.seen.includes(story.id) &&
      !state.images.includes(imageKey(story.originalImage || story.image))
    );
  }

  function normalize(page, category) {
    const image = page.original?.source;
    if (
      page.ns !== 0 ||
      !image ||
      !page.extract?.trim() ||
      Object.hasOwn(page.pageprops || {}, "disambiguation")
    )
      return null;
    return {
      id: String(page.pageid),
      title: page.title,
      category,
      extract: page.extract.trim(),
      image: page.thumbnail?.source || image,
      originalImage: image,
      url:
        page.fullurl ||
        "https://en.wikipedia.org/wiki/" +
          encodeURIComponent(page.title.replaceAll(" ", "_")),
      source: "Wikipedia · Wikimedia Commons",
    };
  }

  async function wikiRequest(params) {
    const query = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      origin: "*",
      maxage: "0",
      smaxage: "0",
      ...params,
    });
    const response = await fetch(
      "https://en.wikipedia.org/w/api.php?" + query,
      {
        signal: AbortSignal.timeout(15000),
        cache: "no-store",
      },
    );
    if (!response.ok) throw new Error("Wikipedia returned " + response.status);
    const result = await response.json();
    if (result.error)
      throw new Error(result.error.info || "Wikipedia API error");
    return result;
  }

  const ARTICLE_FIELDS = {
    prop: "extracts|pageimages|info|pageprops",
    exintro: "1",
    explaintext: "1",
    exlimit: "20",
    exchars: "1200",
    piprop: "original|thumbnail",
    pithumbsize: "1600",
    inprop: "url",
    redirects: "1",
  };

  function createClient({ request = wikiRequest, choose = randomIndex } = {}) {
    const categories = new Map();
    const pagesOf = (data) => data.query?.pages || [];
    const storiesOf = (data, category) =>
      shuffle(
        pagesOf(data)
          .map((page) => normalize(page, category))
          .filter(Boolean),
        choose,
      );

    async function articles(ids, category) {
      if (!ids.length) return [];
      const data = await request({
        ...ARTICLE_FIELDS,
        pageids: ids.slice(0, 20).join("|"),
      });
      return storiesOf(data, category);
    }

    return {
      async random() {
        const data = await request({
          ...ARTICLE_FIELDS,
          generator: "random",
          grnnamespace: "0",
          grnlimit: "20",
        });
        return storiesOf(data, "Random article");
      },

      async searchCategories(text) {
        const query = text.trim().replace(/^Category:/i, "");
        if (!query) return [];
        const data = await request({
          list: "search",
          srnamespace: "14",
          srsearch: query,
          srlimit: "12",
          srprop: "size",
          srwhat: "text",
        });
        const results = (data.query?.search || []).map((x) => x.title);
        // Exact category names are useful even when full-text search ranks them low.
        const exact = await request({
          titles: "Category:" + query,
          prop: "categoryinfo",
        });
        for (const page of pagesOf(exact)) {
          if (page.ns === 14 && page.categoryinfo && !page.missing)
            results.unshift(page.title);
        }
        return [...new Set(results)];
      },

      async category(title) {
        if (!title.startsWith("Category:"))
          throw new Error("Choose a Wikipedia category first.");
        if (!categories.has(title)) {
          categories.set(title, {
            frontier: [{ title, depth: 0 }],
            visited: new Set([title]),
            ids: [],
          });
        }
        const cursor = categories.get(title);
        let requests = 0;
        // Walk actual Wikipedia membership, continuing beyond the first alphabetic page.
        // Broad categories are explored incrementally rather than downloading a whole encyclopedia.
        while (
          cursor.ids.length < 20 &&
          cursor.frontier.length &&
          requests < 8
        ) {
          const index = choose(cursor.frontier.length);
          const node = cursor.frontier.splice(index, 1)[0];
          const data = await request({
            list: "categorymembers",
            cmtitle: node.title,
            cmtype: "page|subcat",
            cmlimit: "500",
            ...(node.continue ? { cmcontinue: node.continue } : {}),
          });
          requests++;
          for (const member of shuffle(
            data.query?.categorymembers || [],
            choose,
          )) {
            if (member.ns === 0) cursor.ids.push(member.pageid);
            if (
              member.ns === 14 &&
              node.depth < 4 &&
              !cursor.visited.has(member.title)
            ) {
              cursor.visited.add(member.title);
              cursor.frontier.push({
                title: member.title,
                depth: node.depth + 1,
              });
            }
          }
          if (data.continue?.cmcontinue) {
            cursor.frontier.push({
              ...node,
              continue: data.continue.cmcontinue,
            });
          }
          cursor.ids = shuffle([...new Set(cursor.ids)], choose);
        }
        const ids = cursor.ids.splice(0, 20);
        return {
          stories: await articles(ids, title.replace(/^Category:/, "")),
          exhausted: !cursor.frontier.length && !cursor.ids.length,
        };
      },

      async related(pageId) {
        let token;
        const ids = [];
        // Collect up to 1,500 actual outgoing article links, then shuffle before reading.
        for (let i = 0; i < 3; i++) {
          const data = await request({
            pageids: pageId,
            prop: "links",
            plnamespace: "0",
            pllimit: "500",
            ...(token ? { plcontinue: token } : {}),
          });
          for (const page of pagesOf(data))
            ids.push(...(page.links || []).map((x) => x.title));
          token = data.continue?.plcontinue;
          if (!token) break;
        }
        const titles = shuffle([...new Set(ids)], choose).slice(0, 20);
        if (!titles.length) return [];
        const data = await request({
          ...ARTICLE_FIELDS,
          titles: titles.join("|"),
        });
        return storiesOf(data, "Linked article");
      },
    };
  }

  function validStory(x) {
    return (
      x &&
      /^\d+$/.test(x.id) &&
      typeof x.id === "string" &&
      ["title", "extract", "image", "originalImage", "category", "url"].every(
        (key) => typeof x[key] === "string",
      ) &&
      x.url.startsWith("https://en.wikipedia.org/wiki/") &&
      ((x.image.startsWith("assets/") && !x.image.includes("..")) ||
        /^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(x.image))
    );
  }

  function importHistory(state, data) {
    if (
      !Array.isArray(data.discoveries) ||
      data.discoveries.some(
        (x) => !validStory(x) || !Number.isFinite(Date.parse(x.seenAt)),
      )
    ) {
      throw new Error("Not a history export");
    }
    const next = {
      ...state,
      history: [...state.history],
      seen: [...state.seen],
      images: [...state.images],
      saved: [...state.saved],
    };
    for (const x of data.discoveries) {
      if (!next.history.some((h) => h.id === x.id)) next.history.push(x);
      next.seen.push(x.id);
      next.images.push(imageKey(x.originalImage));
      if (x.saved) next.saved.push(x.id);
    }
    for (const key of ["seen", "images", "saved"])
      next[key] = [...new Set(next[key])];
    next.history.sort((a, b) => Date.parse(a.seenAt) - Date.parse(b.seenAt));
    return next;
  }

  const api = {
    shuffle,
    imageKey,
    unseen,
    normalize,
    createClient,
    importHistory,
    validStory,
  };
  if (typeof module !== "undefined") module.exports = api;
  else root.EarthDiscovery = api;
})(globalThis);
