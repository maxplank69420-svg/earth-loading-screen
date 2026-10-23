# Earth loading screen

Just a photo and a caption, like Wikipedia. For a spare monitor.

- New pictures automatically, with no repeated articles or images in this browser.
- Small source QR code, searchable history, and saved pictures.
- Light and dark modes. Follows your system until you choose a mode.
- Plain HTML, CSS, and JavaScript. No build, API keys, server account, or npm dependencies.

## Run locally

Install Python 3 if needed, then run from this folder:

```sh
python3 serve.py
```

On Windows: `py serve.py`. Open **http://127.0.0.1:8000**, move the window to your spare monitor, and click **full screen**. To choose a port: `python3 serve.py --port 8080`.

Any static server also works: serve the `dist/` directory. Opening `index.html` directly as a file will not work because the browser needs to fetch `stories.json` over HTTP.

The bundled local pictures work without an internet connection. Finding new articles and loading additional Wikimedia images requires internet. The collection waits when exhausted instead of looping.

## Publish on GitHub Pages

1. Create an empty GitHub repository (for example `earth-loading-screen`) and upload this folder's contents, including `.github/workflows/pages.yml`. Use `main` as the branch.
2. In the repository, go to **Settings → Pages → Build and deployment → Source**, and choose **GitHub Actions**.
3. Open **Actions → Publish to GitHub Pages → Run workflow**. Future pushes to `main` deploy automatically.
4. The deployment provides your Pages URL. Relative asset paths support both `username.github.io` and `username.github.io/repository/`.

The workflow uses GitHub's Pages actions, documented at https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages . It uploads `dist/` directly; there is no build step. GitHub Free supports Pages for public repositories. No ChatGPT login or Sites service is used by this portable project.

## Controls

Use the little links at the bottom: pause, next, history, dark/light mode, settings, full screen.

Keyboard: **Space** pauses; **→** skips; **H** opens history; **F** toggles full screen. Settings controls timing and optional photograph movement.

## Move your history to a different host

Browser history belongs to each origin. A new GitHub Pages URL or local server starts with a separate record. Before switching, open **history → Download history** on the old site. On the new one, choose **history → Import history** and select that JSON file. This restores the trail, saved pictures, and the seen record so future playback skips them. The first picture at a new origin may be displayed before you import.

Clearing browser data clears the record. If storage is blocked or full, Settings explains that tracking lasts only for the current session. Download history to keep a backup.

## Sources and licenses

Captions come from Wikipedia summaries (CC BY-SA); each caption links to its article, author history, and source details. Pictures come from Wikimedia Commons, with individual licenses and attribution accessible through each article's image page. Cached pictures preserve their original source URLs in `dist/stories.json`. The app's original HTML, CSS, JavaScript, and helper code are MIT licensed (see `LICENSE`); that license does not replace the separate licenses for Wikipedia text or Wikimedia pictures.

The QR generator is vendored locally under the MIT license, included at `dist/assets/qrcode-LICENSE.txt`. Live discovery reads Wikipedia's featured feed and illustrated random articles. Source outages back off and leave the current picture on screen.
