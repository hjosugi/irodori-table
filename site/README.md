# Irodori Table Website

This directory is the static official site and documentation hub for Irodori
Table. It has no build step:

- `index.html` — official landing page.
- `docs.html` — user-facing documentation entry point.
- `search-data.js` — client-side full-text search index.
- `search.js` — search UI behavior shared by the landing page and docs page.

## Local preview

Open `site/index.html` or `site/docs.html` directly, or serve the directory:

```sh
python3 -m http.server 8080 --directory site
```

Then visit `http://localhost:8080`.

## Hosting

The repository includes `.github/workflows/pages.yml`, which publishes this
directory to GitHub Pages from the `main` branch. In GitHub repository settings,
set Pages to use **GitHub Actions** as the source.

Default project URL:

```text
https://hjosugi.github.io/irodori-table/
```

For a custom domain, add a `site/CNAME` file with the domain name and configure
DNS in the domain provider.
