(function () {
  const maxResults = 8;
  const emptyStatus = "キーワードを入力してください。";

  const index = getSearchIndex(window.IRODORI_SEARCH_INDEX);
  const roots = document.querySelectorAll("[data-search]");
  const params = new URLSearchParams(window.location.search);
  const initialQuery = params.get("q") || "";

  for (const root of roots) {
    connectSearch(root, index, initialQuery);
  }

  function connectSearch(root, searchIndex, initialValue) {
    const elements = getSearchElements(root);
    if (!elements) return;

    if (initialValue) elements.input.value = initialValue;

    const render = () => {
      renderSearchState(elements, getSearchState(searchIndex, elements.input.value));
    };

    elements.input.addEventListener("input", render);
    render();
  }

  function getSearchElements(root) {
    const input = root.querySelector("[data-search-input]");
    const status = root.querySelector("[data-search-status]");
    const results = root.querySelector("[data-search-results]");

    if (!(input instanceof HTMLInputElement) || !status || !results) {
      return null;
    }

    return { input, status, results };
  }

  function renderSearchState(elements, state) {
    elements.status.textContent = state.statusText;
    elements.results.replaceChildren();

    if (state.results.length === 0) return;

    elements.results.append(createResultList(state.results));
  }

  function createResultList(results) {
    const list = document.createElement("ul");
    list.className = "search-result-list";

    for (const result of results) {
      list.append(createResultItem(result));
    }

    return list;
  }

  function createResultItem(result) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    const meta = document.createElement("span");
    const title = document.createElement("strong");
    const summary = document.createElement("p");

    link.className = "search-result";
    link.href = result.url;

    meta.className = "search-result-meta";
    meta.textContent = result.category;

    title.textContent = result.title;
    summary.textContent = result.summary;

    link.append(meta, title, summary);
    item.append(link);

    return item;
  }

  function getSearchState(searchIndex, rawQuery) {
    const query = rawQuery.trim();
    const results = search(searchIndex, query, maxResults).map(toResultModel);

    return {
      results,
      statusText: getStatusText(query, results.length),
    };
  }

  function search(searchIndex, query, limit) {
    if (!query) return [];

    return searchIndex
      .map((item) => ({ item, score: scoreItem(item, query) }))
      .filter(({ score }) => score > 0)
      .sort(compareSearchResults)
      .slice(0, limit);
  }

  function scoreItem(item, query) {
    const normalizedQuery = normalize(query);
    const terms = getTerms(normalizedQuery);
    const title = normalize(item.title);
    const category = normalize(item.category);
    const summary = normalize(item.summary);
    const body = normalize(item.body);
    const tags = normalize(item.tags.join(" "));
    const haystack = [title, category, summary, body, tags].join(" ");

    return (
      scoreExactMatches({ title, tags, haystack }, normalizedQuery) +
      terms.reduce(
        (score, term) => score + scoreTermMatches({ title, tags, haystack }, term),
        0,
      )
    );
  }

  function scoreExactMatches(fields, normalizedQuery) {
    return [
      [fields.title, 24],
      [fields.tags, 14],
      [fields.haystack, 12],
    ].reduce(
      (score, [value, weight]) => score + (value.includes(normalizedQuery) ? weight : 0),
      0,
    );
  }

  function scoreTermMatches(fields, term) {
    return [
      [fields.title, 9],
      [fields.tags, 6],
      [fields.haystack, 3],
    ].reduce(
      (score, [value, weight]) => score + (value.includes(term) ? weight : 0),
      0,
    );
  }

  function compareSearchResults(left, right) {
    return (
      right.score - left.score ||
      left.item.category.localeCompare(right.item.category) ||
      left.item.title.localeCompare(right.item.title)
    );
  }

  function toResultModel({ item }) {
    return {
      category: item.category,
      summary: item.summary,
      title: item.title,
      url: item.url,
    };
  }

  function getStatusText(query, count) {
    if (!query) return emptyStatus;
    if (count === 0) return `「${query}」に一致するドキュメントはありません。`;
    return `「${query}」の検索結果 ${count} 件`;
  }

  function getSearchIndex(value) {
    if (!Array.isArray(value)) return [];

    return value
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        body: item.body || "",
        category: item.category || "",
        summary: item.summary || "",
        tags: Array.isArray(item.tags) ? item.tags : [],
        title: item.title || "",
        url: item.url || "#",
      }));
  }

  function getTerms(value) {
    return value.split(/\s+/).filter(Boolean);
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLowerCase();
  }
})();
