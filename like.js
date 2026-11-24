(function () {
  const STORAGE_KEY = "kp_liked_posts_v1";
  const VISITOR_KEY = "kp_visitor_token_v1";

  function getVisitorToken() {
    let token = localStorage.getItem(VISITOR_KEY);
    if (!token) {
      token = "v_" + crypto.randomUUID();
      localStorage.setItem(VISITOR_KEY, token);
    }
    return token;
  }

  function getLikedSet() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  }

  function saveLikedSet(set) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
  }

  function isPostLiked(postId) {
    return getLikedSet().has(postId);
  }

  async function toggleLike(postId, onUpdated) {
    const sb = window.KPAuth.getSupabaseClient();
    const visitorToken = getVisitorToken();
    const likedSet = getLikedSet();
    const alreadyLiked = likedSet.has(postId);

    if (alreadyLiked) {
      const { error } = await sb
        .from("post_likes")
        .delete()
        .eq("post_id", postId)
        .eq("visitor_token", visitorToken);

      if (error) {
        console.error("Unlike error:", error);
        return;
      }
      likedSet.delete(postId);
      saveLikedSet(likedSet);
    } else {
      const { error } = await sb
        .from("post_likes")
        .insert([{ post_id: postId, visitor_token: visitorToken }]);

      if (error && error.code !== "23505") {
        console.error("Like error:", error);
        return;
      }
      likedSet.add(postId);
      saveLikedSet(likedSet);
    }

    const { count } = await sb
      .from("post_likes")
      .select("*", { count: "exact", head: true })
      .eq("post_id", postId);

    if (typeof onUpdated === "function") {
      onUpdated({
        liked: !alreadyLiked,
        count: count ?? 0
      });
    }
  }

  window.KPLikes = {
    isPostLiked,
    toggleLike
  };
})();
￼Enter
