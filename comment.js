(function () {
  const RATE_LIMIT_KEY = "kp_last_comment_ts";
  const COOLDOWN_MS = 10000;

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatCommentTime(isoStr) {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  async function fetchCommentsForPost(postId) {
    const sb = window.KPAuth.getSupabaseClient();
    const { data, error } = await sb
      .from("post_comments")
      .select("id, post_id, visitor_name, content, created_at")
      .eq("post_id", postId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching comments:", error);
      return [];
    }
    return data || [];
  }

  async function submitComment(postId, visitorName, content) {
    const cleanName = String(visitorName || "").trim().slice(0, 60) || "Candidate";
    const cleanContent = String(content || "").trim();

    if (cleanContent.length < 2) {
      throw new Error("Please write a comment before posting.");
    }
    if (cleanContent.length > 1000) {
      throw new Error("Comment is too long (maximum 1000 characters).");
    }

    const linkMatches = cleanContent.match(/https?:\/\//gi);
    if (linkMatches && linkMatches.length > 1) {
      throw new Error("Comments cannot contain multiple external links.");
    }

    const lastTs = Number(localStorage.getItem(RATE_LIMIT_KEY) || 0);
    const now = Date.now();
    if (now - lastTs < COOLDOWN_MS) {
      const waitSec = Math.ceil((COOLDOWN_MS - (now - lastTs)) / 1000);
      throw new Error(`Please wait ${waitSec}s before submitting another comment.`);
    }

    const sb = window.KPAuth.getSupabaseClient();
    const { data, error } = await sb
      .from("post_comments")
      .insert([
        {
          post_id: postId,
          visitor_name: cleanName,
          content: cleanContent
        }
      ])
      .select("id, post_id, visitor_name, content, created_at")
      .single();

    if (error) {
      throw new Error(error.message || "Could not post comment.");
    }

    localStorage.setItem(RATE_LIMIT_KEY, String(Date.now()));
    return data;
  }

  function renderCommentItem(comment) {
    return `
      <div class="comment-item" data-comment-id="${escapeHtml(comment.id)}">
        <div class="comment-top">
          <span class="comment-author">${escapeHtml(comment.visitor_name || "Candidate")}</span>
          <span class="comment-date">${formatCommentTime(comment.created_at)}</span>
        </div>
        <div class="comment-text">${escapeHtml(comment.content)}</div>
      </div>
    `;
  }

  window.KPComments = {
    fetchCommentsForPost,
    submitComment,
    renderCommentItem
  };
})();
