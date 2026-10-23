# Contributing

Earth loading screen is deliberately small: a photo, a caption, plain links, and room to be curious. Keep the existing typography, image sizing, themes, and transitions unless a change specifically calls for them.

## Start

```sh
python3 serve.py
```

Open http://127.0.0.1:8000. There are no application dependencies or build steps. Use Node.js 22+ to run the deterministic checks:

```sh
node --test tests/*.cjs
```

## Change a feed

Keep Wikipedia access in `dist/discovery.js` and UI/persistence in `dist/app.js`. Add request-mocked tests for changes to category traversal or feed selection; tests must not depend on the network. Never add topic-specific branches to make a particular category work.

Preserve the `earth-in-passing-v1` storage key or provide a migration. Preserve compatibility with downloaded history files. All feed types share the seen-article and seen-image record. Empty categories must not silently show unrelated stories. Old asynchronous requests must not affect a newly selected feed.

## Before opening a pull request

- Run `node --test tests/*.cjs` and `node --check dist/app.js`.
- Check your changed controls in light and dark mode, at desktop and narrow widths.
- Confirm the QR code and image credits still link to the displayed article.
- Keep relative asset URLs so GitHub Pages repository paths work.
- Keep Wikipedia text and image credits intact. Do not add assets without their source and license.

A pull request should explain the user-visible change and the checks you ran. Small, focused changes are easiest to review.
