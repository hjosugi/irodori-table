(function () {
  const index = Array.isArray(window.IRODORI_SEARCH_INDEX)
    ? window.IRODORI_SEARCH_INDEX
    : [];
  const roots = document.querySelectorAll("[data-search]");

  for (const root of roots) {
    const input = root.querySelector("[data-search-input]");
    const status = root.querySelector("[data-search-status]");
    const results = root.querySelector("[data-search-results]");
    if (!(input instanceof HTMLInputElement) || !status || !results) continue;

    const params = new URLSearchParams(window.location.search);
    const initialQuery = params.get("q") || "";
    if (initialQuery) input.value = initialQuery;

    const render = () => {
      const query = input.value.trim();
      const matches = search(query);
      renderResults(results, status, query, matches);
    };

    input.addEventListener("input", render);
    render();
  }

  function search(query) {
    if (!query) return [];
    const normalizedQuery = normalize(query);
    const terms = normalizedQuery.split(/\s+/).filter(Boolean);

    return index
      .map((item) => {
        const haystack = normalize(
          [
            item.title,
            item.category,
            item.summary,
            item.body,
            ...(item.tags || []),
          ].join(" "),
        );
        const title = normalize(item.title);
        const tags = normalize((item.tags || []).join(" "));
        let score = 0;

        if (title.includes(normalizedQuery)) score += 24;
        if (tags.includes(normalizedQuery)) score += 14;
        if (haystack.includes(normalizedQuery)) score += 12;

        for (const term of terms) {
          if (title.includes(term)) score += 9;
          if (tags.includes(term)) score += 6;
          if (haystack.includes(term)) score += 3;
        }

        return { item, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        return (
          right.score - left.score ||
          left.item.category.localeCompare(right.item.category) ||
          left.item.title.localeCompare(right.item.title)
        );
      })
      .slice(0, 8);
  }

  function renderResults(results, status, query, matches) {
    results.replaceChildren();

    if (!query) {
      status.textContent = "キーワードを入力してください。";
      return;
    }

    if (matches.length === 0) {
      status.textContent = `「${query}」に一致するドキュメントはありません。`;
      return;
    }

    status.textContent = `「${query}」の検索結果 ${matches.length} 件`;
    const list = document.createElement("div");
    list.className = "search-result-list";

    for (const { item } of matches) {
      const link = document.createElement("a");
      link.className = "search-result";
      link.href = item.url;

      const meta = document.createElement("span");
      meta.className = "search-result-meta";
      meta.textContent = item.category;

      const title = document.createElement("strong");
      title.textContent = item.title;

      const summary = document.createElement("p");
      summary.textContent = item.summary;

      link.append(meta, title, summary);
      list.append(link);
    }

    results.append(list);
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLowerCase();
  }
})();
