/* Display, playback, and browser-local persistence. See discovery.js for Wikipedia access. */
"use strict";
const $ = (selector) => document.querySelector(selector);
const D = EarthDiscovery;
const KEY = "earth-in-passing-v1"; // Preserve existing installations and exports.
const client = D.createClient();
let state = {
  seen: [],
  images: [],
  history: [],
  saved: [],
  duration: 90,
  motion: false,
  online: true,
  theme: "system",
  browse: "random",
  category: "",
};
try {
  Object.assign(state, JSON.parse(localStorage.getItem(KEY) || "{}"));
} catch {}
if (!["random", "rabbit", "category"].includes(state.browse))
  state.browse = "random";
if (!Number.isFinite(state.duration) || state.duration < 0) state.duration = 90;
let current = null;
let queue = [];
let offlineCollection = [];
let paused = false;
let elapsed = 0;
let busy = false;
let fetching = null;
let epoch = 0;
let rabbitHops = 0;
let savedOnly = false;
let lastTick = performance.now();
let retryAfter = 0;
let idleTimer;
let searchTimer;
let searchVersion = 0;
let toastTimer;

function persist() {
  let durable = true;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    durable = false;
  }
  $("#storageStatus").textContent = durable
    ? "History is saved in this browser. Clearing browser data clears the seen record."
    : "Browser storage is unavailable or full. Tracking lasts for this session; download history to keep it.";
  $("#historyCount").textContent = state.history.length;
}

function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 4500);
}

function applyTheme() {
  const dark =
    state.theme === "dark" ||
    (state.theme === "system" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $("#themeToggle").textContent = dark ? "light mode" : "dark mode";
  $("#themeToggle").setAttribute("aria-pressed", String(dark));
}

function shortCaption(text) {
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)/g) || [text];
  let result = sentences[0].trim();
  if (
    result.length < 100 &&
    sentences[1] &&
    result.length + sentences[1].length < 300
  ) {
    result += " " + sentences[1].trim();
  }
  return result.length > 420
    ? result.slice(0, 390).replace(/\s\S*$/, "") + "…"
    : result;
}

function escapeHTML(text) {
  return String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

function render(story) {
  current = story;
  $("#main").classList.add("ready");
  $("#photo").src = story.image;
  $("#photo").alt = story.title;
  $("#photo").style.opacity = "1";
  $("#title").textContent = story.title.replaceAll("_", " ") + ".";
  $("#extract").textContent = shortCaption(story.extract);
  for (const id of ["read", "credit", "qr"]) $("#" + id).href = story.url;
  $("#qr").hidden = false;
  $("#credit").hidden = false;
  const code = qrcode(0, "M");
  code.addData(story.url);
  code.make();
  $("#qr").innerHTML = code.createSvgTag({
    cellSize: 2,
    margin: 0,
    scalable: true,
  });
  $("#qr svg").setAttribute("aria-label", "QR code linking to " + story.title);
  updateSaveButton();
  elapsed = 0;
  $("#photo").style.animation = "none";
  requestAnimationFrame(() => {
    $("#photo").style.animation = "";
  });
}

function updateSaveButton() {
  $("#saveCurrent").textContent =
    current && state.saved.includes(current.id) ? "Saved" : "Save this picture";
}

function loadImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    const timer = setTimeout(() => resolve(false), 12000);
    image.onload = () => {
      clearTimeout(timer);
      resolve(image.naturalWidth > 0);
    };
    image.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    image.src = url;
  });
}

function sourceLabel() {
  if (state.browse === "category")
    return state.category.replace(/^Category:/, "");
  return state.browse === "rabbit" ? "Rabbit hole" : "Everything (random)";
}

function updateSourceUI() {
  $("#activeSource").textContent = sourceLabel();
  $("#modeRandom").setAttribute(
    "aria-pressed",
    String(state.browse === "random"),
  );
  $("#modeRabbit").setAttribute(
    "aria-pressed",
    String(state.browse === "rabbit"),
  );
}

async function refill() {
  const generation = epoch;
  if (fetching?.epoch === generation) return fetching.promise;
  const job = (async () => {
    if (!state.online) {
      if (state.browse !== "random") {
        $("#feedStatus").textContent =
          "This mode needs Wikipedia online. The current picture will stay here.";
        return;
      }
      queue.push(
        ...D.shuffle(offlineCollection).filter((x) => D.unseen(x, state)),
      );
      $("#feedStatus").textContent =
        "Offline: using the small bundled collection.";
      return;
    }
    try {
      let stories;
      let usedRelated = false;
      if (state.browse === "category") {
        const result = await client.category(state.category);
        stories = result.stories;
        if (generation !== epoch) return;
        $("#feedStatus").textContent = result.exhausted
          ? "Category traversal finished. Seen articles and images are still skipped."
          : "Exploring " + sourceLabel() + " and its subcategories.";
      } else if (state.browse === "rabbit" && current && rabbitHops < 3) {
        stories = await client.related(current.id);
        usedRelated = stories.some((x) => D.unseen(x, state));
        if (!usedRelated) stories = await client.random();
      } else {
        stories = await client.random();
      }
      if (generation !== epoch) return;
      if (state.browse !== "category") {
        $("#feedStatus").textContent =
          state.browse === "rabbit"
            ? usedRelated
              ? "Following an outgoing link from " + current.title + "."
              : "Starting somewhere random."
            : "Random Wikipedia articles. No most-read, trending, or featured feed.";
      }
      const ids = new Set(queue.map((x) => x.id));
      for (const story of stories) {
        if (D.unseen(story, state) && !ids.has(story.id)) {
          queue.push({ ...story, relatedHop: usedRelated });
          ids.add(story.id);
        }
      }
      retryAfter = 0;
    } catch {
      if (generation !== epoch) return;
      retryAfter = Date.now() + 60000;
      if (state.browse === "random") {
        queue.push(
          ...D.shuffle(offlineCollection).filter((x) => D.unseen(x, state)),
        );
        $("#feedStatus").textContent =
          "Wikipedia is unavailable. Using the small bundled collection; retrying in a minute.";
      } else {
        $("#feedStatus").textContent =
          "Wikipedia is unavailable. This selection stays active; retrying in a minute.";
      }
    }
  })();
  fetching = { epoch: generation, promise: job };
  try {
    await job;
  } finally {
    if (fetching?.promise === job) fetching = null;
  }
}

async function next() {
  if (busy) return;
  busy = true;
  $("#next").disabled = true;
  const generation = epoch;
  try {
    let candidate;
    // Bounded work avoids hammering Wikipedia for sparse/exhausted categories.
    for (let batch = 0; batch < 4 && !candidate; batch++) {
      if (!queue.some((x) => D.unseen(x, state))) {
        queue = [];
        if (Date.now() < retryAfter) break;
        await refill();
      }
      if (generation !== epoch) return;
      while (queue.length) {
        const story = queue.shift();
        if (!D.unseen(story, state)) continue;
        const loaded = await loadImage(story.image);
        if (generation !== epoch) return;
        if (loaded && D.unseen(story, state)) {
          candidate = story;
          break;
        }
      }
      if (!state.online) break;
    }
    if (candidate) {
      if (current) {
        $("#photo").style.opacity = "0";
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (generation !== epoch) {
        $("#photo").style.opacity = "1";
        return;
      }
      state.seen.push(candidate.id);
      state.images.push(D.imageKey(candidate.originalImage || candidate.image));
      state.history.push({ ...candidate, seenAt: new Date().toISOString() });
      rabbitHops = candidate.relatedHop ? rabbitHops + 1 : 0;
      persist();
      render(candidate);
      if (state.browse === "rabbit") queue = []; // Each hop starts from the displayed article.
    } else {
      elapsed = 0;
      const message =
        state.browse === "category"
          ? "No new illustrated articles found in this part of the category. Try next again to explore further, or choose another category."
          : "No new pictures available right now. Nothing will repeat.";
      toast(message);
      if (!current) {
        $("#main").classList.add("ready");
        $("#title").textContent = "Waiting for a picture.";
        $("#extract").textContent = message;
        $("#read").removeAttribute("href");
        $("#credit").hidden = true;
        $("#qr").hidden = true;
      }
    }
  } finally {
    busy = false;
    $("#next").disabled = false;
    if (generation !== epoch) next();
  }
}

function selectSource(browse, category = "") {
  epoch++;
  queue = [];
  rabbitHops = 0;
  retryAfter = 0;
  state.browse = browse;
  state.category = category;
  updateSourceUI();
  persist();
  $("#categories").close();
  toast("Loading: " + sourceLabel());
  next();
}

function setPaused(value) {
  paused = value;
  $("#pause").textContent = value ? "play" : "pause";
  $("#pause").setAttribute("aria-label", value ? "Play" : "Pause");
  $("#photo").style.animationPlayState = value ? "paused" : "running";
}

function speedLabel(seconds) {
  if (!seconds) return "manual";
  return seconds % 60 === 0 ? seconds / 60 + "m" : seconds + "s";
}

function setSpeed(seconds) {
  if (
    !Number.isInteger(seconds) ||
    (seconds !== 0 && (seconds < 5 || seconds > 86400))
  ) {
    $("#speedError").textContent =
      "Choose a whole number from 5 to 86,400 seconds.";
    return;
  }
  state.duration = seconds;
  elapsed = 0;
  $("#speedError").textContent = "";
  syncSpeedUI();
  persist();
}

function syncSpeedUI() {
  $("#speedBtn").textContent = "speed: " + speedLabel(state.duration);
  $("#speedCurrent").textContent = state.duration
    ? "A new picture every " + state.duration + " seconds."
    : "Manual: pictures do not advance automatically.";
  for (const button of document.querySelectorAll("[data-speed]")) {
    button.setAttribute(
      "aria-pressed",
      String(Number(button.dataset.speed) === state.duration),
    );
  }
  if (state.duration) $("#customSeconds").value = state.duration;
}

function renderHistory() {
  const query = $("#search").value.toLowerCase();
  const stories = state.history
    .filter(
      (x) =>
        (!savedOnly || state.saved.includes(x.id)) &&
        (x.title + " " + x.extract).toLowerCase().includes(query),
    )
    .slice()
    .reverse();
  $("#historyList").innerHTML = stories.length
    ? stories
        .map(
          (x) => `
    <div class="history-item"><img loading="lazy" src="${escapeHTML(x.image)}" alt="">
      <div><button data-revisit="${x.id}" class="revisit"><h3>${escapeHTML(x.title)}</h3></button>
      <p>${escapeHTML(x.category)} · ${new Date(x.seenAt).toLocaleString()}</p>
      <a href="${escapeHTML(x.url)}" target="_blank" rel="noopener">Read original ↗</a></div>
      <button class="bookmark" data-save="${x.id}" aria-label="${state.saved.includes(x.id) ? "Unsave" : "Save"} ${escapeHTML(x.title)}">${state.saved.includes(x.id) ? "♥" : "♡"}</button>
    </div>`,
        )
        .join("")
    : '<p class="empty">' +
      (query
        ? "No matching pictures."
        : savedOnly
          ? "No saved pictures yet."
          : "Your first picture will appear here.") +
      "</p>";
}

function toggleSave(id) {
  state.saved = state.saved.includes(id)
    ? state.saved.filter((x) => x !== id)
    : [...state.saved, id];
  persist();
  updateSaveButton();
  renderHistory();
}

async function searchCategories() {
  clearTimeout(searchTimer);
  const version = ++searchVersion;
  const query = $("#categorySearch").value.trim();
  $("#categoryResults").replaceChildren();
  $("#categoryStatus").textContent = query
    ? "Searching Wikipedia categories…"
    : "Type a subject to find its Wikipedia categories.";
  if (!query) return;
  try {
    const titles = await client.searchCategories(query);
    if (version !== searchVersion) return;
    $("#categoryStatus").textContent = titles.length
      ? "Choose a category. Its articles and subcategories will be explored."
      : "No matching Wikipedia category. Try another spelling or a broader subject.";
    for (const title of titles) {
      const button = document.createElement("button");
      button.textContent = title.replace(/^Category:/, "");
      button.onclick = () => selectSource("category", title);
      const item = document.createElement("li");
      item.append(button);
      $("#categoryResults").append(item);
    }
  } catch {
    if (version === searchVersion)
      $("#categoryStatus").textContent =
        "Could not reach Wikipedia. Try again when connected.";
  }
}

// Small, plain controls. All additional choices live inside dialogs.
$("#pause").onclick = () => setPaused(!paused);
$("#next").onclick = next;
$("#themeToggle").onclick = () => {
  state.theme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme();
  persist();
};
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (state.theme === "system") applyTheme();
});
for (const [button, dialog] of [
  ["historyBtn", "history"],
  ["settingsBtn", "settings"],
  ["speedBtn", "speed"],
  ["categoriesBtn", "categories"],
]) {
  $("#" + button).onclick = () => {
    if (dialog === "history") renderHistory();
    $("#" + dialog).showModal();
  };
}
for (const button of document.querySelectorAll(".close"))
  button.onclick = () => button.closest("dialog").close();
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      dialog.close();
  });
}
for (const button of document.querySelectorAll("[data-speed]"))
  button.onclick = () => setSpeed(Number(button.dataset.speed));
$("#customSpeed").onsubmit = (event) => {
  event.preventDefault();
  setSpeed(Number($("#customSeconds").value));
};
$("#speedSettings").onclick = () => {
  $("#settings").close();
  $("#speed").showModal();
};
$("#modeRandom").onclick = () => selectSource("random");
$("#modeRabbit").onclick = () => selectSource("rabbit");
$("#categoryForm").onsubmit = (event) => {
  event.preventDefault();
  searchCategories();
};
$("#categorySearch").oninput = () => {
  searchVersion++; // Invalidate a previous response immediately, before debounce completes.
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchCategories, 400);
};
$("#search").oninput = renderHistory;
$("#allHistory").onclick = () => {
  savedOnly = false;
  $("#allHistory").classList.add("selected");
  $("#savedHistory").classList.remove("selected");
  renderHistory();
};
$("#savedHistory").onclick = () => {
  savedOnly = true;
  $("#savedHistory").classList.add("selected");
  $("#allHistory").classList.remove("selected");
  renderHistory();
};
$("#historyList").onclick = (event) => {
  const button = event.target.closest("[data-save],[data-revisit]");
  if (!button) return;
  if (button.dataset.save) toggleSave(button.dataset.save);
  else {
    const story = state.history.find((x) => x.id === button.dataset.revisit);
    setPaused(true);
    render(story);
    $("#history").close();
    toast("Revisiting from history. Playback paused.");
  }
};
$("#saveCurrent").onclick = () => {
  if (current) toggleSave(current.id);
};
$("#export").onclick = () => {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          discoveries: state.history.map((x) => ({
            ...x,
            saved: state.saved.includes(x.id),
          })),
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "earth-loading-screen-history.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("#importHistory").onclick = () => $("#historyFile").click();
$("#historyFile").onchange = async (event) => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    const imported = D.importHistory(state, JSON.parse(await file.text()));
    Object.assign(state, imported);
    persist();
    renderHistory();
    toast("History imported. Previously seen pictures will be skipped.");
  } catch {
    toast("Could not import that file. Use a downloaded history file.");
  } finally {
    event.target.value = "";
  }
};
$("#motion").checked = state.motion;
$(".photograph").classList.toggle("motion", state.motion);
$("#motion").onchange = (event) => {
  state.motion = event.target.checked;
  $(".photograph").classList.toggle("motion", state.motion);
  persist();
};
$("#online").checked = state.online;
$("#online").onchange = (event) => {
  epoch++;
  queue = [];
  retryAfter = 0;
  state.online = event.target.checked;
  persist();
};
async function fullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    toast("Use your browser’s full-screen command.");
  }
}
$("#fullscreen").onclick = fullscreen;
document.addEventListener("fullscreenchange", () => {
  document.body.classList.toggle("immersive", !!document.fullscreenElement);
  $("#fullscreen span").textContent = document.fullscreenElement
    ? "leave full screen"
    : "full screen";
});
document.addEventListener("mousemove", () => {
  document.body.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add("idle"), 9000);
});
document.addEventListener("keydown", (event) => {
  if (
    /INPUT|SELECT|TEXTAREA/.test(event.target.tagName) ||
    document.querySelector("dialog[open]")
  )
    return;
  if (event.code === "Space") {
    event.preventDefault();
    setPaused(!paused);
  }
  if (event.key === "ArrowRight") next();
  if (event.key.toLowerCase() === "h") $("#historyBtn").click();
  if (event.key.toLowerCase() === "f") fullscreen();
});
window.addEventListener("storage", (event) => {
  if (event.key !== KEY || !event.newValue) return;
  try {
    const other = JSON.parse(event.newValue);
    const merged = D.importHistory(state, {
      discoveries: other.history.map((x) => ({
        ...x,
        saved: other.saved.includes(x.id),
      })),
    });
    Object.assign(state, merged);
    $("#historyCount").textContent = state.history.length;
  } catch {}
});
window.addEventListener("online", () => {
  retryAfter = 0;
});
setInterval(() => {
  const now = performance.now();
  const delta = Math.min((now - lastTick) / 1000, 2);
  lastTick = now;
  if (
    !paused &&
    !busy &&
    state.duration > 0 &&
    !document.querySelector("dialog[open]")
  ) {
    elapsed += delta;
    if (elapsed >= state.duration) {
      elapsed = 0;
      next();
    }
  }
}, 250);

(async function start() {
  applyTheme();
  syncSpeedUI();
  updateSourceUI();
  persist();
  try {
    const response = await fetch("stories.json");
    if (response.ok) offlineCollection = await response.json();
  } catch {}
  $("#feedStatus").textContent = "Finding a random illustrated article…";
  await next();
})();
