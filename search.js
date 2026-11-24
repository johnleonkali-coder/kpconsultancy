(function () {
  function normalizeQuery(q) {
    return String(q || "").trim().toLowerCase();
  }

  function filterPosts(allPosts, rawQuery) {
    const query = normalizeQuery(rawQuery);
    if (!query) {
      return allPosts;
    }

    const strippedHashQuery = query.replace(/^#+/, "");

    const matched = allPosts.filter((post) => {
      const titleMatch = (post.title || "").toLowerCase().includes(query);
      const descMatch = (post.description || "").toLowerCase().includes(query);
      const companyMatch = (post.company_name || "").toLowerCase().includes(query);

      const hashtagMatch = (post.hashtags || []).some((tag) => {
        const cleanTag = String(tag).toLowerCase().replace(/^#+/, "");
        return (
          cleanTag === strippedHashQuery ||
          cleanTag.includes(strippedHashQuery) ||
          `#${cleanTag}` === query
        );
      });

      return titleMatch || descMatch || companyMatch || hashtagMatch;
    });

    return matched.sort((a, b) => {
      const dateCmp = String(b.published_date || "").localeCompare(String(a.published_date || ""));
      if (dateCmp !== 0) return dateCmp;
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });
  }

  window.KPSearch = {
    filterPosts
  };
})();
￼Enter
