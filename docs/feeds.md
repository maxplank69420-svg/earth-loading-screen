# Feed selection

All modes use the same persisted article-ID and original-image record. Revisited history entries are a deliberate exception and pause playback. Failed images are not recorded as seen.

## Everything (random)

`generator=random`, namespace `0`, supplies batches of Wikipedia articles. The app requests introductory text and free article images, rejects disambiguation pages and entries without images/captions, and shuffles the remaining candidates with a Fisher–Yates shuffle. The shuffle uses `crypto.getRandomValues` and rejection sampling rather than sorting with `Math.random`.

No most-read, trending, featured, or hand-weighted topic feeds participate in online Random mode. Previous versions used a featured feed's most-read articles after the offline collection; this caused the popularity skew toward films and celebrities.

This is an unweighted shuffle of Wikipedia API candidates, conditioned on image and caption availability. It is not a promise of perfect mathematical uniformity across every Wikipedia article. Wikipedia determines random-article sampling, its coverage is uneven, and image eligibility changes the pool. Similar subjects can appear consecutively by chance. Topics are not deliberately alternated: that would change the distribution again.

If the API fails, Random mode explicitly reports that it is using the small bundled offline collection. That collection is curated and should not be mistaken for a random sample of all Wikipedia.

## Categories

Search queries use Wikipedia namespace `14`, plus an exact category lookup. The user selects an actual API-returned category title. There is no list of topic-specific conditions or category-to-article mappings in the code.

The client retrieves `categorymembers`, including pages and subcategories. It follows continuation tokens past the first alphabetic page, randomizes retrieved IDs and frontier selection, detects graph cycles, and explores subcategories up to four levels below the selected root. The traversal cursor remains in memory for the session. Reloads can re-fetch membership, but the persisted seen record still prevents displayed repeats.

Large graphs are explored incrementally, with up to eight membership requests and one detail request for twenty articles per batch. Playback tries at most four batches per advance. The user can choose next again to continue traversal. This bounds request cost; it does not produce a uniform random draw over an entire category graph. A category contains whatever Wikipedia editors put in it, and subcategories can cross into other subjects.

An empty, exhausted, sparse, or unavailable category does not fall back to unrelated pictures. The selection remains active and the app explains what happened. Changing feeds increments a generation number: responses and image loads from a previous selection are discarded before they can enter the active queue or history.

## Rabbit holes

The client reads namespace-zero outgoing links from the current article, across up to three pages of 500 links, shuffles them, then requests details for up to twenty targets. It chooses an unseen illustrated candidate. After three displayed linked articles, it draws a new random article. If no unseen illustrated link is found in a sampled link batch, it also starts randomly. The same image and article deduplication applies throughout.

This is link-following, not a semantic recommendation engine. A link may be a surprising tangent.

## Sources

- [MediaWiki Random API](https://www.mediawiki.org/wiki/API:Random)
- [MediaWiki Categorymembers API](https://www.mediawiki.org/wiki/API:Categorymembers)
- [MediaWiki Search API](https://www.mediawiki.org/wiki/API:Search)
- [MediaWiki Links API](https://www.mediawiki.org/wiki/API:Links)

Requests go directly from the browser to Wikipedia with CORS enabled. No secrets, proxies, user accounts, or topic-specific backend are required. Failed API calls back off for a minute. Storage and history stay local to the browser.
