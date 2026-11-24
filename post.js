(function () {
  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isSafeHttpUrl(url) {
    if (!url) return false;
    try {
      const parsed = new URL(url.trim());
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  function formatDisplayDate(dateStr) {
    if (!dateStr) return "Unknown Date";
    const parts = String(dateStr).split("-");
    if (parts.length === 3) {
      const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      return dt.toLocaleDateString("en-US", {
        weekday: "short",
        month: "long",
        day: "numeric",
        year: "numeric"
      });
    }
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  }

  function stripHashtagsFromText(text) {
    return String(text || "")
      .replace(/(^|\s)#[a-zA-Z0-9_]+/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  async function fetchAllPublishedPosts() {
    const sb = window.KPAuth.getSupabaseClient();

    const { data: posts, error } = await sb
      .from("posts")
      .select(`
        id,
        title,
        company_name,
        description,
        apply_url,
        image_url,
        published_date,
        created_at,
        post_hashtags ( tag ),
        post_likes ( count ),
        post_comments ( count )
      `)
      .order("published_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return (posts || []).map((p) => ({
      ...p,
      hashtags: (p.post_hashtags || []).map((h) => h.tag.toLowerCase()),
      likeCount: p.post_likes?.[0]?.count ?? 0,
      commentCount: p.post_comments?.[0]?.count ?? 0
    }));
  }

  function renderFeed(posts, containerEl) {
    if (!containerEl) return;

    if (!posts || posts.length === 0) {
      containerEl.innerHTML = `
        <div class="empty-state">
          <h3>No job posts found</h3>
          <p style="margin-top:6px;">Try clearing your search filter or check back soon for new openings.</p>
        </div>
      `;
      return;
    }

    const groups = [];
    const groupMap = new Map();

    for (const post of posts) {
      const dateKey = post.published_date || (post.created_at || "").slice(0, 10) || "Recent";
      if (!groupMap.has(dateKey)) {
        const entry = { dateKey, label: formatDisplayDate(dateKey), items: [] };
        groupMap.set(dateKey, entry);
        groups.push(entry);
      }
      groupMap.get(dateKey).items.push(post);
    }

    let html = "";
    for (const group of groups) {
      html += `
        <div class="date-group">
          <div class="date-group-header">
            <span class="date-group-badge">📅 ${escapeHtml(group.label)}</span>
            <div class="date-group-line"></div>
          </div>
          ${group.items.map((post) => renderPostCard(post)).join("")}
        </div>
      `;
    }

    containerEl.innerHTML = html;
    bindPostInteractions(containerEl);
  }

  function renderPostCard(post) {
    const liked = window.KPLikes.isPostLiked(post.id);
    const hasValidApplyUrl = isSafeHttpUrl(post.apply_url);
    const cleanDescription = stripHashtagsFromText(post.description);
    const displayDate = formatDisplayDate(post.published_date);

    return `
      <article class="post-card" data-post-id="${escapeHtml(post.id)}">
        <div class="post-header">
          <div class="post-author-row">
            <div class="post-avatar">KP</div>
            <div>
              <div class="post-author-name">KP Consultantsy</div>
              <div class="post-meta">
                <span>Published ${escapeHtml(displayDate)}</span>
                ${post.company_name ? `<span>•</span><span class="post-company-tag">${escapeHtml(post.company_name)}</span>` : ""}
              </div>
            </div>
          </div>
        </div>

        <div class="post-body">
          <h2 class="post-title">${escapeHtml(post.title)}</h2>
          <div class="post-description">${escapeHtml(cleanDescription)}</div>

          ${post.image_url ? `
            <div class="post-image-wrap">
              <img class="post-image" src="${escapeHtml(post.image_url)}" alt="${escapeHtml(post.title)}" loading="lazy" />
            </div>
          ` : ""}

          ${hasValidApplyUrl ? `
            <div class="post-apply-bar">
              <span style="font-size:13px;color:var(--text-secondary);">Interested in this opportunity?</span>
              <a class="apply-btn" href="${escapeHtml(post.apply_url)}" target="_blank" rel="noopener noreferrer">
                Apply Now ↗
              </a>
            </div>
          ` : ""}
        </div>

        <div class="post-stats">
          <span class="like-count-label">${post.likeCount} ${post.likeCount === 1 ? "Like" : "Likes"}</span>
          <span class="comment-count-label">${post.commentCount} ${post.commentCount === 1 ? "Comment" : "Comments"}</span>
        </div>

        <div class="post-actions">
          <button type="button" class="action-btn btn-like ${liked ? "liked" : ""}" data-post-id="${escapeHtml(post.id)}">
            <span>${liked ? "💜" : "🤍"}</span>
            <span>${liked ? "Liked" : "Like"}</span>
          </button>
          <button type="button" class="action-btn btn-toggle-comments" data-post-id="${escapeHtml(post.id)}">
            <span>💬</span>
            <span>Comment</span>
          </button>
        </div>

        <div class="comments-section hidden" id="comments-${escapeHtml(post.id)}">
          <form class="comment-form" data-post-id="${escapeHtml(post.id)}">
            <div class="comment-form-row">
              <input type="text" name="visitor_name" class="input-field" placeholder="Your Name (optional)" maxlength="60" style="max-width:220px;" />
              <input type="text" name="content" class="input-field" placeholder="Write a comment or question about this role..." maxlength="1000" required style="flex:1;" />
              <button type="submit" class="btn btn-primary btn-sm">Post</button>
            </div>
            <div class="comment-error" style="color:var(--danger);font-size:12.5px;display:none;"></div>
          </form>
          <div class="comment-list" id="comment-list-${escapeHtml(post.id)}">
            <div style="font-size:13px;color:var(--text-muted);">Loading comments...</div>
          </div>
        </div>
      </article>
    `;
  }

  function bindPostInteractions(containerEl) {
    containerEl.querySelectorAll(".btn-like").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const postId = btn.dataset.postId;
        const card = btn.closest(".post-card");
        btn.disabled = true;

        await window.KPLikes.toggleLike(postId, ({ liked, count }) => {
          btn.classList.toggle("liked", liked);
          btn.innerHTML = `<span>${liked ? "💜" : "🤍"}</span><span>${liked ? "Liked" : "Like"}</span>`;
          const countLabel = card.querySelector(".like-count-label");
          if (countLabel) {
            countLabel.textContent = `${count} ${count === 1 ? "Like" : "Likes"}`;
          }
        });

        btn.disabled = false;
      });
    });

    containerEl.querySelectorAll(".btn-toggle-comments").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const postId = btn.dataset.postId;
        const section = document.getElementById(`comments-${postId}`);
        const listEl = document.getElementById(`comment-list-${postId}`);
        const isHidden = section.classList.contains("hidden");

        section.classList.toggle("hidden");
        if (isHidden && !section.dataset.loaded) {
          const comments = await window.KPComments.fetchCommentsForPost(postId);
          section.dataset.loaded = "true";
          if (comments.length === 0) {
            listEl.innerHTML = `<div style="font-size:13px;color:var(--text-muted);">No comments yet. Be the first to comment!</div>`;
          } else {
            listEl.innerHTML = comments.map(window.KPComments.renderCommentItem).join("");
          }
        }
      });
    });

    containerEl.querySelectorAll(".comment-form").forEach((form) => {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const postId = form.dataset.postId;
        const card = form.closest(".post-card");
        const nameInput = form.querySelector('input[name="visitor_name"]');
        const contentInput = form.querySelector('input[name="content"]');
        const errBox = form.querySelector(".comment-error");
        const submitBtn = form.querySelector('button[type="submit"]');
        const listEl = document.getElementById(`comment-list-${postId}`);

        errBox.style.display = "none";
        submitBtn.disabled = true;

        try {
          const created = await window.KPComments.submitComment(
            postId,
            nameInput.value,
            contentInput.value
          );
          contentInput.value = "";

          if (listEl.textContent.includes("No comments yet")) {
            listEl.innerHTML = "";
          }
          listEl.insertAdjacentHTML("beforeend", window.KPComments.renderCommentItem(created));

          const countLabel = card.querySelector(".comment-count-label");
          if (countLabel) {
            const current = parseInt(countLabel.textContent, 10) || 0;
            const next = current + 1;
            countLabel.textContent = `${next} ${next === 1 ? "Comment" : "Comments"}`;
          }
        } catch (err) {
          errBox.textContent = err.message;
          errBox.style.display = "block";
        } finally {
          submitBtn.disabled = false;
        }
      });
    });
  }

  window.KPPosts = {
    fetchAllPublishedPosts,
    renderFeed,
    formatDisplayDate,
    stripHashtagsFromText,
    isSafeHttpUrl
  };
})();
￼Enter(function () {
  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isSafeHttpUrl(url) {
    if (!url) return false;
    try {
      const parsed = new URL(url.trim());
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  function formatDisplayDate(dateStr) {
    if (!dateStr) return "Unknown Date";
    const parts = String(dateStr).split("-");
    if (parts.length === 3) {
      const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      return dt.toLocaleDateString("en-US", {
        weekday: "short",
        month: "long",
        day: "numeric",
        year: "numeric"
      });
    }
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  }

  function stripHashtagsFromText(text) {
    return String(text || "")
      .replace(/(^|\s)#[a-zA-Z0-9_]+/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  async function fetchAllPublishedPosts() {
    const sb = window.KPAuth.getSupabaseClient();

    const { data: posts, error } = await sb
      .from("posts")
      .select(`
        id,
        title,
        company_name,
        description,
        apply_url,
        image_url,
        published_date,
        created_at,
        post_hashtags ( tag ),
        post_likes ( count ),
        post_comments ( count )
      `)
      .order("published_date", { ascending: false })
      .order("created_at", { ascending: false });

 (error) {
      throw error;
    }

    return (posts || []).map((p) => ({
      ...p,
      hashtags: (p.post_hashtags || []).map((h) => h.tag.toLowerCase()),
      likeCount: p.post_likes?.[0]?.count ?? 0,
      commentCount: p.post_comments?.[0]?.count ?? 0
    }));
  }

  function renderFeed(posts, containerEl) {
    if (!containerEl) return;

    if (!posts || posts.length === 0) {
      containerEl.innerHTML = `
        <div class="empty-state">
          <h3>No job posts found</h3>
          <p style="margin-top:6px;">Try clearing your search filter or check back soon for new openings.</p>
        </div>
      `;
      return;
    }

    const groups = [];
    const groupMap = new Map();

    for (const post of posts) {
      const dateKey = post.published_date || (post.created_at || "").slice(0, 10) || "Recent";
      if (!groupMap.has(dateKey)) {
        const entry = { dateKey, label: formatDisplayDate(dateKey), items: [] };
        groupMap.set(dateKey, entry);
        groups.push(entry);
      }
      groupMap.get(dateKey).items.push(post);
    }

    let html = "";
    for (const group of groups) {
      html += `
        <div class="date-group">
          <div class="date-group-header">
            <span class="date-group-badge">📅 ${escapeHtml(group.label)}</span>
            <div class="date-group-line"></div>
          </div>
          ${group.items.map((post) => renderPostCard(post)).join("")}
        </div>
      `;
    }

    containerEl.innerHTML = html;
    bindPostInteractions(containerEl);
  }

  function renderPostCard(post) {
    const liked = window.KPLikes.isPostLiked(post.id);
    const hasValidApplyUrl = isSafeHttpUrl(post.apply_url);
    const cleanDescription = stripHashtagsFromText(post.description);
    const displayDate = formatDisplayDate(post.published_date);

    return `
      <article class="post-card" data-post-id="${escapeHtml(post.id)}">
        <div class="post-header">
          <div class="post-author-row">
            <div class="post-avatar">KP</div>
            <div>
              <div class="post-author-name">KP Consultantsy</div>
              <div class="post-meta">
                <span>Published ${escapeHtml(displayDate)}</span>
                ${post.company_name ? `<span>•</span><span class="post-company-tag">${escapeHtml(post.company_name)}</span>` : ""}
              </div>
            </div>
          </div>
        </div>

        <div class="post-body">
          <h2 class="post-title">${escapeHtml(post.title)}</h2>
          <div class="post-description">${escapeHtml(cleanDescription)}</div>

          ${post.image_url ? `
            <div class="post-image-wrap">
              <img class="post-image" src="${escapeHtml(post.image_url)}" alt="${escapeHtml(post.title)}" loading="lazy" />
            </div>
          ` : ""}

          ${hasValidApplyUrl ? `
            <div class="post-apply-bar">
              <span style="font-size:13px;color:var(--text-secondary);">Interested in this opportunity?</span>
              <a class="apply-btn" href="${escapeHtml(post.apply_url)}" target="_blank" rel="noopener noreferrer">
                Apply Now ↗
              </a>
            </div>
          ` : ""}
        </div>

        <div class="post-stats">
          <span class="like-count-label">${post.likeCount} ${post.likeCount === 1 ? "Like" : "Likes"}</span>
          <span class="comment-count-label">${post.commentCount} ${post.commentCount === 1 ? "Comment" : "Comments"}</span>
        </div>

        <div class="post-actions">
          <button type="button" class="action-btn btn-like ${liked ? "liked" : ""}" data-post-id="${escapeHtml(post.id)}">
            <span>${liked ? "💜" : "🤍"}</span>
            <span>${liked ? "Liked" : "Like"}</span>
          </button>
          <button type="button" class="action-btn btn-toggle-comments" data-post-id="${escapeHtml(post.id)}">
            <span>💬</span>
            <span>Comment</span>
          </button>
